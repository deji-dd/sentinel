"use server";

import { createClient, createAdminClient } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { TABLE_NAMES } from "@/lib/constants";
import { redirect } from "next/navigation";

interface TornKeyInfoResponse {
  info?: {
    user?: {
      id: string;
    };
    access?: {
      level: number;
    };
  };
  error?: {
    code: number;
    error: string;
  };
}

const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error: An unhandled error occurred",
  1: "Key is empty: API key is empty in current request",
  2: "Incorrect Key: API key is wrong/incorrect format",
  3: "Wrong type: Requesting an incorrect basic type",
  4: "Wrong fields: Requesting incorrect selection fields",
  5: "Too many requests: Rate limited (max 100 per minute)",
  6: "Incorrect ID: Wrong ID value",
  7: "Incorrect ID-entity relation: A requested selection is private",
  8: "IP block: Current IP is banned for a period of time due to abuse",
  9: "API disabled: API system is currently disabled",
  10: "Key owner in federal jail: Current key cannot be used",
  11: "Key change error: Can only change API key once every 60 seconds",
  12: "Key read error: Error reading key from database",
  13: "Key temporarily disabled: Owner hasn't been online for more than 7 days",
  14: "Daily read limit reached: Too many records pulled today",
  15: "Temporary error: Testing error code",
  16: "Access level insufficient: Key does not have permission for this selection",
  17: "Backend error: Please try again",
  18: "API key paused: Key has been paused by the owner",
  19: "Must be migrated to crimes 2.0",
  20: "Race not yet finished",
  21: "Incorrect category: Wrong cat value",
  22: "Only available in API v1",
  23: "Only available in API v2",
  24: "Closed temporarily",
};

export async function authenticateTornUser(apiKey: string) {
  try {
    // Validate API key format
    if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
      throw new Error("API Key must be exactly 16 alphanumeric characters");
    }

    // Fetch key info from Torn API
    const response = await fetch(
      `https://api.torn.com/v2/key/info?key=${apiKey}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch from Torn API");
    }

    const data: TornKeyInfoResponse = await response.json();

    // Handle Torn API errors
    if (data.error) {
      const errorMessage =
        TORN_ERROR_CODES[data.error.code] || `Error code ${data.error.code}`;
      throw new Error(errorMessage);
    }

    // Validate response structure
    if (!data.info?.user?.id || data.info.access === undefined) {
      throw new Error("Invalid response from Torn API");
    }

    // Check access level (must be 3 or 4)
    if (data.info.access.level < 3) {
      throw new Error(
        `Insufficient permissions: Access level ${data.info.access.level}. Required: Limited or Full Access`,
      );
    }

    const playerId = data.info.user.id;
    const email = `${playerId}@sentinel.com`;

    // Initialize Supabase clients
    const supabase = await createClient(); // anon for session handling
    const admin = createAdminClient(); // service role for admin ops

    // Check if user exists in auth (list and filter by email)
    const { data: listData, error: listError } =
      await admin.auth.admin.listUsers();

    if (listError) {
      throw new Error(`Failed to fetch users: ${listError.message}`);
    }

    const existingUser = listData?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    const randomPassword = crypto.randomUUID();
    let userId: string;

    if (!existingUser) {
      // User doesn't exist, create them
      const { data: newUser, error: signupError } =
        await admin.auth.admin.createUser({
          email,
          password: randomPassword,
          email_confirm: true,
        });

      if (signupError || !newUser.user) {
        throw new Error(
          `Failed to create user: ${signupError?.message || "Unknown error"}`,
        );
      }

      userId = newUser.user.id;
    } else {
      // User exists - rotate password so we can establish a session
      userId = existingUser.id;

      const { error: updateError } = await admin.auth.admin.updateUserById(
        userId,
        {
          password: randomPassword,
          email_confirm: true,
        },
      );

      if (updateError) {
        throw new Error(
          `Failed to update user credentials: ${updateError.message}`,
        );
      }
    }

    // Store the API key securely with application-level encryption
    const encryptedKey = encrypt(apiKey);

    const { error: upsertError } = await admin.from(TABLE_NAMES.USERS).upsert(
      {
        user_id: userId,
        api_key: encryptedKey,
      },
      { onConflict: "user_id" },
    );

    if (upsertError) {
      throw new Error(`Failed to store user data: ${upsertError.message}`);
    }

    // Create a session by signing in with the (new) password
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password: randomPassword,
      });

    if (signInError || !signInData?.session) {
      throw new Error(
        `Failed to establish session: ${signInError?.message || "Unknown error"}`,
      );
    }

    // Redirect to dashboard on success
    redirect("/dashboard");
  } catch (error) {
    // Re-throw redirect errors without wrapping them
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
      throw error;
    }
    throw new Error(
      error instanceof Error ? error.message : "Authentication failed",
    );
  }
}
