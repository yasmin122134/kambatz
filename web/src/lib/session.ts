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
  const auth = await getAuthSession();
  if (!auth?.person) return null;
  return { user: auth.user, person: auth.person };
}

/** Logged-in user, with optional roster match (viewers have person === null). */
export async function getAuthSession(): Promise<{
  user: { id: string; email: string };
  person: Person | null;
} | null> {
  const user = await getAuthUser();
  if (!user?.email) return null;

  const person = await getPersonByEmail(user.email);
  return { user: { id: user.id, email: user.email }, person };
}

export function canSelfAssign(person: Person | null | undefined): boolean {
  return person != null;
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

export function bodyHasPersonalFlags(body: Record<string, unknown>): boolean {
  return EDITABLE_PERSONAL_KEYS.some((key) => key in body);
}

/** Admin PATCH payload: only include fields that were actually sent. */
export function buildPeopleAdminPatch(
  body: Record<string, unknown>,
  options: { withFlags: boolean; withOfficer: boolean },
):
  | { ok: true; patch: Record<string, unknown>; flagsChanged: boolean }
  | { ok: false; error: string; status: number } {
  const patch: Record<string, unknown> = {};
  let flagsChanged = false;

  if (typeof body.active === "boolean") {
    patch.active = body.active;
  }

  if (bodyHasPersonalFlags(body)) {
    if (!options.withFlags) {
      return {
        ok: false,
        status: 500,
        error:
          "עמודות הפטורים חסרות — הריצו supabase/migration_scheduling_exemptions.sql",
      };
    }
    Object.assign(patch, pickPersonalFlags(body));
    flagsChanged = true;
  }

  if (options.withOfficer && typeof body.is_officer === "boolean") {
    patch.is_officer = body.is_officer;
    patch.is_admin = body.is_officer;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, error: "אין שדות לעדכון" };
  }

  return { ok: true, patch, flagsChanged };
}
