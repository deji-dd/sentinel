"use server";

import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

interface TornKeyInfoResponse {
  user?: {
    id: string;
  };
  access?: {
    level: number;
  };
  error?: {
    code: number;
    error: string;
  };
}

const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error: An unhandled error occurred",
  1: "Key is empty: Private key is empty in current request",
  2: "Incorrect Key: Private key is wrong/incorrect format",
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
    if (!data.user?.id || data.access === undefined) {
      throw new Error("Invalid response from Torn API");
    }

    // Check access level (must be 3 or 4)
    if (data.access.level < 3) {
      throw new Error(
        `Insufficient permissions: Access level ${data.access.level}. Required: Limited or Full Access`,
      );
    }

    const playerId = data.user.id;
    const email = `${playerId}@sentinel.com`;

    // Initialize Supabase server client
    const supabase = await createClient();

    // Check if user exists in auth (list and filter by email)
    const { data: listData, error: listError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

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
        await supabase.auth.admin.createUser({
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

      const { error: updateError } = await supabase.auth.admin.updateUserById(
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

    // Store the API key using RPC function
    const { error: rpcError } = await supabase.rpc("store_user_key", {
      user_id: userId,
      api_key: apiKey,
    });

    if (rpcError) {
      throw new Error(`Failed to store API key: ${rpcError.message}`);
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
    throw new Error(
      error instanceof Error ? error.message : "Authentication failed",
    );
  }
}
