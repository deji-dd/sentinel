import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { user: null, authenticated: false },
        { status: 200 },
      );
    }

    return NextResponse.json({ user, authenticated: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "An error occurred fetching user" },
      { status: 500 },
    );
  }
}
