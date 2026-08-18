import { NextResponse } from "next/server";
import { isKnownAdminEmail } from "@/lib/admins";
import { ADMIN_COOKIE, adminCookieOptions } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPersonByEmail } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/profile";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const safeNext =
        next.startsWith("/") && !next.startsWith("//") ? next : "/profile";

      const {
        data: { user },
      } = await supabase.auth.getUser();

      let isAdmin = false;
      if (user?.email) {
        isAdmin = isKnownAdminEmail(user.email);
        if (!isAdmin) {
          const person = await getPersonByEmail(user.email);
          isAdmin = person?.is_admin === true;
        }
      }

      const response = NextResponse.redirect(`${origin}${safeNext}`);
      if (isAdmin) {
        response.cookies.set(ADMIN_COOKIE, "1", adminCookieOptions());
      }
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
