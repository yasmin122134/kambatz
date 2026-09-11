import { applyManualFairnessOverrides } from "@/lib/fairness-persistence";
import {
  buildPersonFairnessStatsFromMissions,
  statsFromStoredHistory,
  type StoredFairnessPointRow,
} from "@/lib/fairness-stats";
import type { FairnessRules, MissionDay } from "@/lib/types";

export type MissionEditorFairnessRow = {
  personName: string;
  /** נקודות שמירה מכל הימים המפורסמים חוץ מתאריך המשימה הנוכחי */
  historyGuardPoints: number;
  /** נקודות צדק (שמירה+תורנות) ביום המשימה הנוכחי בלבד */
  currentPoints: number;
  /** נקודות שמירה ביום הנוכחי */
  currentGuardPoints: number;
  /** סה״כ לאיזון שיבוץ = תקופה מלאה + התאמת ניקוד קודם */
  balancedTotal: number;
  historicalAdjustment: number;
  periodPoints: number;
  toranutPoints: number;
};

export type MissionEditorFairnessResult = {
  rows: MissionEditorFairnessRow[];
  missionDate: string;
  historyMissionDayCount: number;
  currentMissionDayCount: number;
  meanPrior: number;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function splitMissionsForEditorFairness(
  published: MissionDay[],
  current: MissionDay,
): {
  historyMissions: MissionDay[];
  currentDayMissions: MissionDay[];
  allMissions: MissionDay[];
} {
  const dateKey = current.mission_date.slice(0, 10);
  const publishedOtherDays = published.filter(
    (m) => m.mission_date.slice(0, 10) !== dateKey,
  );
  const publishedSameDay = published.filter(
    (m) => m.mission_date.slice(0, 10) === dateKey && m.id !== current.id,
  );
  const currentDayMissions = [...publishedSameDay, current];
  return {
    historyMissions: publishedOtherDays,
    currentDayMissions,
    allMissions: [...publishedOtherDays, ...currentDayMissions],
  };
}

function countDistinctDates(missions: MissionDay[]): number {
  return new Set(missions.map((m) => m.mission_date.slice(0, 10))).size;
}

function personStatsForMissions(
  personName: string,
  missions: MissionDay[],
  rules: FairnessRules,
  priorScore: number,
  manualRows: StoredFairnessPointRow[],
) {
  const live = buildPersonFairnessStatsFromMissions(
    personName,
    missions,
    rules,
    priorScore,
  );
  const history = applyManualFairnessOverrides(
    personName,
    live.history,
    manualRows,
  );
  return statsFromStoredHistory(history, rules, priorScore);
}

export function computeMissionEditorFairness(
  people: { name: string; prior_score?: number }[],
  publishedMissions: MissionDay[],
  currentMission: MissionDay,
  rules: FairnessRules,
  manualRows: StoredFairnessPointRow[] = [],
): MissionEditorFairnessResult {
  const { historyMissions, currentDayMissions, allMissions } =
    splitMissionsForEditorFairness(publishedMissions, currentMission);
  const meanPrior =
    people.reduce((sum, p) => sum + (p.prior_score || 0), 0) /
    (people.length || 1);

  const rows: MissionEditorFairnessRow[] = people.map((person) => {
    const priorScore = person.prior_score || 0;
    const historyStats = personStatsForMissions(
      person.name,
      historyMissions,
      rules,
      0,
      manualRows,
    );
    const currentStats = personStatsForMissions(
      person.name,
      currentDayMissions,
      rules,
      0,
      manualRows,
    );
    const fullStats = personStatsForMissions(
      person.name,
      allMissions,
      rules,
      priorScore,
      manualRows,
    );
    const historicalAdjustment = round1(
      (priorScore - meanPrior) * rules.hist,
    );
    const periodPoints = fullStats.periodPoints;
    const balancedTotal = round1(periodPoints + historicalAdjustment);

    return {
      personName: person.name,
      historyGuardPoints: round1(historyStats.burden?.guardPoints ?? 0),
      currentPoints: round1(currentStats.periodPoints),
      currentGuardPoints: round1(currentStats.burden?.guardPoints ?? 0),
      balancedTotal,
      historicalAdjustment,
      periodPoints: round1(periodPoints),
      toranutPoints: round1(fullStats.burden?.toranutPoints ?? 0),
    };
  });

  return {
    rows,
    missionDate: currentMission.mission_date.slice(0, 10),
    historyMissionDayCount: countDistinctDates(historyMissions),
    currentMissionDayCount: countDistinctDates(currentDayMissions),
    meanPrior: round1(meanPrior),
  };
}
