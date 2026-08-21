import type { MissionPosition, MissionPositionKind, MissionSlot } from "@/lib/types";

function uid() {
  return crypto.randomUUID();
}

export function parseTimeMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

function fmtTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** HH:MM מתאריך ISO (שעון מקומי) */
export function isoToTimeLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtTime(d.getHours() * 60 + d.getMinutes());
}

/** חלון כוננות כרמל — מתחילת יום המשימה עד סופו */
export function carmelSlotFromMission(
  missionStartsAt?: string,
  missionEndsAt?: string,
  boardStart?: string,
  seats = 3,
): MissionSlot {
  const start = isoToTimeLabel(missionStartsAt) ?? boardStart ?? "20:00";
  const end = isoToTimeLabel(missionEndsAt) ?? start;
  return newSlot(start, end, seats);
}

function newPosition(
  name: string,
  opts?: {
    kind?: MissionPositionKind;
    same_room?: boolean;
    same_gender?: boolean;
    slots?: MissionSlot[];
  },
): MissionPosition {
  const kind = opts?.kind;
  const isCarmel = kind === "standby_carmel_a" || kind === "standby_carmel_b";
  return {
    id: uid(),
    name,
    kind,
    same_room: opts?.same_room ?? isCarmel,
    same_gender: opts?.same_gender ?? isCarmel,
    slots: opts?.slots || [newSlot()],
  };
}

/** חלונות משמרת מאוחדים לכל העמדות — אותם זמני חילוף (כולל סנכרון בתחילת היום) */
export type GuardShiftWindow = { startMin: number; endMin: number };

function addWallClockBounds(
  bounds: Set<number>,
  boardMin: number,
  cycleEnd: number,
  wallTime: string,
  shiftMin?: number,
): void {
  const wall = parseTimeMinutes(wallTime);
  if (wall === null) return;

  const boardWall = wallMin(boardMin);
  let firstAbs = boardMin - boardWall + wall;
  if (firstAbs <= boardMin) firstAbs += 1440;

  for (let anchor = firstAbs; anchor < cycleEnd; anchor += 1440) {
    bounds.add(anchor);
    if (shiftMin == null) continue;
    for (let t = anchor - shiftMin; t > boardMin; t -= shiftMin) {
      bounds.add(t);
    }
    for (let t = anchor + shiftMin; t < cycleEnd; t += shiftMin) {
      bounds.add(t);
    }
  }
}

/** עוגן קבוע לרשת משמרות — יום שמתחיל ב-08:00 הוא המצב הייחוס */
export const CANONICAL_GUARD_GRID_START = "08:00";

function collectWallBoundsFromGrid(
  boardMin: number,
  cycleEnd: number,
  shiftHours: number,
  dayNightSplit: string,
  extraWallBounds: string[],
): Set<number> {
  const shiftMin = Math.max(60, Math.round(shiftHours * 60));
  const bounds = new Set<number>([boardMin, cycleEnd]);

  addWallClockBounds(bounds, boardMin, cycleEnd, dayNightSplit, shiftMin);
  for (const wall of extraWallBounds) {
    if (wall === dayNightSplit) continue;
    addWallClockBounds(bounds, boardMin, cycleEnd, wall);
  }

  return bounds;
}

/** שעות שעון (wall) של כל גבולות הרשת ביום ייחוס שמתחיל ב-08:00 */
function canonicalWallBoundaries(
  shiftHours: number,
  dayNightSplit: string,
  extraWallBounds: string[],
): number[] {
  const refBoardMin = parseTimeMinutes(CANONICAL_GUARD_GRID_START) ?? 8 * 60;
  const refEnd = refBoardMin + 1440;
  const bounds = collectWallBoundsFromGrid(
    refBoardMin,
    refEnd,
    shiftHours,
    dayNightSplit,
    extraWallBounds,
  );

  const walls = new Set<number>();
  for (const abs of bounds) {
    walls.add(wallMin(abs));
  }
  return [...walls];
}

