import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { user: null, authenticated: false },
        { status: 200 },
      );
    }

    return NextResponse.json({ user, authenticated: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "An error occurred fetching user" },
      { status: 500 },
    );
  }
}
