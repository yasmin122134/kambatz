import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminCookieOptions } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = await request.json();
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD לא הוגדר בשרת" },
      { status: 500 },
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
  }

  const store = await cookies();
  store.set(ADMIN_COOKIE, "1", adminCookieOptions());

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