export function buildUnifiedGuardShiftWindows(
  boardStart: string,
  cycleMin: number,
  shiftHours: number,
  dayNightSplit = "18:00",
  extraWallBounds: string[] = [],
): GuardShiftWindow[] {
  if (!dayNightSplit && extraWallBounds.length === 0) {
    return buildPureFourHourShiftWindows(boardStart, cycleMin, shiftHours);
  }

  const boardMin = parseTimeMinutes(boardStart) ?? 20 * 60;
  const cycleEnd = boardMin + cycleMin;
  const bounds = new Set<number>([boardMin, cycleEnd]);

  // רשת הייחוס (08:00) — המשמרת הראשונה ממלאת עד הגבול הבא, ואז כולם מסונכרנים
  const canonicalWalls = canonicalWallBoundaries(shiftHours, dayNightSplit, extraWallBounds);
  const boardWall = wallMin(boardMin);

  for (const wall of canonicalWalls) {
    let abs = boardMin - boardWall + wall;
    if (abs < boardMin) abs += 1440;
    while (abs < cycleEnd) {
      if (abs > boardMin && abs < cycleEnd) bounds.add(abs);
      abs += 1440;
    }
  }

  const sorted = [...bounds].sort((a, b) => a - b);
  const windows: GuardShiftWindow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] > sorted[i]) {
      windows.push({ startMin: sorted[i], endMin: sorted[i + 1] });
    }
  }
  return windows;
}

/** רשת משמרות 4 שעות בלבד — עוגן 08:00, בלי פיצולי יום/לילה גלובליים */
export function buildPureFourHourShiftWindows(
  boardStart: string,
  cycleMin: number,
  shiftHours: number,
): GuardShiftWindow[] {
  const boardMin = parseTimeMinutes(boardStart) ?? 20 * 60;
  const cycleEnd = boardMin + cycleMin;
  const shiftMin = Math.max(60, Math.round(shiftHours * 60));
  const refStart = parseTimeMinutes(CANONICAL_GUARD_GRID_START) ?? 8 * 60;
  const bounds = new Set<number>([boardMin, cycleEnd]);
  const boardWall = wallMin(boardMin);

  for (let step = 0; step < 1440; step += shiftMin) {
    const wall = wallMin(refStart + step);
    let abs = boardMin - boardWall + wall;
    if (abs <= boardMin) abs += 1440;
    while (abs < cycleEnd) {
      if (abs > boardMin && abs < cycleEnd) bounds.add(abs);
      abs += 1440;
    }
  }

  const sorted = [...bounds].sort((a, b) => a - b);
  const windows: GuardShiftWindow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] > sorted[i]) {
      windows.push({ startMin: sorted[i], endMin: sorted[i + 1] });
    }
  }
  return windows;
}

/** פיצול חלון בודד בגבול שעון (לש״ג אחורי / רגלי בלבד) */
function splitWindowsAtWallClock(
  windows: GuardShiftWindow[],
  wallClockMin: number,
): GuardShiftWindow[] {
  const out: GuardShiftWindow[] = [];
  for (const w of windows) {
    const ws = wallMin(w.startMin);
    const we = wallMin(w.endMin);
    if (we <= ws) {
      out.push(w);
      continue;
    }
    if (wallClockMin <= ws || wallClockMin >= we) {
      out.push(w);
      continue;
    }
    const splitAbs = w.startMin + (wallClockMin - ws);
    if (splitAbs <= w.startMin || splitAbs >= w.endMin) {
      out.push(w);
      continue;
    }
    out.push({ startMin: w.startMin, endMin: splitAbs });
    out.push({ startMin: splitAbs, endMin: w.endMin });
  }
  return out;
}

function wallMin(absMin: number): number {
  return ((absMin % 1440) + 1440) % 1440;
}

