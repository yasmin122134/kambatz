import { createClient } from "@/lib/supabase/server";
import type { Issue } from "@/lib/types";
import {
  intervalsOverlap,
  wallClockIntervalOnCalendarDate,
  type TimeInterval,
} from "@/lib/time-interval";

export function issueAbsoluteInterval(
  issue: Pick<Issue, "constraint_date" | "start_time" | "end_time">,
): TimeInterval | null {
  if (!issue.constraint_date) return null;
  return wallClockIntervalOnCalendarDate(
    issue.constraint_date,
    issue.start_time,
    issue.end_time,
  );
}

export function issueOverlapsInterval(
  issue: Pick<Issue, "constraint_date" | "start_time" | "end_time" | "status">,
  interval: TimeInterval,
): boolean {
  if (issue.status !== "approved") return false;
  const block = issueAbsoluteInterval(issue);
  if (!block) return false;
  return intervalsOverlap(block, interval);
}

export async function loadApprovedIssues(): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("status", "approved");

  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data || []) as Issue[];
}
