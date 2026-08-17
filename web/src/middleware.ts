import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

function isAdmin(request: NextRequest) {
  return request.cookies.get(ADMIN_COOKIE)?.value === "1";
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/scheduler.html" && !isAdmin(request)) {
    const login = new URL("/admin", request.url);
    login.searchParams.set("next", "/scheduler.html");
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/scheduler.html"],
};