function slotsFromWindows(
  windows: GuardShiftWindow[],
  seatsFor: (w: GuardShiftWindow) => number,
  keepZeroSeats = false,
  maxSlotMinutes?: number,
): MissionSlot[] {
  const raw = windows
    .map((w) => ({ w, seats: seatsFor(w) }))
    .filter((x) => keepZeroSeats || x.seats > 0)
    .map(({ w, seats }) => newSlot(fmtTime(w.startMin), fmtTime(w.endMin), seats));
  if (!maxSlotMinutes) return raw;
  return mergeAdjacentGuardSlots(raw, maxSlotMinutes);
}

/**
 * מאחד משמרות רצופות עם אותו מספר מאיישים כשסך הזמן ≤ maxSlotMinutes.
 * למשל 06:00–08:00 + 08:00–09:00 (סולו) → 06:00–09:00.
 */
export function mergeAdjacentGuardSlots(
  slots: MissionSlot[],
  maxSlotMinutes: number,
): MissionSlot[] {
  if (slots.length < 2) return slots;

  const sorted = [...slots].sort((a, b) => {
    const sa = parseTimeMinutes(a.start_time) ?? 0;
    const sb = parseTimeMinutes(b.start_time) ?? 0;
    return sa - sb || a.end_time.localeCompare(b.end_time);
  });

  const out: MissionSlot[] = [];
  let cur: MissionSlot = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const curEnd = parseTimeMinutes(cur.end_time);
    const nextStart = parseTimeMinutes(next.start_time);
    if (curEnd === null || nextStart === null) {
      out.push(cur);
      cur = { ...next };
      continue;
    }

    const curDur = slotDurationMinutes(cur.start_time, cur.end_time);
    const nextDur = slotDurationMinutes(next.start_time, next.end_time);
    const contiguous = curEnd === nextStart;
    const sameSeats = cur.seat_count > 0 && cur.seat_count === next.seat_count;
    const combined = curDur + nextDur;

    if (contiguous && sameSeats && combined <= maxSlotMinutes) {
      cur = { ...cur, end_time: next.end_time };
    } else {
      out.push(cur);
      cur = { ...next };
    }
  }
  out.push(cur);
  return out;
}

function slotDurationMinutes(start: string, end: string): number {
  const a = parseTimeMinutes(start);
  const b = parseTimeMinutes(end);
  if (a === null || b === null) return 0;
  if (b > a) return b - a;
  if (b === a) return 1440;
  return 1440 - a + b;
}

/** חלון שלם בתוך טווח שעון (ללא חציית חצות) */
function windowFullyInsideWallRange(
  w: GuardShiftWindow,
  rangeStartMin: number,
  rangeEndMin: number,
): boolean {
  const start = wallMin(w.startMin);
  const end = wallMin(w.endMin);
  if (end <= start) return false;
  return start >= rangeStartMin && end <= rangeEndMin;
}

function rearSeatsForWindow(
  w: GuardShiftWindow,
  dayStartMin: number,
  dayEndMin: number,
): number {
  if (windowFullyInsideWallRange(w, dayStartMin, dayEndMin)) return 1;
  return 2;
}

function footSeatsForWindow(
  w: GuardShiftWindow,
  dayStartMin: number,
  dayEndMin: number,
): number {
  return windowFullyInsideWallRange(w, dayStartMin, dayEndMin) ? 1 : 0;
}

function rotatingGuardSlots(
  windows: GuardShiftWindow[],
  seatsFor: (w: GuardShiftWindow) => number,
): MissionSlot[] {
  // כל העמדות חולקות את אותם חלונות — כולל משמרות קצרות לסנכרון
  return slotsFromWindows(windows, seatsFor, true);
}

function rearVehicleSlotsFromWindows(
  windows: GuardShiftWindow[],
  dayStart: string,
  dayEnd: string,
  maxSlotMinutes?: number,
): MissionSlot[] {
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 18 * 60;
  const split = splitWindowsAtWallClock(windows, dayEndMin);
  return slotsFromWindows(
    split,
    (w) => rearSeatsForWindow(w, dayStartMin, dayEndMin),
    true,
    maxSlotMinutes,
  );
}

