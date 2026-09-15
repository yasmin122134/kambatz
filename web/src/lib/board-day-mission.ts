import type { MissionDay, MissionType } from "@/lib/types";

export function resolveBoardDate(
  missions: MissionDay[],
  initialDate?: string,
  focusMissionId?: string,
): string {
  const dates = [...new Set(missions.map((m) => m.mission_date.slice(0, 10)))].sort();
  if (focusMissionId) {
    const focus = missions.find((m) => m.id === focusMissionId);
    const focusDate = focus?.mission_date.slice(0, 10);
    if (focusDate && dates.includes(focusDate)) return focusDate;
  }
  const wanted = initialDate?.slice(0, 10);
  if (wanted && dates.includes(wanted)) return wanted;
  return dates[0] || "";
}

function filledSeatCount(mission: MissionDay): number {
  return Object.values(mission.assignments || {}).reduce(
    (sum, seats) => sum + (seats || []).filter(Boolean).length,
    0,
  );
}

/** Prefer the focused mission, then the roster that actually has names. */
export function pickTypedDayMission(
  dayMissions: MissionDay[],
  type: MissionType,
  focusMissionId?: string,
): MissionDay | undefined {
  const ofType = dayMissions.filter((m) => m.mission_type === type);
  if (!ofType.length) return undefined;
  if (focusMissionId) {
    const focused = ofType.find((m) => m.id === focusMissionId);
    if (focused) return focused;
  }
  return [...ofType].sort(
    (a, b) => filledSeatCount(b) - filledSeatCount(a) || a.id.localeCompare(b.id),
  )[0];
}
