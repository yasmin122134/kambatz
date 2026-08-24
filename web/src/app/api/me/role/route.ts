import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getAuthSession } from "@/lib/session";

export async function GET() {
  const authSession = await getAuthSession();
  if (!authSession) {
    return NextResponse.json({
      authenticated: false,
      onRoster: false,
      admin: false,
    });
  }

  const admin = await isAdmin();
  return NextResponse.json({
    authenticated: true,
    onRoster: authSession.person !== null,
    admin,
    email: authSession.user.email,
  });
}
