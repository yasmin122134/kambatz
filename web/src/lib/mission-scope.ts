import type { MissionDay } from "@/lib/types";

/** Distinct calendar dates (mission_date) included in a burden calculation. */
export function countDistinctMissionDates(missions: MissionDay[]): number {
  const dates = new Set<string>();
  for (const mission of missions) {
    const date = mission.mission_date?.slice(0, 10);
    if (date) dates.add(date);
  }
  return dates.size;
}

export function missionDayScopeLabel(count: number): string {
  if (count <= 0) return "אין ימי משימה";
  if (count === 1) return "מבוסס על יום משימה אחד";
  return `מבוסס על ${count} ימי משימה`;
}

export function missionDayScopeShort(count: number): string {
  if (count <= 0) return "0 ימי משימה";
  if (count === 1) return "יום משימה אחד";
  return `${count} ימי משימה`;
}
