import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  isReserveForceSlot,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";

export type HourlyAbsenceView = {
  hourIndex: number;
  cyclicStartMin: number;
  wallTimeLabel: string;
  absentNames: string[];
  presentCount: number;
  rosterSize: number;
};

type PersonSlotAssignment = { personName: string; slot: FlatSlot };

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "he");
}

function modMinutes(total: number): number {
  return ((total % 1440) + 1440) % 1440;
}

export function formatHourWallTime(boardStartMin: number, hourIndex: number): string {
  const wallMin = modMinutes(boardStartMin + hourIndex * 60);
  const h = Math.floor(wallMin / 60);
  const m = wallMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** נקודת דגימה באמצע השעה — לבדיקת נוכחות במשימה. */
export function hourSampleMs(
  anchorMission: MissionDay,
  boardStartMin: number,
  hourIndex: number,
): number {
  const totalMin = boardStartMin + hourIndex * 60;
  const dayOffset = Math.floor(totalMin / 1440);
  const wallMin = modMinutes(totalMin);
  const h = Math.floor(wallMin / 60);
  const m = wallMin % 60;
  const d = new Date(anchorMission.starts_at);
  d.setHours(0, 0, 0, 0);
  if (dayOffset) d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m + 30, 0, 0);
  return d.getTime();
}

export function buildPersonSlotAssignments(
  missions: MissionDay[],
  boardStartMin: number,
): PersonSlotAssignment[] {
  const out: PersonSlotAssignment[] = [];
  for (const mission of missions) {
    const t0 =
      mission.mission_type === "guards" ? boardStartMin : effectiveBoardStartMin(mission);
    for (const slot of flattenMissionSlots(mission, t0)) {
      for (const raw of slot.assignees) {
        const personName = raw.trim();
        if (personName) out.push({ personName, slot });
      }
    }
  }
  return out;
}

/** נוכח במשימה = שיבוץ שאינו כוח עתודה בלבד (עתודה+משהו במקביל = נוכח). */
export function isPersonPresentInMissionAtTime(
  personName: string,
  assignments: PersonSlotAssignment[],
  sampleMs: number,
): boolean {
  for (const { personName: name, slot } of assignments) {
    if (name !== personName) continue;
    if (sampleMs < slot.startAtMs || sampleMs >= slot.endAtMs) continue;
    if (!isReserveForceSlot(slot)) return true;
  }
  return false;
}

export function hourlyAbsenceViews(input: {
  missions: MissionDay[];
  rosterNames: string[];
  anchorMission: MissionDay;
  boardStartMin: number;
  hours?: number;
}): HourlyAbsenceView[] {
  const roster = [...new Set(input.rosterNames.map((n) => n.trim()).filter(Boolean))].sort(
    compareNames,
  );
  const assignments = buildPersonSlotAssignments(input.missions, input.boardStartMin);
  const hours = input.hours ?? 24;
  const views: HourlyAbsenceView[] = [];

  for (let hourIndex = 0; hourIndex < hours; hourIndex++) {
    const sampleMs = hourSampleMs(input.anchorMission, input.boardStartMin, hourIndex);
    const absentNames = roster.filter(
      (name) => !isPersonPresentInMissionAtTime(name, assignments, sampleMs),
    );
    views.push({
      hourIndex,
      cyclicStartMin: hourIndex * 60,
      wallTimeLabel: formatHourWallTime(input.boardStartMin, hourIndex),
      absentNames,
      presentCount: roster.length - absentNames.length,
      rosterSize: roster.length,
    });
  }

  return views;
}
