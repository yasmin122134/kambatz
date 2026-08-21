import type { Person } from "@/lib/types";

/** קצינים תורנים — גם מנהלי האתר */
export const DUTY_OFFICER_NAMES = ["רני פלג", "יסמין חדד"] as const;

export const DUTY_OFFICER_EMAILS = [
  "yasmin.haddad.yh.47@gmail.com",
  "rani.peleg.47@gmail.com",
] as const;

export function personIsDutyOfficer(
  person: Pick<Person, "is_officer" | "name"> | null | undefined,
): boolean {
  if (!person) return false;
  return !!person.is_officer || isDutyOfficerName(person.name);
}

/** הרשאות מנהל — זהה לקצין תורן */
export function personIsSiteAdmin(
  person: Pick<Person, "is_admin" | "is_officer"> | null | undefined,
): boolean {
  return !!person?.is_admin || !!person?.is_officer;
}

export function isDutyOfficerName(name: string): boolean {
  return (DUTY_OFFICER_NAMES as readonly string[]).includes(name.trim());
}
