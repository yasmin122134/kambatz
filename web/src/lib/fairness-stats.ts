import {
  blockFromFlatSlot,
  calculatePersonBurden,
  type BurdenTimelineBlock,
} from "@/lib/guard-burden";
import { flattenMissionSlots, isGuardKind, normalizeSchedulingRules } from "@/lib/mission-utils";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import type {
  FairnessBucket,
  FairnessRules,
  MissionDay,
  MissionPositionKind,
  MissionType,
  PersonFairnessStats,
  PersonMissionHistoryItem,
} from "@/lib/types";
import { slotDurationHours, pointsForHours } from "@/lib/fairness-math";
import { isStandbyKind } from "@/lib/mission-utils";

export function normalizeFairnessRulesFromRaw(raw: unknown): FairnessRules {
  const src = (raw || {}) as Partial<FairnessRules>;
  const out = { ...DEFAULT_FAIRNESS_RULES };
  for (const key of Object.keys(DEFAULT_FAIRNESS_RULES) as (keyof FairnessRules)[]) {
    const v = parseFloat(String(src[key]));
    if (!Number.isNaN(v) && v >= 0) out[key] = v;
  }
  return out;
}

export function bucketForAssignment(
  missionType: MissionType,
  seatCount: number,
  positionKind?: MissionPositionKind,
): FairnessBucket {
  if (positionKind === "standby_carmel_a") return "standby_a";
  if (positionKind === "standby_carmel_b") return "standby_b";
  if (positionKind && isStandbyKind(positionKind)) return "standby";
  if (positionKind === "kitchen") return "kitchen";
  if (positionKind === "duty") return "duty";
  if (missionType === "kitchen") return "kitchen";
  if (missionType === "base_work") return "duty";
  return seatCount <= 1 ? "solo" : "pair";
}

export function collectPersonBlocks(
  personName: string,
  missions: MissionDay[],
): BurdenTimelineBlock[] {
  const blocks: BurdenTimelineBlock[] = [];
  for (const mission of missions) {
    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      blocks.push(blockFromFlatSlot(slot, slot.missionType));
    }
  }
  return blocks;
}

export function collectAssigneeNames(missions: MissionDay[]): string[] {
  const names = new Set<string>();
  for (const mission of missions) {
    for (const slot of flattenMissionSlots(mission)) {
      for (const name of slot.assignees) {
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "he"));
}

export function buildPersonFairnessHistory(
  personName: string,
  missions: MissionDay[],
  rules: FairnessRules,
): PersonMissionHistoryItem[] {
  const blocks = collectPersonBlocks(personName, missions);
  const breakdown = calculatePersonBurden(blocks, rules);
  const guardDetailBySlot = new Map(
    breakdown.guardDetails.map((d) => [d.slotId || "", d]),
  );
  const history: PersonMissionHistoryItem[] = [];

  for (const mission of missions) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      const hours = slotDurationHours(slot.startTime, slot.endTime);
      const bucket = bucketForAssignment(
        mission.mission_type,
        slot.seatCount,
        slot.positionKind,
      );

      if (isGuardKind(slot.positionKind)) {
        const detail = guardDetailBySlot.get(slot.slotId);
        history.push({
          id: `${mission.id}:${slot.slotId}:${personName}`,
          missionId: mission.id,
          missionTitle: mission.title,
          missionDate: mission.mission_date,
          missionType: mission.mission_type,
          positionName: slot.positionName,
          timeLabel: slot.timeLabel,
          hours,
          bucket,
          points: detail?.totalContribution ?? 0,
          burdenBase: detail?.baseBurden,
          burdenRest: detail?.restPenaltyBefore,
          burdenIsSolo: detail?.isSolo,
        });
        continue;
      }

      const kitchenPerShift =
        mission.mission_type === "kitchen" &&
        scheduling.kitchen?.points_per_shift !== false;
      const points = pointsForHours(hours, bucket, rules, {
        perShift: kitchenPerShift,
      });
      history.push({
        id: `${mission.id}:${slot.slotId}:${personName}`,
        missionId: mission.id,
        missionTitle: mission.title,
        missionDate: mission.mission_date,
        missionType: mission.mission_type,
        positionName: slot.positionName,
        timeLabel: slot.timeLabel,
        hours,
        bucket,
        points,
      });
    }
  }

  history.sort(
    (a, b) =>
      b.missionDate.localeCompare(a.missionDate) ||
      b.timeLabel.localeCompare(a.timeLabel),
  );
  return history;
}

export function buildPersonFairnessStatsFromMissions(
  personName: string,
  missions: MissionDay[],
  rules: FairnessRules,
  priorScore = 0,
): PersonFairnessStats {
  const blocks = collectPersonBlocks(personName, missions);
  const breakdown = calculatePersonBurden(blocks, rules);
  const history = buildPersonFairnessHistory(personName, missions, rules);
  const periodPoints = breakdown.totalBurden;
  const totalPoints = Math.round((priorScore + periodPoints) * 100) / 100;

  return {
    rules,
    priorScore,
    periodPoints,
    totalPoints,
    history,
    burden: breakdown,
  };
}

export type StoredFairnessPointRow = {
  person_name: string;
  mission_id: string;
  slot_id: string;
  mission_date: string;
  mission_title: string;
  mission_type: string;
  position_name: string;
  time_label: string;
  hours: number;
  bucket: string;
  points: number;
  burden_base: number | null;
  burden_rest: number | null;
  burden_is_solo: boolean | null;
  computed_at?: string;
};

export function statsFromStoredHistory(
  history: PersonMissionHistoryItem[],
  rules: FairnessRules,
  priorScore: number,
): PersonFairnessStats {
  const periodPoints =
    Math.round(history.reduce((sum, h) => sum + h.points, 0) * 100) / 100;
  const guardBaseBurden =
    Math.round(
      history.reduce((sum, h) => sum + (h.burdenBase ?? 0), 0) * 100,
    ) / 100;
  const restPenalties =
    Math.round(
      history.reduce((sum, h) => sum + (h.burdenRest ?? 0), 0) * 100,
    ) / 100;
  const otherMissionPoints =
    Math.round((periodPoints - guardBaseBurden - restPenalties) * 100) / 100;
  const guardAssignmentCount = history.filter((h) => h.burdenBase != null).length;

  return {
    rules,
    priorScore,
    periodPoints,
    totalPoints: Math.round((priorScore + periodPoints) * 100) / 100,
    history,
    burden: {
      guardBaseBurden,
      restPenalties,
      otherMissionPoints,
      guardAssignmentCount,
      totalBurden: periodPoints,
    },
  };
}
