import { DUTY_OFFICER_EMAILS } from "@/lib/officers";

/** מיילים עם הרשאות מפקד — גם לפני הרצת migration_officer.sql */
export const DEFAULT_ADMIN_EMAILS = [...DUTY_OFFICER_EMAILS];

export function adminEmailsFromEnv(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function allConfiguredAdminEmails(): string[] {
  return [...new Set([...DEFAULT_ADMIN_EMAILS, ...adminEmailsFromEnv()])].map(
    (e) => e.toLowerCase(),
  );
}

export function isKnownAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allConfiguredAdminEmails().includes(email.trim().toLowerCase());
}
