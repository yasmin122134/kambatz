/**
 * Canonical mission-day timeline.
 *
 * The scheduling day is the mission window (e.g. 09:00 → next 09:00), NOT a
 * calendar 00:00–24:00. All overlap / rest math must use minutes-from-mission-start
 * (or absolute ms derived from that), never HH:MM alone.
 *
 * Example, mission start = D 09:00:
 *   09:00 D     = 0
 *   13:00 D     = 240
 *   17:00 D     = 480
 *   21:00 D     = 720
 *   00:00 D+1   = 900
 *   03:00 D+1   = 1080
 *   06:00 D+1   = 1260
 *   09:00 D+1   = 1440
 *   08:30 D     = -30   (morning ABAS may start slightly before board start)
 */

export type MissionTimelineInterval = {
  startMin: number;
  endMin: number;
};

/** Convert an absolute instant to minutes from mission start. Negative = before the board. */
export function toMissionMinutes(missionStartMs: number, absoluteMs: number): number {
  return (absoluteMs - missionStartMs) / 60_000;
}

export function toMissionTimelineInterval(
  missionStartMs: number,
  startMs: number,
  endMs: number,
): MissionTimelineInterval {
  return {
    startMin: toMissionMinutes(missionStartMs, startMs),
    endMin: toMissionMinutes(missionStartMs, endMs),
  };
}

/** Half-open overlap on the mission timeline. Adjacent intervals do not overlap. */
export function missionIntervalsOverlap(
  a: MissionTimelineInterval,
  b: MissionTimelineInterval,
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Idle minutes between two intervals on the mission timeline.
 * Returns null when they overlap.
 */
export function missionIdleMinutes(
  a: MissionTimelineInterval,
  b: MissionTimelineInterval,
): number | null {
  if (missionIntervalsOverlap(a, b)) return null;
  if (a.endMin <= b.startMin) return b.startMin - a.endMin;
  return a.startMin - b.endMin;
}

/**
 * Guard ↔ ABAS rest: idle minutes must be >= minRestMin (exact equality is valid).
 * Returns true when the pair is legal.
 */
export function guardAbasRestOk(
  guard: MissionTimelineInterval,
  abas: MissionTimelineInterval,
  minRestMin: number,
): boolean {
  if (missionIntervalsOverlap(guard, abas)) return false;
  const idle = missionIdleMinutes(guard, abas);
  if (idle == null) return false;
  return idle + 1e-9 >= minRestMin;
}
