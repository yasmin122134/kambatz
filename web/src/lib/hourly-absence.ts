import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  isReserveForceSlot,
  type FlatSlot,
} from "@/lib/mission-utils";
import { assignmentIntervalsOverlap } from "@/lib/scheduling-engine";
import { parseIsoMs } from "@/lib/time-interval";
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

/** חלון שעה לפי תווית ציר הזמן — מיושר ל-boardStartMin וחתוך לחלון המשימה. */
export function hourIntervalForBoardHour(
  anchorMission: MissionDay,
  boardStartMin: number,
  hourIndex: number,
): { startMs: number; endMs: number } {
  const cycleStart = parseIsoMs(anchorMission.starts_at) ?? 0;
  const cycleEnd = parseIsoMs(anchorMission.ends_at) ?? cycleStart + 86_400_000;

  const totalMin = boardStartMin + hourIndex * 60;
  const dayOffset = Math.floor(totalMin / 1440);
  const wallMin = modMinutes(totalMin);
  const d = new Date(anchorMission.starts_at);
  d.setHours(0, 0, 0, 0);
  if (dayOffset) d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(wallMin / 60), wallMin % 60, 0, 0);

  const startMs = Math.max(d.getTime(), cycleStart);
  const endMs = Math.min(d.getTime() + 3600_000, cycleEnd);
  return { startMs, endMs };
}

/** נקודת דגימה באמצע השעה — לבדיקות נקודתיות. */
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
export function isPersonPresentInMissionDuringHour(
  personName: string,
  assignments: PersonSlotAssignment[],
  hourStartMs: number,
  hourEndMs: number,
): boolean {
  const hourIv = { startMs: hourStartMs, endMs: hourEndMs };
  for (const { personName: name, slot } of assignments) {
    if (name !== personName) continue;
    const slotIv = { startMs: slot.startAtMs, endMs: slot.endAtMs };
    if (!assignmentIntervalsOverlap(hourIv, slotIv)) continue;
    if (!isReserveForceSlot(slot)) return true;
  }
  return false;
}

/** @deprecated Use isPersonPresentInMissionDuringHour — kept for tests. */
export function isPersonPresentInMissionAtTime(
  personName: string,
  assignments: PersonSlotAssignment[],
  sampleMs: number,
): boolean {
  return isPersonPresentInMissionDuringHour(
    personName,
    assignments,
    sampleMs - 30 * 60_000,
    sampleMs + 30 * 60_000,
  );
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
    const hourIv = hourIntervalForBoardHour(
      input.anchorMission,
      input.boardStartMin,
      hourIndex,
    );
    const absentNames =
      hourIv.endMs <= hourIv.startMs
        ? [...roster]
        : roster.filter(
            (name) =>
              !isPersonPresentInMissionDuringHour(
                name,
                assignments,
                hourIv.startMs,
                hourIv.endMs,
              ),
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
