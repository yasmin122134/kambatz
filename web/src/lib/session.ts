import { createClient } from "@/lib/supabase/server";
import type { Person, PersonalFlags } from "@/lib/types";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleAdmin,
  probePeopleEmail,
  probePeopleFlags,
  probePeopleOfficer,
} from "@/lib/people";
import { personIsSiteAdmin } from "@/lib/officers";

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
  const hasEmail = await probePeopleEmail(supabase);
  if (!hasEmail) return null;

  const withFlags = await probePeopleFlags(supabase);
  const withAdmin = await probePeopleAdmin(supabase);
  const withOfficer = await probePeopleOfficer(supabase);
  let select = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}`
    : PEOPLE_BASE_SELECT;
  if (withAdmin) select += ",is_admin";
  if (withOfficer) select += ",is_officer";

  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("people")
    .select(select)
    .ilike("email", normalized)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as Person;
}

export async function peopleEmailReady(): Promise<boolean> {
  const supabase = await createClient();
  return probePeopleEmail(supabase);
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
  "no_guard",
  "no_standby",
  "no_standing",
  "no_base_work",
  "no_kitchen",
] as const satisfies readonly (keyof PersonalFlags)[];

export function pickPersonalFlags(body: Record<string, unknown>): PersonalFlags {
  return {
    no_guard: !!body.no_guard,
    no_standby: !!body.no_standby,
    no_standing: !!body.no_standing,
    no_base_work: !!body.no_base_work,
    no_kitchen: !!body.no_kitchen,
  };
}
