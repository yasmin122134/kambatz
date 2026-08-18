import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isKnownAdminEmail } from "@/lib/admins";
import { ADMIN_COOKIE } from "@/lib/auth";

function hasAdminCookie(request: NextRequest) {
  return request.cookies.get(ADMIN_COOKIE)?.value === "1";
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdmin =
    hasAdminCookie(request) ||
    (user?.email ? isKnownAdminEmail(user.email) : false);

  if (request.nextUrl.pathname === "/scheduler.html" && !isAdmin) {
    const login = new URL("/admin", request.url);
    login.searchParams.set("next", "/scheduler.html");
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    "/scheduler.html",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
