import {
  fmtTimeLabel,
  parseTimeMinutes,
  wallClockTimesInMission,
} from "@/lib/time-interval";

/** One daily recurring coverage rule — times are local wall-clock HH:MM, half-open [start, end). */
export type DailyStaffingRule = {
  startTime: string;
  endTime: string;
  seats: number;
};

export type StaffingProfile = DailyStaffingRule[];

function ruleContainsWallMinute(rule: DailyStaffingRule, wallMin: number): boolean {
  const start = parseTimeMinutes(rule.startTime);
  const end = parseTimeMinutes(rule.endTime);
  if (start === null || end === null) return false;
  if (end === 1440) return wallMin >= start && wallMin < 1440;
  if (end > start) return wallMin >= start && wallMin < end;
  if (end < start) return wallMin >= start || wallMin < end;
  return false;
}

/** Canonical seat count at an absolute datetime (uses local wall-clock time-of-day). */
export function getRequiredSeats(profile: StaffingProfile, datetimeMs: number): number {
  const d = new Date(datetimeMs);
  const wallMin = d.getHours() * 60 + d.getMinutes();
  for (const rule of profile) {
    if (ruleContainsWallMinute(rule, wallMin)) return rule.seats;
  }
  return 0;
}

export function getRequiredSeatsAtWallMinute(
  profile: StaffingProfile,
  wallMin: number,
): number {
  for (const rule of profile) {
    if (ruleContainsWallMinute(rule, wallMin)) return rule.seats;
  }
  return 0;
}

/** Every wall-clock instant where staffing seat count changes during the mission. */
export function staffingTransitionTimes(
  profile: StaffingProfile,
  missionStartMs: number,
  missionEndMs: number,
): number[] {
  const bounds = new Set<number>([missionStartMs, missionEndMs]);
  const starts = new Set<number>();
  for (const rule of profile) {
    const m = parseTimeMinutes(rule.startTime);
    if (m !== null) starts.add(m);
  }

  for (const wallMin of starts) {
    for (const t of wallClockTimesInMission(wallMin, missionStartMs, missionEndMs)) {
      bounds.add(t);
    }
  }

  return [...bounds].sort((a, b) => a - b);
}

export function constantStaffingSegments(
  profile: StaffingProfile,
  missionStartMs: number,
  missionEndMs: number,
): Array<{ startMs: number; endMs: number; seats: number }> {
  const bounds = staffingTransitionTimes(profile, missionStartMs, missionEndMs);
  const segments: Array<{ startMs: number; endMs: number; seats: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startMs = bounds[i];
    const endMs = bounds[i + 1];
    const seats = getRequiredSeats(profile, startMs);
    segments.push({ startMs, endMs, seats });
  }
  return segments;
}

/** Built-in profiles for standard guard positions (summer). */
export const REAR_GATE_STAFFING_SUMMER: StaffingProfile = [
  { startTime: "06:00", endTime: "18:00", seats: 1 },
  { startTime: "18:00", endTime: "06:00", seats: 2 },
];

export const REAR_GATE_STAFFING_WINTER: StaffingProfile = [
  { startTime: "05:00", endTime: "17:00", seats: 1 },
  { startTime: "17:00", endTime: "05:00", seats: 2 },
];

export const FOOT_PATROL_STAFFING_SUMMER: StaffingProfile = [
  { startTime: "06:00", endTime: "19:00", seats: 1 },
  { startTime: "19:00", endTime: "06:00", seats: 0 },
];

export const FOOT_PATROL_STAFFING_WINTER: StaffingProfile = [
  { startTime: "05:00", endTime: "17:00", seats: 1 },
  { startTime: "17:00", endTime: "05:00", seats: 0 },
];

export function constantStaffingProfile(seats: number): StaffingProfile {
  return [{ startTime: "00:00", endTime: "24:00", seats }];
}

/** Debug text representation of generated slots. */
export function formatSlotDebugLine(
  positionName: string,
  startMs: number,
  endMs: number,
  seats: number,
): string {
  return `${positionName}\n${fmtTimeLabel(startMs)}–${fmtTimeLabel(endMs)} | seats=${seats}`;
}
