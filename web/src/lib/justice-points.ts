import type { PersonBurdenBreakdown } from "@/lib/guard-burden";

/** נקודות צדק = שמירה + תורנות (מטבח/חמגשיות) */
export function justicePoints(
  burden: Pick<PersonBurdenBreakdown, "fairnessPoints" | "totalBurden"> | undefined,
  periodPoints?: number,
): number {
  if (burden?.fairnessPoints != null) return burden.fairnessPoints;
  if (burden?.totalBurden != null) return burden.totalBurden;
  return periodPoints ?? 0;
}

export function formatJusticePoints(value: number): string {
  return value.toFixed(1);
}

export const JUSTICE_POINTS_EXPLANATION =
  "נקודות צדק = נקודות שמירה (שמירות, עב״ס, כוננות, בונוס חוסר מנוחה) + נקודות תורנות (מטבח וחמגשיות).";
