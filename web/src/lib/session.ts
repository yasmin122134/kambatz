import { createClient } from "@/lib/supabase/server";
import type { Person, PersonalFlags } from "@/lib/types";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleFlags,
} from "@/lib/people";

export async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getPersonByEmail(
  email: string,
): Promise<Person | null> {
  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);
  const select = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}`
    : PEOPLE_BASE_SELECT;

  const { data, error } = await supabase
    .from("people")
    .select(select)
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as Person;
}

export async function getSessionPerson(): Promise<{
  user: { id: string; email: string };
  person: Person;
} | null> {
  const user = await getAuthUser();
  if (!user?.email) return null;

  const person = await getPersonByEmail(user.email);
  if (!person) return null;

  return { user: { id: user.id, email: user.email }, person };
}

export const EDITABLE_PERSONAL_KEYS = [
  "km",
  "exam",
  "no_weapon",
  "no_guard",
  "no_mag",
] as const satisfies readonly (keyof PersonalFlags)[];

export function pickPersonalFlags(body: Record<string, unknown>): PersonalFlags {
  return {
    km: !!body.km,
    exam: !!body.exam,
    no_weapon: !!body.no_weapon,
    no_guard: !!body.no_guard,
    no_mag: !!body.no_mag,
  };
}
