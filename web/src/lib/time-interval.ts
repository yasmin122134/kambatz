/** Canonical half-open interval utilities — authoritative for overlap and ordering. */

export type TimeInterval = {
  startMs: number;
  endMs: number;
};

export function parseIsoMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
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

export function fmtTimeLabel(ms: number): string {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function slotDurationMinutes(start: string, end: string): number {
  const a = parseTimeMinutes(start);
  const b = parseTimeMinutes(end);
  if (a === null || b === null) return 0;
  if (b > a) return b - a;
  if (b === a) return 1440;
  return 1440 - a + b;
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
  const fromWall = resolveSlotAbsoluteInterval(
    mission.starts_at,
    mission.ends_at,
    slot.start_time,
    slot.end_time,
  );

  const fromStoredStart = parseIsoMs(slot.starts_at);
  const fromStoredEnd = parseIsoMs(slot.ends_at);
  if (fromStoredStart !== null && fromStoredEnd !== null && fromStoredEnd > fromStoredStart) {
    const storedStartLabel = fmtTimeLabel(fromStoredStart);
    const storedEndLabel = fmtTimeLabel(fromStoredEnd);
    if (storedStartLabel === slot.start_time && storedEndLabel === slot.end_time) {
      return { startMs: fromStoredStart, endMs: fromStoredEnd };
    }
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
  const missionStartMs = parseIsoMs(missionStartsAt);
  const missionEndMs = parseIsoMs(missionEndsAt);
  if (missionStartMs === null || missionEndMs === null) return null;

  const startMin = parseTimeMinutes(startTime);
  if (startMin === null) return null;
  const durMin = slotDurationMinutes(startTime, endTime);
  if (durMin <= 0) return null;

  const baseDate = new Date(missionStartsAt);
  baseDate.setHours(0, 0, 0, 0);
  const baseMs = baseDate.getTime();
  const daySpan = Math.ceil((missionEndMs - missionStartMs) / 86_400_000) + 2;

  for (let dayOffset = -1; dayOffset <= daySpan; dayOffset++) {
    const candidateStart = baseMs + dayOffset * 86_400_000 + startMin * 60_000;
    const candidateEnd = candidateStart + durMin * 60_000;
    if (candidateStart >= missionStartMs && candidateEnd <= missionEndMs) {
      return { startMs: candidateStart, endMs: candidateEnd };
    }
  }

  return null;
}

/** All calendar-day occurrences of a wall-clock minute within (start, end). */
export function wallClockTimesInMission(
  wallMin: number,
  missionStartMs: number,
  missionEndMs: number,
): number[] {
  const out: number[] = [];
  const baseDate = new Date(missionStartMs);
  baseDate.setHours(0, 0, 0, 0);
  const baseMs = baseDate.getTime();
  const daySpan = Math.ceil((missionEndMs - missionStartMs) / 86_400_000) + 2;

  for (let dayOffset = -1; dayOffset <= daySpan; dayOffset++) {
    const t = baseMs + dayOffset * 86_400_000 + wallMin * 60_000;
    if (t > missionStartMs && t < missionEndMs) out.push(t);
  }
  return out;
}

/** Add minutes using local wall-clock arithmetic (handles DST correctly). */
export function addWallClockMinutes(ms: number, minutes: number): number {
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