function footPatrolSlotsFromWindows(
  windows: GuardShiftWindow[],
  dayStart: string,
  dayEnd: string,
  maxSlotMinutes?: number,
): MissionSlot[] {
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 19 * 60;
  const split = splitWindowsAtWallClock(windows, dayEndMin);
  return slotsFromWindows(
    split,
    (w) => footSeatsForWindow(w, dayStartMin, dayEndMin),
    true,
    maxSlotMinutes,
  );
}

/** קצין תורן — שתי משמרות בלבד, חצי מחזור יום השמירות כל אחת */
function officerDutySlots(boardStart: string, cycleMin: number): MissionSlot[] {
  const boardMin = parseTimeMinutes(boardStart) ?? 20 * 60;
  const mid = boardMin + Math.floor(cycleMin / 2);
  const end = boardMin + cycleMin;
  return [newSlot(fmtTime(boardMin), fmtTime(mid), 1), newSlot(fmtTime(mid), fmtTime(end), 1)];
}

/** האם מבנה קצין תורן תקין (בדיוק 2 משמרות) */
export function officerDutySlotsValid(slots: MissionSlot[]): boolean {
  return slots.length === 2 && slots.every((s) => s.seat_count >= 1);
}

/** כל עמדות השמירה המסתובבות (מלבד כוננות/קצין תורן) חולקות אותם חלונות זמן */
export function guardShiftWindowsAligned(positions: MissionPosition[]): boolean {
  const keys = (slots: MissionSlot[]) =>
    slots.map((s) => `${s.start_time}-${s.end_time}`).join("|");

  const rotating = positions.filter(
    (p) =>
      p.kind !== "standby_carmel_a" &&
      p.kind !== "standby_carmel_b" &&
      p.kind !== "officer_duty" &&
      !p.name.includes("כוננות") &&
      !p.name.includes("רכב אחורי") &&
      !p.name.includes("רגלי"),
  );
  if (rotating.length < 2) return true;

  const ref = keys(rotating[0].slots);
  return rotating.every((p) => keys(p.slots) === ref);
}

function guardPosition(
  name: string,
  slots: MissionSlot[],
  kind: MissionPositionKind = "guard",
  opts?: { same_room?: boolean; same_gender?: boolean },
): MissionPosition {
  return newPosition(name, { kind, ...opts, slots });
}

function cycleMinutesFromMission(startsAt?: string, endsAt?: string): number {
  if (startsAt && endsAt) {
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      return Math.max(60, Math.round((endMs - startMs) / 60000));
    }
  }
  return 1440;
}

function isDaytime(clockMin: number, dayStartMin: number, dayEndMin: number): boolean {
  return clockMin >= dayStartMin && clockMin < dayEndMin;
}

/** חלונות יום/לילה בתוך מחזור יום השמירות (מתחילת board_start) */
export function dayNightSegmentsInCycle(
  boardMin: number,
  cycleMin: number,
  dayStartMin: number,
  dayEndMin: number,
  daySeats: number,
  nightSeats: number,
): Array<{ startMin: number; endMin: number; seats: number }> {
  if (cycleMin <= 0) return [];

  const segments: Array<{ startMin: number; endMin: number; seats: number }> = [];
  let segStart = 0;
  let segSeats = isDaytime((boardMin + 0) % 1440, dayStartMin, dayEndMin) ? daySeats : nightSeats;

  for (let offset = 1; offset <= cycleMin; offset++) {
    const atEnd = offset === cycleMin;
    const nextSeats = atEnd
      ? null
      : isDaytime((boardMin + offset) % 1440, dayStartMin, dayEndMin)
        ? daySeats
        : nightSeats;

    if (atEnd || nextSeats !== segSeats) {
      if (segSeats > 0) {
        segments.push({
          startMin: boardMin + segStart,
          endMin: boardMin + offset,
          seats: segSeats,
        });
      }
      if (!atEnd && nextSeats != null) {
        segStart = offset;
        segSeats = nextSeats;
      }
    }
  }

  return segments;
}

