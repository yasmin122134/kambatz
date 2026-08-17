import { createClient } from "@/lib/supabase/server";
import { ISSUE_TYPE_LABELS, ISSUE_STATUS_LABELS, type Issue, type IssueType } from "@/lib/types";

export type UpcomingEvent = {
  id: string;
  kind: "shift" | "block";
  title: string;
  time: string;
  subtitle?: string;
  status?: string;
  statusKey?: "approved" | "pending";
  sortKey: number;
  ongoing?: boolean;
};

const SHIFT_KIND: Record<string, string> = {
  guard: "שמירה",
  duty: "תורנות",
  standby: "כוננות",
};

type SchedulerSlot = {
  id: string;
  job: string;
  kind: string;
  label: string;
  p: number;
  dur: number;
};

type SchedulerResult = {
  slots?: SchedulerSlot[];
  assign?: Record<string, (string | null)[]>;
};

type SchedulerState = {
  cfg?: { start?: string };
  cutoff?: number | null;
  result?: SchedulerResult | null;
};

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

function cycleOrder(minute: number, boardStart: number): number {
  return (minute - boardStart + 1440) % 1440;
}

function nowCycleOffset(boardStart: number): number {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return cycleOrder(nowMin, boardStart);
}

function isUpcoming(startMin: number, endMin: number, boardStart: number, nowOff: number): boolean {
  const startOff = cycleOrder(startMin, boardStart);
  const endOff = cycleOrder(endMin, boardStart);
  if (endOff <= startOff) {
    return nowOff < startOff || nowOff < endOff;
  }
  return nowOff < endOff;
}

export async function getUpcomingForPerson(personName: string): Promise<{
  boardReady: boolean;
  boardStart: string;
  events: UpcomingEvent[];
}> {
  const supabase = await createClient();
  const boardStartStr = "20:00";

  const [stateRes, issuesRes] = await Promise.all([
    supabase.from("scheduler_state").select("state").eq("id", 1).maybeSingle(),
    supabase
      .from("issues")
      .select("*")
      .eq("person_name", personName)
      .in("status", ["approved", "pending"])
      .order("start_time"),
  ]);

  const state = (stateRes.data?.state || {}) as SchedulerState;
  const boardStart = parseTime(state.cfg?.start || boardStartStr) ?? 20 * 60;
  const boardStartLabel = state.cfg?.start || boardStartStr;
  const result = state.result;
  const boardReady = !!(result?.slots?.length && result.assign);
  const nowOff = nowCycleOffset(boardStart);
  const cutoff = state.cutoff ?? null;

  const raw: UpcomingEvent[] = [];

  if (boardReady && result?.slots && result.assign) {
    for (const sl of result.slots) {
      if (cutoff !== null && sl.p < cutoff) continue;
      const seats = result.assign[sl.id] || [];
      if (!seats.includes(personName)) continue;

      const startMin = (boardStart + sl.p) % 1440;
      const endMin = (startMin + sl.dur) % 1440;
      const kindLabel = SHIFT_KIND[sl.kind] || "משימה";

      raw.push({
        id: `shift-${sl.id}`,
        kind: "shift",
        title: sl.job,
        time: sl.label,
        subtitle: kindLabel,
        sortKey: sl.p,
        ongoing: isUpcoming(startMin, endMin, boardStart, nowOff) && cycleOrder(startMin, boardStart) <= nowOff,
      });
    }
  }

  for (const issue of (issuesRes.data || []) as Issue[]) {
    const startMin = parseTime(issue.start_time);
    const endMin = parseTime(issue.end_time);
    if (startMin === null || endMin === null) continue;

    const label = ISSUE_TYPE_LABELS[issue.issue_type as IssueType] || issue.issue_type;
    raw.push({
      id: `issue-${issue.id}`,
      kind: "block",
      title: label,
      time: `${issue.start_time}–${issue.end_time}`,
      subtitle: issue.note || undefined,
      status: ISSUE_STATUS_LABELS[issue.status],
      statusKey: issue.status as "approved" | "pending",
      sortKey: cycleOrder(startMin, boardStart),
      ongoing:
        startMin !== null &&
        endMin !== null &&
        isUpcoming(startMin, endMin, boardStart, nowOff) &&
        cycleOrder(startMin, boardStart) <= nowOff,
    });
  }

  raw.sort((a, b) => a.sortKey - b.sortKey);

  const upcoming = raw.filter((ev) => {
    if (ev.kind === "shift") {
      const sl = result?.slots?.find((s) => ev.id === `shift-${s.id}`);
      if (!sl) return true;
      const startMin = (boardStart + sl.p) % 1440;
      const endMin = (startMin + sl.dur) % 1440;
      return isUpcoming(startMin, endMin, boardStart, nowOff);
    }
    const issue = (issuesRes.data || []).find((i) => ev.id === `issue-${i.id}`) as Issue | undefined;
    if (!issue) return true;
    const startMin = parseTime(issue.start_time)!;
    const endMin = parseTime(issue.end_time)!;
    return isUpcoming(startMin, endMin, boardStart, nowOff);
  });

  const rotated = [...upcoming];
  const firstFutureIdx = rotated.findIndex((ev) => !ev.ongoing);
  if (firstFutureIdx > 0) {
    rotated.push(...rotated.splice(0, firstFutureIdx));
  }

  return {
    boardReady,
    boardStart: boardStartLabel,
    events: rotated.slice(0, 10),
  };
}
