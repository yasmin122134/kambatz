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
