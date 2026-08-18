import { createClient } from "@/lib/supabase/server";
import { ISSUE_TYPE_LABELS, type Issue, type IssueType } from "@/lib/types";

export const SHIFT_KIND_LABELS: Record<string, string> = {
  guard: "שמירה",
  duty: "תורנות",
  standby: "כוננות",
  external: "חיצוני",
};

type SchedulerSlot = {
  id: string;
  job: string;
  kind: string;
  label: string;
  p: number;
  dur: number;
  count?: number;
  color?: string;
};

type SchedulerResult = {
  slots?: SchedulerSlot[];
  assign?: Record<string, (string | null)[]>;
};

type SchedulerState = {
  cfg?: { start?: string };
  cutoff?: number | null;
  result?: SchedulerResult | null;
  patrols?: PatrolRaw[];
};

type PatrolRaw = {
  id: string;
  name: string;
  time: string;
  who: string;
  note: string;
};

export type ScheduleRow = {
  id: string;
  timeLabel: string;
  job: string;
  kind: string;
  kindLabel: string;
  assignees: string[];
  sortKey: number;
  isPast: boolean;
  isMine: boolean;
  isNow: boolean;
};

export type PatrolRow = {
  id: string;
  name: string;
  time: string;
  who: string;
  note: string;
  isMine: boolean;
};

export type BlockRow = {
  id: string;
  label: string;
  time: string;
  note: string | null;
  status: "approved" | "pending";
  sortKey: number;
};

export type ScheduleView = {
  boardReady: boolean;
  boardStart: string;
  updatedAt: string | null;
  myShifts: ScheduleRow[];
  allShifts: ScheduleRow[];
  patrols: PatrolRow[];
  myPatrols: PatrolRow[];
  blocks: BlockRow[];
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

function slotTiming(
  sl: SchedulerSlot,
  boardStart: number,
): { startMin: number; endMin: number; startOff: number; endOff: number } {
  const startMin = (boardStart + sl.p) % 1440;
  const endMin = (startMin + sl.dur) % 1440;
  return {
    startMin,
    endMin,
    startOff: cycleOrder(startMin, boardStart),
    endOff: cycleOrder(endMin, boardStart),
  };
}

function isSlotNow(
  sl: SchedulerSlot,
  boardStart: number,
  nowOff: number,
): boolean {
  const { startOff, endOff } = slotTiming(sl, boardStart);
  if (endOff <= startOff) {
    return nowOff >= startOff || nowOff < endOff;
  }
  return nowOff >= startOff && nowOff < endOff;
}

function parsePatrolWho(who: string): string[] {
  return who
    .split(/[,،|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function personInPatrol(who: string, personName: string): boolean {
  const parts = parsePatrolWho(who);
  return parts.some((p) => p === personName);
}

export async function getScheduleView(personName: string): Promise<ScheduleView> {
  const supabase = await createClient();
  const boardStartStr = "20:00";

  const [stateRes, issuesRes] = await Promise.all([
    supabase
      .from("scheduler_state")
      .select("state, updated_at")
      .eq("id", 1)
      .maybeSingle(),
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
  const cutoff = state.cutoff ?? null;
  const nowOff = nowCycleOffset(boardStart);

  const allShifts: ScheduleRow[] = [];
  const myShifts: ScheduleRow[] = [];

  if (boardReady && result?.slots && result.assign) {
    const sorted = [...result.slots].sort(
      (a, b) => a.p - b.p || a.job.localeCompare(b.job),
    );

    for (const sl of sorted) {
      if (cutoff !== null && sl.p < cutoff) continue;

      const assignees = (result.assign[sl.id] || []).filter(
        (n): n is string => !!n,
      );
      const isMine = assignees.includes(personName);
      const isPast = false;
      const isNow = isSlotNow(sl, boardStart, nowOff);

      const row: ScheduleRow = {
        id: sl.id,
        timeLabel: sl.label,
        job: sl.job,
        kind: sl.kind,
        kindLabel: SHIFT_KIND_LABELS[sl.kind] || "משימה",
        assignees,
        sortKey: sl.p,
        isPast,
        isMine,
        isNow,
      };

      allShifts.push(row);
      if (isMine) myShifts.push(row);
    }
  }

  const patrolsRaw = (state.patrols || []) as PatrolRaw[];
  const patrols: PatrolRow[] = patrolsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    time: p.time,
    who: p.who,
    note: p.note,
    isMine: personInPatrol(p.who, personName),
  }));
  const myPatrols = patrols.filter((p) => p.isMine);

  const blocks: BlockRow[] = [];
  for (const issue of (issuesRes.data || []) as Issue[]) {
    const startMin = parseTime(issue.start_time);
    if (startMin === null) continue;
    blocks.push({
      id: issue.id,
      label: ISSUE_TYPE_LABELS[issue.issue_type as IssueType] || issue.issue_type,
      time: `${issue.start_time}–${issue.end_time}`,
      note: issue.note,
      status: issue.status as "approved" | "pending",
      sortKey: cycleOrder(startMin, boardStart),
    });
  }
  blocks.sort((a, b) => a.sortKey - b.sortKey);

  return {
    boardReady,
    boardStart: boardStartLabel,
    updatedAt: stateRes.data?.updated_at ?? null,
    myShifts,
    allShifts,
    patrols,
    myPatrols,
    blocks,
  };
}