function slotCrossesWallBoundary(
  startMin: number,
  endMin: number,
  boundaryMin: number,
): boolean {
  if (endMin <= startMin || endMin > 1440) return false;
  return startMin < boundaryMin && endMin > boundaryMin;
}

const REAR_VEHICLE_DAY_START = "06:00";
const REAR_VEHICLE_DAY_END = "18:00";

function slotInsideWallRange(
  startMin: number,
  endMin: number,
  rangeStartMin: number,
  rangeEndMin: number,
): boolean {
  if (endMin <= startMin) return false;
  if (endMin > 1440) return false;
  return startMin >= rangeStartMin && endMin <= rangeEndMin;
}

/** האם משמרות ש״ג אחורי תקינות — 1 ב־06–18, 2 בכל שאר השעות, ללא חציית גבולות */
export function rearVehicleSlotsValid(
  slots: MissionSlot[],
  dayStart = REAR_VEHICLE_DAY_START,
  dayEnd = REAR_VEHICLE_DAY_END,
): boolean {
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 18 * 60;

  for (const slot of slots) {
    const start = parseTimeMinutes(slot.start_time);
    if (start === null) return false;
    const dur = slotDurationMinutes(slot.start_time, slot.end_time);
    if (dur <= 0) return false;

    if (dur >= 1440 || start + dur > 1440) {
      if (slot.seat_count !== 2) return false;
      continue;
    }

    const end = start + dur;
    if (
      slotCrossesWallBoundary(start, end, dayStartMin) ||
      slotCrossesWallBoundary(start, end, dayEndMin)
    ) {
      return false;
    }

    const inDay = slotInsideWallRange(start, end, dayStartMin, dayEndMin);
    if (inDay) {
      if (slot.seat_count !== 1) return false;
    } else if (slot.seat_count !== 2) {
      return false;
    }
  }

  return true;
}

const FOOT_PATROL_DAY_START = "06:00";
const FOOT_PATROL_DAY_END = "19:00";

/** האם משמרות ש״ג רגלי תקינות — 1 ב־06–19, 0 בכל שאר השעות, ללא חציית גבולות */
export function footPatrolSlotsValid(
  slots: MissionSlot[],
  dayStart = FOOT_PATROL_DAY_START,
  dayEnd = FOOT_PATROL_DAY_END,
): boolean {
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 19 * 60;

  for (const slot of slots) {
    const start = parseTimeMinutes(slot.start_time);
    if (start === null) return false;
    const dur = slotDurationMinutes(slot.start_time, slot.end_time);
    if (dur <= 0) return false;
    if (dur >= 1440 || start + dur > 1440) {
      if (slot.seat_count !== 0) return false;
      continue;
    }

    const end = start + dur;
    if (
      slotCrossesWallBoundary(start, end, dayStartMin) ||
      slotCrossesWallBoundary(start, end, dayEndMin)
    ) {
      return false;
    }

    const inFootDay = slotInsideWallRange(start, end, dayStartMin, dayEndMin);
    if (inFootDay) {
      if (slot.seat_count !== 1) return false;
    } else if (slot.seat_count !== 0) {
      return false;
    }
  }

  return true;
}

export type BuildGuardDayOptions = {
  shiftHours?: number;
  season?: "summer" | "winter";
  boardStart?: string;
  missionStartsAt?: string;
  missionEndsAt?: string;
  carmelSeats?: number;
};

type GuardDayContext = {
  board: string;
  cycleMin: number;
  shift: number;
  day: readonly [string, string];
  footDay: readonly [string, string];
  season: "summer" | "winter";
  missionStartsAt?: string;
  missionEndsAt?: string;
  carmelSeats: number;
};

