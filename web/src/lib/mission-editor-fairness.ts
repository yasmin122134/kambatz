import { applyManualFairnessOverrides } from "@/lib/fairness-persistence";
import {
  buildPersonFairnessStatsFromMissions,
  statsFromStoredHistory,
  type StoredFairnessPointRow,
} from "@/lib/fairness-stats";
import type { FairnessRules, MissionDay } from "@/lib/types";

export type MissionEditorFairnessRow = {
  personName: string;
  /** נקודות צדק מימים מפורסמים אחרים */
  historyPoints: number;
  /** נקודות שמירה בהיסטוריה (פירוט) */
  historyGuardPoints: number;
  /** נקודות צדק ביום המשימה הנוכחי בלבד */
  currentPoints: number;
  /** נקודות שמירה ביום הנוכחי */
  currentGuardPoints: number;
  /** היסטוריה + היום */
  balancedTotal: number;
  periodPoints: number;
  toranutPoints: number;
};

export type MissionEditorFairnessResult = {
  rows: MissionEditorFairnessRow[];
  missionDate: string;
  historyMissionDayCount: number;
  currentMissionDayCount: number;
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
  manualRows: StoredFairnessPointRow[],
) {
  const live = buildPersonFairnessStatsFromMissions(
    personName,
    missions,
    rules,
    0,
  );
  const history = applyManualFairnessOverrides(
    personName,
    live.history,
    manualRows,
  );
  return statsFromStoredHistory(history, rules, 0);
}

export function computeMissionEditorFairness(
  people: { name: string; prior_score?: number }[],
  publishedMissions: MissionDay[],
  currentMission: MissionDay,
  rules: FairnessRules,
  manualRows: StoredFairnessPointRow[] = [],
): MissionEditorFairnessResult {
  const { historyMissions, currentDayMissions } =
    splitMissionsForEditorFairness(publishedMissions, currentMission);

  const rows: MissionEditorFairnessRow[] = people.map((person) => {
    const historyStats = personStatsForMissions(
      person.name,
      historyMissions,
      rules,
      manualRows,
    );
    const currentStats = personStatsForMissions(
      person.name,
      currentDayMissions,
      rules,
      manualRows,
    );
    const historyPoints = round1(historyStats.periodPoints);
    const currentPoints = round1(currentStats.periodPoints);
    const balancedTotal = round1(historyPoints + currentPoints);

    return {
      personName: person.name,
      historyPoints,
      historyGuardPoints: round1(historyStats.burden?.guardPoints ?? 0),
      currentPoints,
      currentGuardPoints: round1(currentStats.burden?.guardPoints ?? 0),
      balancedTotal,
      periodPoints: balancedTotal,
      toranutPoints: round1(
        (historyStats.burden?.toranutPoints ?? 0) +
          (currentStats.burden?.toranutPoints ?? 0),
      ),
    };
  });

  return {
    rows,
    missionDate: currentMission.mission_date.slice(0, 10),
    historyMissionDayCount: countDistinctDates(historyMissions),
    currentMissionDayCount: countDistinctDates(currentDayMissions),
  };
}
