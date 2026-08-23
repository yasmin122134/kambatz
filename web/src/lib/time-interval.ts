/** Canonical half-open interval utilities — authoritative for overlap and ordering. */

/** Wall-clock labels for missions/slots are always Israel local time. */
export const MISSION_WALL_TZ = "Asia/Jerusalem";

export type TimeInterval = {
  startMs: number;
  endMs: number;
};

export function parseIsoMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function normalizeTimeLabel(s: string): string {
  const m = parseTimeMinutes(s);
  if (m === null) return String(s || "").trim();
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseTimeMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h === 24 && min === 0) return 1440;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function fmtTimeLabel(ms: number, timeZone = MISSION_WALL_TZ): string {
  return fmtMissionTimeLabel(ms, timeZone);
}

export function missionWallMinutes(ms: number, timeZone = MISSION_WALL_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = +(parts.find((p) => p.type === "hour")?.value ?? 0);
  const min = +(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + min;
}

/** Add minutes on the mission wall clock (always Israel local time). */
export function addWallClockMinutes(
  ms: number,
  minutes: number,
  timeZone = MISSION_WALL_TZ,
): number {
  const midnight = localMissionMidnightMs(ms, timeZone);
  const dayOffset = Math.floor((ms - midnight) / 86_400_000);
  const wallMin = missionWallMinutes(ms, timeZone);
  const total = wallMin + minutes;
  const extraDays = Math.floor(total / 1440);
  const normalized = ((total % 1440) + 1440) % 1440;
  return midnight + (dayOffset + extraDays) * 86_400_000 + normalized * 60_000;
}

export function fmtMissionTimeLabel(ms: number, timeZone = MISSION_WALL_TZ): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const min = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${min.padStart(2, "0")}`;
}

/** Local calendar midnight for the instant's date in the mission wall timezone. */
export function localMissionMidnightMs(ms: number, timeZone = MISSION_WALL_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = +(parts.find((p) => p.type === "hour")?.value ?? 0);
  const min = +(parts.find((p) => p.type === "minute")?.value ?? 0);
  const sec = +(parts.find((p) => p.type === "second")?.value ?? 0);
  const msPart = new Date(ms).getMilliseconds();
  return ms - ((h * 60 + min) * 60_000 + sec * 1000 + msPart);
}

export function slotDurationMinutes(start: string, end: string): number {
  const a = parseTimeMinutes(start);
  const b = parseTimeMinutes(end);
  if (a === null || b === null) return 0;
  if (b > a) return b - a;
  if (b === a) return 1440;
  return 1440 - a + b;
}

/** YYYY-MM-DD offset from a mission calendar date. */
export function addCalendarDays(dateStr: string, days: number): string {
  const date = dateStr.slice(0, 10);
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Absolute [start, end) for a wall-clock window on a specific calendar date (Israel). */
export function wallClockIntervalOnCalendarDate(
  dateStr: string,
  startTime: string,
  endTime: string,
): TimeInterval | null {
  const date = dateStr.slice(0, 10);
  const startMin = parseTimeMinutes(normalizeTimeLabel(startTime));
  const durMin = slotDurationMinutes(startTime, endTime);
  if (startMin === null || durMin <= 0) return null;

  const anchor = parseIsoMs(`${date}T12:00:00+03:00`);
  if (anchor === null) return null;

  const midnight = localMissionMidnightMs(anchor);
  const startMs = midnight + startMin * 60_000;
  const endMs = startMs + durMin * 60_000;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Half-open overlap: [start, end) — adjacent intervals do NOT overlap. */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Conflict including a minimum gap (minutes) between intervals.
 * Used for duty↔guard spacing — expands each interval by gapMin on both sides.
 */
export function intervalsConflictWithGap(
  a: TimeInterval,
  b: TimeInterval,
  gapMin: number,
): boolean {
  if (gapMin <= 0) return intervalsOverlap(a, b);
  const gapMs = gapMin * 60_000;
  return (
    a.startMs - gapMs < b.endMs &&
    b.startMs - gapMs < a.endMs
  );
}

export function intervalDurationMinutes(interval: TimeInterval): number {
  return Math.max(0, (interval.endMs - interval.startMs) / 60_000);
}

export function missionInterval(startsAt: string, endsAt: string): TimeInterval | null {
  const startMs = parseIsoMs(startsAt);
  const endMs = parseIsoMs(endsAt);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Single conversion boundary: persisted slot → absolute interval.
 * Prefers canonical slot.starts_at / slot.ends_at when consistent with wall-clock labels.
 */
export function resolveCanonicalSlotInterval(
  mission: { starts_at: string; ends_at: string },
  slot: { start_time: string; end_time: string; starts_at?: string; ends_at?: string },
): TimeInterval | null {
  const startTime = normalizeTimeLabel(slot.start_time);
  const endTime = normalizeTimeLabel(slot.end_time);
  const fromWall = resolveSlotAbsoluteInterval(
    mission.starts_at,
    mission.ends_at,
    startTime,
    endTime,
  );

  const missionIv = missionInterval(mission.starts_at, mission.ends_at);
  const fromStoredStart = parseIsoMs(slot.starts_at);
  const fromStoredEnd = parseIsoMs(slot.ends_at);
  if (
    missionIv &&
    fromStoredStart !== null &&
    fromStoredEnd !== null &&
    fromStoredEnd > fromStoredStart &&
    fromStoredStart >= missionIv.startMs &&
    fromStoredEnd <= missionIv.endMs
  ) {
    return { startMs: fromStoredStart, endMs: fromStoredEnd };
  }

  return fromWall;
}

/** Persist canonical ISO bounds on a slot from an absolute interval. */
export function materializeSlotAbsoluteBounds(
  slot: { start_time: string; end_time: string; starts_at?: string; ends_at?: string },
  interval: TimeInterval,
): { starts_at: string; ends_at: string } {
  return {
    starts_at: new Date(interval.startMs).toISOString(),
    ends_at: new Date(interval.endMs).toISOString(),
  };
}

/** Map a wall-clock HH:MM label to the absolute instant within a mission window. */
export function resolveSlotAbsoluteInterval(
  missionStartsAt: string,
  missionEndsAt: string,
  startTime: string,
  endTime: string,
): TimeInterval | null {
  const missionIv = missionInterval(missionStartsAt, missionEndsAt);
  if (!missionIv) return null;
  const { startMs: missionStartMs, endMs: missionEndMs } = missionIv;

  const startLabel = normalizeTimeLabel(startTime);
  const endLabel = normalizeTimeLabel(endTime);
  const startMin = parseTimeMinutes(startLabel);
  if (startMin === null) return null;

  // Carmel / full-mission convention: identical labels mean the entire mission window.
  if (startLabel === endLabel) {
    return { startMs: missionStartMs, endMs: missionEndMs };
  }

  const endMin = parseTimeMinutes(endLabel);
  const durMin = slotDurationMinutes(startLabel, endLabel);
  if (durMin <= 0 || endMin === null) return null;

  const missionStartLabel = fmtMissionTimeLabel(missionStartMs);
  const missionEndLabel = fmtMissionTimeLabel(missionEndMs);

  // Day shift anchored at mission start (officer duty first half, etc.).
  if (startLabel === missionStartLabel && endLabel !== missionEndLabel) {
    const candidateEnd = missionStartMs + durMin * 60_000;
    if (candidateEnd <= missionEndMs) {
      return { startMs: missionStartMs, endMs: candidateEnd };
    }
  }

  // Full mission span when wall labels match mission boundaries (e.g. 09:00→09:00 next day).
  if (
    startLabel === missionStartLabel &&
    endLabel === missionEndLabel &&
    Math.abs(durMin - (missionEndMs - missionStartMs) / 60_000) <= 1
  ) {
    return { startMs: missionStartMs, endMs: missionEndMs };
  }

  // Overnight slot ending at mission end (e.g. officer duty 21:00–09:00 on a 09:00→09:00 mission).
  if (endLabel === missionEndLabel && endMin <= startMin) {
    const candidateEnd = missionEndMs;
    const candidateStart = candidateEnd - durMin * 60_000;
    if (candidateStart >= missionStartMs) {
      return { startMs: candidateStart, endMs: candidateEnd };
    }
  }

  const baseMs = localMissionMidnightMs(missionStartMs);
  const daySpan = Math.ceil((missionEndMs - missionStartMs) / 86_400_000) + 2;

  let clipped: TimeInterval | null = null;
  for (let dayOffset = -1; dayOffset <= daySpan; dayOffset++) {
    const candidateStart = baseMs + dayOffset * 86_400_000 + startMin * 60_000;
    const candidateEnd = candidateStart + durMin * 60_000;
    if (candidateEnd <= missionStartMs || candidateStart >= missionEndMs) continue;
    if (candidateStart >= missionStartMs && candidateEnd <= missionEndMs) {
      return { startMs: candidateStart, endMs: candidateEnd };
    }
    if (!clipped) {
      const clippedStart = Math.max(candidateStart, missionStartMs);
      const clippedEnd = Math.min(candidateEnd, missionEndMs);
      if (clippedEnd > clippedStart) {
        clipped = { startMs: clippedStart, endMs: clippedEnd };
      }
    }
  }

  return clipped;
}

/** All calendar-day occurrences of a wall-clock minute within (start, end). */
export function wallClockTimesInMission(
  wallMin: number,
  missionStartMs: number,
  missionEndMs: number,
  timeZone = MISSION_WALL_TZ,
): number[] {
  const out: number[] = [];
  const startMidnight = localMissionMidnightMs(missionStartMs, timeZone);
  const daySpan = Math.ceil((missionEndMs - missionStartMs) / 86_400_000) + 2;

  for (let dayOffset = -1; dayOffset <= daySpan; dayOffset++) {
    const midnight = startMidnight + dayOffset * 86_400_000;
    const t = midnight + wallMin * 60_000;
    if (t > missionStartMs && t < missionEndMs) out.push(t);
  }
  return out;
}

/** Add minutes using local wall-clock arithmetic (handles DST correctly). */
export function addWallClockMinutesLegacyLocal(ms: number, minutes: number): number {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() + minutes);
  return d.getTime();
}

export function nominalShiftBoundaries(
  missionStartMs: number,
  missionEndMs: number,
  shiftMin: number,
): number[] {
  const bounds = new Set<number>([missionStartMs, missionEndMs]);
  let t = missionStartMs;
  while (t < missionEndMs) {
    const next = addWallClockMinutes(t, shiftMin);
    if (next <= t) break;
    if (next < missionEndMs) bounds.add(next);
    t = next;
  }
  return [...bounds].sort((a, b) => a - b);
}
