import { cookies } from "next/headers";
import { isKnownAdminEmail } from "@/lib/admins";
import { personIsSiteAdmin } from "@/lib/officers";
import { getAuthUser, getPersonByEmail } from "@/lib/session";

const COOKIE = "bahadix_admin";

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  if (store.get(COOKIE)?.value === "1") return true;

  const user = await getAuthUser();
  if (!user?.email) return false;

  if (isKnownAdminEmail(user.email)) return true;

  const person = await getPersonByEmail(user.email);
  return personIsSiteAdmin(person);
}

export function adminCookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

export { COOKIE as ADMIN_COOKIE };