function resolveGuardDayContext(options?: BuildGuardDayOptions): GuardDayContext {
  const shift = options?.shiftHours ?? 4;
  const board = options?.boardStart ?? isoToTimeLabel(options?.missionStartsAt) ?? "20:00";
  const cycleMin = cycleMinutesFromMission(options?.missionStartsAt, options?.missionEndsAt);
  const day =
    options?.season === "winter" ? (["05:00", "17:00"] as const) : (["06:00", "18:00"] as const);
  const footDay =
    options?.season === "winter" ? (["05:00", "17:00"] as const) : (["06:00", "19:00"] as const);
  return {
    board,
    cycleMin,
    shift,
    day,
    footDay,
    season: options?.season ?? "summer",
    missionStartsAt: options?.missionStartsAt,
    missionEndsAt: options?.missionEndsAt,
    carmelSeats: options?.carmelSeats ?? 3,
  };
}

function slotWindowKey(slot: Pick<MissionSlot, "start_time" | "end_time">): string {
  return `${slot.start_time}-${slot.end_time}`;
}

/** רשת משמרות מאוחדת — 4 שעות מעוגן 08:00; פיצולי יום/לילה רק לש״ג אחורי/רגלי */
function buildGuardDayWindows(ctx: GuardDayContext): GuardShiftWindow[] {
  return buildPureFourHourShiftWindows(ctx.board, ctx.cycleMin, ctx.shift);
}

function mergeSlotsPreservingIds(prev: MissionSlot[], next: MissionSlot[]): MissionSlot[] {
  const usedPrevIds = new Set<string>();
  const byKey = new Map(prev.map((s) => [slotWindowKey(s), s]));

  return next.map((slot) => {
    const exact = byKey.get(slotWindowKey(slot));
    if (exact && !usedPrevIds.has(exact.id)) {
      usedPrevIds.add(exact.id);
      return { ...slot, id: exact.id };
    }
    const sameStart = prev.find(
      (p) => p.start_time === slot.start_time && !usedPrevIds.has(p.id),
    );
    if (sameStart) {
      usedPrevIds.add(sameStart.id);
      return { ...slot, id: sameStart.id };
    }
    return slot;
  });
}

/** כל משמרת חייבת מזהה ייחודי — כרמל א׳/ב׳ לא יכולים לשתף slot.id */
function ensureUniqueSlotIds(positions: MissionPosition[]): MissionPosition[] {
  const used = new Set<string>();
  return positions.map((pos) => ({
    ...pos,
    slots: pos.slots.map((slot) => {
      if (!used.has(slot.id)) {
        used.add(slot.id);
        return slot;
      }
      const fresh = { ...slot, id: uid() };
      used.add(fresh.id);
      return fresh;
    }),
  }));
}

function guardSlotsForPosition(
  pos: MissionPosition,
  windows: GuardShiftWindow[],
  ctx: GuardDayContext,
): MissionSlot[] | null {
  const dayStartMin = parseTimeMinutes(ctx.day[0]) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(ctx.day[1]) ?? 18 * 60;
  const footStartMin = parseTimeMinutes(ctx.footDay[0]) ?? 6 * 60;
  const footEndMin = parseTimeMinutes(ctx.footDay[1]) ?? 19 * 60;
  const maxMin = Math.round(ctx.shift * 60);

  if (pos.kind === "officer_duty") {
    return officerDutySlots(ctx.board, ctx.cycleMin);
  }
  if (pos.name.includes("רכב אחורי")) {
    const split = splitWindowsAtWallClock(windows, dayEndMin);
    return slotsFromWindows(
      split,
      (w) => rearSeatsForWindow(w, dayStartMin, dayEndMin),
      true,
      maxMin,
    );
  }
  if (pos.name.includes("רגלי")) {
    const split = splitWindowsAtWallClock(windows, footEndMin);
    return slotsFromWindows(
      split,
      (w) => footSeatsForWindow(w, footStartMin, footEndMin),
      true,
      maxMin,
    );
  }
  if (pos.name.includes("רכב קדמי")) {
    return slotsFromWindows(windows, () => 2, true, maxMin);
  }
  if (pos.kind === "duty") {
    return slotsFromWindows(windows, () => 3, true, maxMin);
  }
  return slotsFromWindows(windows, () => 1, true, maxMin);
}

