import {
  defaultBaseWorkPositions,
  isBaseWorkPosition,
} from "@/lib/base-work-template";
import {
  defaultMissionWindow,
  defaultSchedulingForType,
  standardMissionPositions,
} from "@/lib/mission-templates";
import { effectiveBoardStartLabel } from "@/lib/mission-utils";
import {
  deleteMissionDay,
  emptyAssignments,
  getMissionDay,
  saveMissionDay,
  syncAssignmentSeats,
} from "@/lib/missions";
import type { MissionDay, MissionSchedulingRules } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

export const DEFAULT_DUTY_GUARD_GAP_MINUTES = 60;

export type GuardDayBundleInput = {
  mission_date: string;
  guard_starts_at?: string;
  guard_ends_at?: string;
  title?: string;
  status?: "draft" | "published";
  scheduling?: Partial<MissionSchedulingRules>;
};

function guardsScheduling(
  guardStartsAt: string,
  positions: MissionDay["positions"],
  extra?: Partial<MissionSchedulingRules>,
): MissionSchedulingRules {
  const board = effectiveBoardStartLabel({
    starts_at: guardStartsAt,
    positions,
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, ...extra },
  });
  return {
    ...DEFAULT_MISSION_SCHEDULING_RULES,
    ...defaultSchedulingForType("guards", guardStartsAt),
    ...extra,
    board_start: board,
    duty_guard_gap_minutes:
      extra?.duty_guard_gap_minutes ?? DEFAULT_DUTY_GUARD_GAP_MINUTES,
  };
}

/** יוצר יום שמירות אחד — כולל עמדות עב״ס (לא משימה נפרדת). */
export async function createGuardDayBundle(
  input: GuardDayBundleInput,
): Promise<{ guards: MissionDay; bundleId: string }> {
  const mission_date = input.mission_date.slice(0, 10);
  const guardWindow = defaultMissionWindow("guards", mission_date);
  const guardStartsAt = input.guard_starts_at ?? guardWindow.startsAt;
  const guardEndsAt = input.guard_ends_at ?? guardWindow.endsAt;
  const bundleId = crypto.randomUUID();
  const status = input.status ?? "draft";
  const preliminary = {
    ...defaultSchedulingForType("guards", guardStartsAt),
    ...input.scheduling,
  };
  const positions = standardMissionPositions({
    missionType: "guards",
    startsAt: guardStartsAt,
    endsAt: guardEndsAt,
    scheduling: preliminary,
  });
  const scheduling = {
    ...guardsScheduling(guardStartsAt, positions, input.scheduling),
    guard_day_bundle_id: bundleId,
  };

  const { mission: guards } = await saveMissionDay({
    title: input.title?.trim() || `${mission_date} · שמירות+עב״ס`,
    mission_type: "guards",
    mission_date,
    starts_at: guardStartsAt,
    ends_at: guardEndsAt,
    status,
    positions,
    assignments: emptyAssignments(positions),
    scheduling_rules: scheduling,
    notes: "יום שמירות — כולל עבודות בסיס כעמדות",
  });

  return { guards, bundleId };
}

export type LinkedBaseWorkConsolidationPlan = {
  positions: MissionDay["positions"];
  assignments: Record<string, string[]>;
  scheduling_rules: MissionSchedulingRules;
  deleteLinkedId: string | null;
};

/**
 * One-time migration: merge legacy linked base_work mission into guards day.
 * Does not regenerate guard/reserve slot structure — that is handled by PUT regenerate only.
 */
export function planLinkedBaseWorkConsolidation(
  guards: MissionDay,
  linked: MissionDay | null,
): LinkedBaseWorkConsolidationPlan | null {
  if (guards.mission_type !== "guards") return null;

  const linkedId = guards.scheduling_rules?.linked_mission_id;
  if (!linkedId) return null;

  let positions = [...(guards.positions || [])];
  let assignments = { ...guards.assignments };

  const hasEmbeddedBaseWork = positions.some((p) => isBaseWorkPosition(p));
  if (!hasEmbeddedBaseWork) {
    if (linked?.mission_type === "base_work") {
      positions.push(...linked.positions.filter((p) => isBaseWorkPosition(p)));
      assignments = { ...assignments, ...linked.assignments };
    } else {
      positions.push(
        ...defaultBaseWorkPositions({
          seatsPerShift: guards.scheduling_rules?.base_work?.seats_per_shift,
        }),
      );
    }
  }
  // When embedded ABAS already exists, keep its assignments — never backfill from linked.

  assignments = syncAssignmentSeats(positions, assignments);

  const scheduling = {
    ...guards.scheduling_rules,
    board_start: effectiveBoardStartLabel({
      starts_at: guards.starts_at,
      positions,
      scheduling_rules: guards.scheduling_rules,
    }),
  };
  delete scheduling.linked_mission_id;

  return {
    positions,
    assignments,
    scheduling_rules: scheduling,
    deleteLinkedId: linked?.mission_type === "base_work" ? linked.id : null,
  };
}

/** ממזג עב״ס מקושר (משימה נפרדת ישנה) לתוך יום השמירות — פעם אחת בלבד. */
export async function consolidateGuardDayMission(
  guards: MissionDay,
): Promise<MissionDay> {
  if (guards.mission_type !== "guards") return guards;

  const linkedId = guards.scheduling_rules?.linked_mission_id;
  if (!linkedId) return guards;

  const linked = await getMissionDay(linkedId);
  const plan = planLinkedBaseWorkConsolidation(guards, linked);
  if (!plan) return guards;

  const { mission: saved } = await saveMissionDay({
    ...guards,
    positions: plan.positions,
    assignments: plan.assignments,
    scheduling_rules: plan.scheduling_rules,
    notes: guards.notes?.includes("עב״ס")
      ? guards.notes
      : "יום שמירות — כולל עבודות בסיס כעמדות",
  });

  if (plan.deleteLinkedId) {
    try {
      await deleteMissionDay(plan.deleteLinkedId);
    } catch {
      // ignore — orphan row is harmless
    }
  }

  return saved;
}

/** @deprecated Use consolidateGuardDayMission — kept for API compatibility */
export async function ensureLinkedBaseWork(
  guards: MissionDay,
): Promise<{ guards: MissionDay; baseWork: MissionDay } | null> {
  if (guards.mission_type !== "guards") return null;
  const consolidated = await consolidateGuardDayMission(guards);
  return { guards: consolidated, baseWork: consolidated };
}

export function missionsInBundle(
  missions: MissionDay[],
  mission: MissionDay,
): MissionDay[] {
  const bundleId = mission.scheduling_rules?.guard_day_bundle_id;
  if (!bundleId) return [mission];
  return missions.filter((m) => m.scheduling_rules?.guard_day_bundle_id === bundleId);
}

/** Scope for smart assign — guards mission includes embedded base work. */
export function linkedGuardDayAssignScope(
  mission: MissionDay,
  allMissions: MissionDay[],
): MissionDay[] {
  if (mission.mission_type === "guards") return [mission];
  const bundle = missionsInBundle(allMissions, mission);
  const guards = bundle.find((m) => m.mission_type === "guards");
  if (guards) return [guards];
  const linkedId = mission.scheduling_rules?.linked_mission_id;
  if (linkedId) {
    const linked = allMissions.find((m) => m.id === linkedId);
    if (linked?.mission_type === "guards") return [linked];
  }
  return [mission];
}
