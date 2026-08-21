import type { FairnessBucket, FairnessRules } from "@/lib/types";

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export function slotDurationHours(start: string, end: string): number {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null || e === null) return 0;
  let dur = e - s;
  if (dur <= 0) dur += 1440;
  return Math.round((dur / 60) * 100) / 100;
}

export function pointsForHours(
  hours: number,
  bucket: FairnessBucket,
  rules: FairnessRules,
  options?: { perShift?: boolean },
) {
  if (options?.perShift) {
    return Math.round(rules[bucket] * 100) / 100;
  }
  return Math.round(hours * rules[bucket] * 100) / 100;
}