/** מסנכרן חלונות משמרת לכל העמדות — רשת 4 שעות; פיצול יום/לילה רק לש״ג אחורי/רגלי. */
export function syncGuardShiftSlots(
  positions: MissionPosition[],
  options?: BuildGuardDayOptions,
): MissionPosition[] {
  const ctx = resolveGuardDayContext(options);
  const windows = buildGuardDayWindows(ctx);

  const maxMin = Math.round(ctx.shift * 60);

  return ensureUniqueSlotIds(
    positions.map((pos) => {
      if (pos.kind === "standby_carmel_a" || pos.kind === "standby_carmel_b") {
        const carmel = carmelSlotFromMission(
          ctx.missionStartsAt,
          ctx.missionEndsAt,
          ctx.board,
          ctx.carmelSeats,
        );
        return { ...pos, slots: mergeSlotsPreservingIds(pos.slots, [carmel]) };
      }

      if (pos.kind === "officer_duty") {
        const next = guardSlotsForPosition(pos, windows, ctx);
        return next ? { ...pos, slots: mergeSlotsPreservingIds(pos.slots, next) } : pos;
      }

      const next = guardSlotsForPosition(pos, windows, ctx);
      if (!next) return pos;
      const synced = mergeSlotsPreservingIds(pos.slots, next);
      return { ...pos, slots: mergeAdjacentGuardSlots(synced, maxMin) };
    }),
  );
}

/** מערך שמירות סטנדרטי — כל העמדות לפי הפקודה */
export function buildGuardDayPositions(options?: BuildGuardDayOptions): MissionPosition[] {
  const ctx = resolveGuardDayContext(options);
  const windows = buildGuardDayWindows(ctx);
  const maxMin = Math.round(ctx.shift * 60);
  const fixedSeats = (seats: number) =>
    slotsFromWindows(windows, () => seats, true, maxMin);

  const positions = [
    guardPosition(
      "כרמל א׳ (כוננות)",
      [
        carmelSlotFromMission(
          ctx.missionStartsAt,
          ctx.missionEndsAt,
          ctx.board,
          ctx.carmelSeats,
        ),
      ],
      "standby_carmel_a",
      {
        same_room: true,
        same_gender: true,
      },
    ),
    guardPosition(
      "כרמל ב׳ (כוננות)",
      [
        carmelSlotFromMission(
          ctx.missionStartsAt,
          ctx.missionEndsAt,
          ctx.board,
          ctx.carmelSeats,
        ),
      ],
      "standby_carmel_b",
      {
        same_room: true,
        same_gender: true,
      },
    ),
    guardPosition(
      "ש״ג רכב אחורי",
      rearVehicleSlotsFromWindows(windows, ctx.day[0], ctx.day[1], maxMin),
    ),
    guardPosition("ש״ג רכב קדמי", fixedSeats(2)),
    guardPosition("פטל", fixedSeats(1)),
    guardPosition("תצפיתן", fixedSeats(1)),
    guardPosition(
      "ש״ג רגלי",
      footPatrolSlotsFromWindows(windows, ctx.footDay[0], ctx.footDay[1], maxMin),
    ),
    guardPosition("ימ״ח", fixedSeats(1)),
    guardPosition("נשקייה", fixedSeats(1)),
    guardPosition("בונקר", fixedSeats(1)),
    guardPosition("כוח עתודה", fixedSeats(3), "duty"),
    guardPosition("קצין תורן", officerDutySlots(ctx.board, ctx.cycleMin), "officer_duty"),
  ];

  return syncGuardShiftSlots(positions, options);
}

