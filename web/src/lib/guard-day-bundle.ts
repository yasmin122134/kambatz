import {
  defaultBaseWorkPositions,
  isBaseWorkPosition,
  materializeBaseWorkPositions,
} from "@/lib/base-work-template";
import {
  defaultMissionWindow,
  defaultSchedulingForType,
  finalizeGuardMissionPositions,
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

export const DEFAULT_DUTY_GUARD_GAP_MINUTES = 70;

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

/** ממזג עב״ס מקושר (משימה נפרדת ישנה) לתוך יום השמירות. */
export async function consolidateGuardDayMission(
  guards: MissionDay,
): Promise<MissionDay> {
  if (guards.mission_type !== "guards") return guards;

  let positions = [...(guards.positions || [])];
  let assignments = { ...guards.assignments };
  const linkedId = guards.scheduling_rules?.linked_mission_id;
  let linked: MissionDay | null = null;
  if (linkedId) {
    linked = await getMissionDay(linkedId);
  }

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
  } else if (linked?.mission_type === "base_work") {
    for (const pos of linked.positions.filter((p) => isBaseWorkPosition(p))) {
      const existing = positions.find((p) => isBaseWorkPosition(p));
      if (existing) {
        for (const [slotId, seats] of Object.entries(linked.assignments)) {
          if (!assignments[slotId]?.some(Boolean)) {
            assignments[slotId] = seats;
          }
        }
      }
    }
  }

  positions = finalizeGuardMissionPositions(positions, {
    missionDate: guards.mission_date,
    startsAt: guards.starts_at,
    endsAt: guards.ends_at,
    scheduling: guards.scheduling_rules,
  });
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

  const { mission: saved } = await saveMissionDay({
    ...guards,
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: guards.notes?.includes("עב״ס") ? guards.notes : "יום שמירות — כולל עבודות בסיס כעמדות",
  });

  if (linked?.mission_type === "base_work") {
    try {
      await deleteMissionDay(linked.id);
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
