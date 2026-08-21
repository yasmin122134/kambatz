import {
  boardStartFromMissionStart,
  defaultMissionWindow,
  defaultSchedulingForType,
  standardMissionPositions,
} from "@/lib/mission-templates";
import { emptyAssignments, getMissionDay, saveMissionDay } from "@/lib/missions";
import type { MissionDay, MissionSchedulingRules } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

export const DEFAULT_DUTY_GUARD_GAP_MINUTES = 90;

export type GuardDayBundleInput = {
  mission_date: string;
  /** התחלת יום שמירות (ISO). ברירת מחדל: 20:00 באותו תאריך */
  guard_starts_at?: string;
  guard_ends_at?: string;
  title?: string;
  status?: "draft" | "published";
  scheduling?: Partial<MissionSchedulingRules>;
};

function sharedScheduling(
  guardStartsAt: string,
  bundleId: string,
  extra?: Partial<MissionSchedulingRules>,
): MissionSchedulingRules {
  const board = boardStartFromMissionStart(guardStartsAt);
  return {
    ...DEFAULT_MISSION_SCHEDULING_RULES,
    ...defaultSchedulingForType("guards", guardStartsAt),
    ...extra,
    board_start: board,
    guard_day_bundle_id: bundleId,
    duty_guard_gap_minutes:
      extra?.duty_guard_gap_minutes ?? DEFAULT_DUTY_GUARD_GAP_MINUTES,
  };
}

/** יוצר זוג משימות: שמירות + עב״ס — מקושרים, rules משותפים, board_start אחיד */
export async function createGuardDayBundle(
  input: GuardDayBundleInput,
): Promise<{ guards: MissionDay; baseWork: MissionDay; bundleId: string }> {
  const mission_date = input.mission_date.slice(0, 10);
  const guardWindow = defaultMissionWindow("guards", mission_date);
  const guardStartsAt = input.guard_starts_at ?? guardWindow.startsAt;
  const guardEndsAt = input.guard_ends_at ?? guardWindow.endsAt;
  const baseWindow = defaultMissionWindow("base_work", mission_date);
  const bundleId = crypto.randomUUID();
  const status = input.status ?? "draft";

  const scheduling = sharedScheduling(guardStartsAt, bundleId, input.scheduling);

  const guardPositions = standardMissionPositions({
    missionType: "guards",
    startsAt: guardStartsAt,
    endsAt: guardEndsAt,
    scheduling,
  });

  const basePositions = standardMissionPositions({
    missionType: "base_work",
    startsAt: baseWindow.startsAt,
    endsAt: baseWindow.endsAt,
    scheduling,
  });

  const guards = await saveMissionDay({
    title: input.title?.trim() || `${mission_date} · שמירות`,
    mission_type: "guards",
    mission_date,
    starts_at: guardStartsAt,
    ends_at: guardEndsAt,
    status,
    positions: guardPositions,
    assignments: emptyAssignments(guardPositions),
    scheduling_rules: {
      ...scheduling,
      guard_day_bundle_id: bundleId,
    },
    notes: "חלק מיום שמירות+עב״ס מאוחד",
  });

  const baseWork = await saveMissionDay({
    title: `${mission_date} · עב״ס`,
    mission_type: "base_work",
    mission_date,
    starts_at: baseWindow.startsAt,
    ends_at: baseWindow.endsAt,
    status,
    positions: basePositions,
    assignments: emptyAssignments(basePositions),
    scheduling_rules: {
      ...scheduling,
      linked_mission_id: guards.id,
      guard_day_bundle_id: bundleId,
    },
    notes: "חלק מיום שמירות+עב״ס מאוחד — לא לשבץ חופף לשמירות (מלבד כרמל ב׳)",
  });

  const guardsLinked = await saveMissionDay({
    ...guards,
    scheduling_rules: {
      ...scheduling,
      linked_mission_id: baseWork.id,
      guard_day_bundle_id: bundleId,
    },
  });

  return { guards: guardsLinked, baseWork, bundleId };
}

/** מוסיף משימת עב״ס מקושרת ליום שמירות קיים (אם עדיין אין). */
export async function ensureLinkedBaseWork(
  guards: MissionDay,
): Promise<{ guards: MissionDay; baseWork: MissionDay } | null> {
  if (guards.mission_type !== "guards") return null;
  if (guards.scheduling_rules?.linked_mission_id) {
    const existing = await getMissionDay(guards.scheduling_rules.linked_mission_id);
    if (existing) return { guards, baseWork: existing };
  }

  const bundleId = guards.scheduling_rules?.guard_day_bundle_id ?? crypto.randomUUID();
  const scheduling = sharedScheduling(
    guards.starts_at,
    bundleId,
    guards.scheduling_rules,
  );
  const baseWindow = defaultMissionWindow("base_work", guards.mission_date);
  const basePositions = standardMissionPositions({
    missionType: "base_work",
    startsAt: baseWindow.startsAt,
    endsAt: baseWindow.endsAt,
    scheduling,
  });

  const baseWork = await saveMissionDay({
    title: `${guards.mission_date} · עב״ס`,
    mission_type: "base_work",
    mission_date: guards.mission_date,
    starts_at: baseWindow.startsAt,
    ends_at: baseWindow.endsAt,
    status: guards.status,
    positions: basePositions,
    assignments: emptyAssignments(basePositions),
    scheduling_rules: {
      ...scheduling,
      linked_mission_id: guards.id,
      guard_day_bundle_id: bundleId,
    },
    notes: "חלק מיום שמירות+עב״ס מאוחד — לא לשבץ חופף לשמירות (מלבד כרמל ב׳)",
  });

  const guardsLinked = await saveMissionDay({
    ...guards,
    scheduling_rules: {
      ...scheduling,
      linked_mission_id: baseWork.id,
      guard_day_bundle_id: bundleId,
    },
  });

  return { guards: guardsLinked, baseWork };
}

export function missionsInBundle(
  missions: MissionDay[],
  mission: MissionDay,
): MissionDay[] {
  const bundleId = mission.scheduling_rules?.guard_day_bundle_id;
  if (!bundleId) return [mission];
  return missions.filter((m) => m.scheduling_rules?.guard_day_bundle_id === bundleId);
}