export function defaultGuardDayPositions(options?: BuildGuardDayOptions): MissionPosition[] {
  return buildGuardDayPositions(options);
}

/** הסבר קצר לכל עמדה — מוצג בעורך יום משימה */
export function guardPositionHint(pos: Pick<MissionPosition, "name" | "kind">): string | null {
  switch (pos.kind) {
    case "standby_carmel_a":
      return "3 צוערים, אותו מגדר, עדיפות אותו חדר, מתחילת יום המשימה עד סופו. מותר במקביל למטבח.";
    case "standby_carmel_b":
      return "3 צוערים, אותו מגדר, עדיפות אותו חדר, מתחילת יום המשימה עד סופו. מותר במקביל לעב״ס (רס״ר) ולמטבח.";
    case "officer_duty":
      return "קצין תורן אחד — רק רני פלג או יסמין חדד. שתי משמרות שמחלקות את יום השמירות לשניים.";
    case "duty":
      if (pos.name.includes("עתודה")) {
        return "3 צוערים תמיד — משמרות מסתובבות לאורך כל יום המשימה.";
      }
      return null;
    default:
      break;
  }
  if (pos.name.includes("רכב אחורי")) {
    return "בדיוק 1 שומר 06:00–18:00, בדיוק 2 בכל שאר השעות — אותם זמני חילוף כמו שאר העמדות (כולל משמרות קצרות לסנכרון).";
  }
  if (pos.name.includes("רכב קדמי")) {
    return "2 שומרים בכל משמרת — חילוף מסונכרן עם כל העמדות.";
  }
  if (pos.name.includes("רגלי")) {
    return "בדיוק 1 שומר 06:00–19:00, 0 בכל שאר השעות — אותם זמני חילוף כמו שאר העמדות (משמרות לילה עם 0 מאיישים לסנכרון).";
  }
  if (["פטל", "תצפיתן", "ימ״ח", "נשקייה", "בונקר"].some((n) => pos.name.includes(n))) {
    return "משמרות מסתובבות — אותם זמני חילוף בכל העמדות.";
  }
  return null;
}

export function summarizeGuardSlots(slots: MissionSlot[]): string {
  if (!slots.length) return "";
  if (slots.length === 1) {
    const s = slots[0];
    if (s.start_time === s.end_time && s.start_time !== "00:00") {
      return `${s.seat_count} צוערים · ${s.start_time}–${s.end_time}`;
    }
    if (s.start_time === s.end_time) {
      return `${s.seat_count} צוערים · כל יום המשימה (כוננות)`;
    }
    return `${s.seat_count} צוערים · ${s.start_time}–${s.end_time}`;
  }
  const seats = [...new Set(slots.map((s) => s.seat_count))];
  const seatLabel = seats.length === 1 ? `${seats[0]} מאיישים` : "מספר מאיישים משתנה";
  return `${slots.length} משמרות · ${seatLabel} · ${slots[0].start_time}–${slots[0].end_time} (ראשונה)`;
}

export const GUARD_FAIRNESS_REFERENCE = [
  { bucket: "solo", label: "שמירה לבד", default: 1.5, examples: "פטל, נשקייה, תצפיתן, ש״ג רגלי (יום)" },
  { bucket: "pair", label: "שמירה בזוג+", default: 1.0, examples: "ש״ג רכב קדמי, ש״ג רכב אחורי (לילה — 2)" },
  { bucket: "standby_a", label: "כרמל א׳", default: 0.45, examples: "3 צוערים, יום מלא, מטבח במקביל" },
  { bucket: "standby_b", label: "כרמל ב׳", default: 0.15, examples: "3 צוערים, עב״ס/רס״ר + מטבח במקביל" },
  { bucket: "duty", label: "עב״ס / עתודה", default: 0.1, examples: "כוח עתודה (3)" },
  { bucket: "kitchen", label: "מטבח", default: 0.1, examples: "35 למשמרת" },
] as const;
