import {
  blockFromFlatSlot,
  calculatePersonBurden,
  toranutPointsForMissionBlock,
  type BurdenTimelineBlock,
} from "@/lib/guard-burden";
import { flattenMissionSlots, isGuardKind, normalizeSchedulingRules } from "@/lib/mission-utils";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_FAIRNESS_HOURLY_RATES,
  DEFAULT_GUARD_BANDS,
  DEFAULT_REST_PENALTIES,
  type FairnessBucket,
  type FairnessHourlyRates,
  type FairnessRules,
  type GuardBandRule,
  type MissionDay,
  type MissionPositionKind,
  type MissionType,
  type PersonFairnessStats,
  type PersonMissionHistoryItem,
} from "@/lib/types";
import { slotDurationHours, pointsForHours } from "@/lib/fairness-math";
import { isStandbyKind } from "@/lib/mission-utils";

function parseNonNegativeNumber(value: unknown): number | null {
  const v = parseFloat(String(value));
  if (Number.isNaN(v) || v < 0) return null;
  return v;
}

function normalizeGuardBands(raw: unknown): GuardBandRule[] {
  const fallback = DEFAULT_GUARD_BANDS.map((b) => ({ ...b }));
  if (!Array.isArray(raw)) return fallback;
  return DEFAULT_GUARD_BANDS.map((defaults, i) => {
    const row = raw[i];
    if (!row || typeof row !== "object") return { ...defaults };
    const src = row as Partial<GuardBandRule>;
    const solo = parseNonNegativeNumber(src.solo);
    const paired = parseNonNegativeNumber(src.paired);
    return {
      solo: solo ?? defaults.solo,
      paired: paired ?? defaults.paired,
    };
  });
}

function normalizeRestPenalties(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REST_PENALTIES];
  return DEFAULT_REST_PENALTIES.map((defaults, i) => {
    const v = parseNonNegativeNumber(raw[i]);
    return v ?? defaults;
  });
}

function normalizeHourlyRates(raw: unknown): FairnessHourlyRates {
  const base = { ...DEFAULT_FAIRNESS_HOURLY_RATES };
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Partial<FairnessHourlyRates>;
  return {
    guard: parseNonNegativeNumber(src.guard) ?? base.guard,
    guard_night: parseNonNegativeNumber(src.guard_night) ?? base.guard_night,
    observation: parseNonNegativeNumber(src.observation) ?? base.observation,
    base_work: parseNonNegativeNumber(src.base_work) ?? base.base_work,
    standby_a: parseNonNegativeNumber(src.standby_a) ?? base.standby_a,
    standby_b: parseNonNegativeNumber(src.standby_b) ?? base.standby_b,
    kitchen: parseNonNegativeNumber(src.kitchen) ?? base.kitchen,
    reserve_force: parseNonNegativeNumber(src.reserve_force) ?? base.reserve_force,
  };
}

export function normalizeFairnessRulesFromRaw(raw: unknown): FairnessRules {
  const src = (raw || {}) as Partial<FairnessRules>;
  const out: FairnessRules = {
    ...DEFAULT_FAIRNESS_RULES,
    guard_bands: normalizeGuardBands(src.guard_bands),
    rest_penalties: normalizeRestPenalties(src.rest_penalties),
    hourly_rates: normalizeHourlyRates(src.hourly_rates),
  };
  for (const key of Object.keys(DEFAULT_FAIRNESS_RULES) as (keyof FairnessRules)[]) {
    if (key === "guard_bands" || key === "rest_penalties" || key === "hourly_rates") continue;
    const v = parseNonNegativeNumber(src[key]);
    if (v !== null) out[key] = v;
  }
  return out;
}

function guardBandsEqual(a: GuardBandRule[], b: GuardBandRule[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.solo === b[i].solo && row.paired === b[i].paired)
  );
}

function numberArraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function hourlyRatesEqual(a: FairnessHourlyRates, b: FairnessHourlyRates): boolean {
  return (
    a.guard === b.guard &&
    a.guard_night === b.guard_night &&
    a.observation === b.observation &&
    a.base_work === b.base_work &&
    a.standby_a === b.standby_a &&
    a.standby_b === b.standby_b &&
    a.kitchen === b.kitchen &&
    a.reserve_force === b.reserve_force
  );
}

export function fairnessRulesChanged(current: FairnessRules, proposed: FairnessRules): boolean {
  for (const key of Object.keys(DEFAULT_FAIRNESS_RULES) as (keyof FairnessRules)[]) {
    if (key === "guard_bands") {
      if (!guardBandsEqual(current.guard_bands, proposed.guard_bands)) return true;
      continue;
    }
    if (key === "rest_penalties") {
      if (!numberArraysEqual(current.rest_penalties, proposed.rest_penalties)) return true;
      continue;
    }
    if (key === "hourly_rates") {
      if (!hourlyRatesEqual(current.hourly_rates, proposed.hourly_rates)) return true;
      continue;
    }
    if (current[key] !== proposed[key]) return true;
  }
  return false;
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

      const block = blockFromFlatSlot(slot, slot.missionType);
      const points = toranutPointsForMissionBlock(block, rules, scheduling);
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
  const kitchenPoints = Math.round(
    history.filter((h) => h.bucket === "kitchen").reduce((sum, h) => sum + h.points, 0) * 100,
  ) / 100;
  const guardPoints = Math.round((periodPoints - kitchenPoints) * 100) / 100;
  const toranutPoints = kitchenPoints;
  const fairnessPoints = periodPoints;
  const dutyPoints = guardPoints;
  const otherMissionPoints = Math.round(
    (guardPoints - guardBaseBurden - restPenalties) * 100,
  ) / 100;
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
      kitchenPoints,
      guardPoints,
      toranutPoints,
      fairnessPoints,
      dutyPoints,
      guardAssignmentCount,
      totalBurden: periodPoints,
    },
  };
}
