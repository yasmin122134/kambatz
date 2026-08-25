import {
  defaultBaseWorkPositions,
  isBaseWorkPosition,
  materializeBaseWorkPositions,
} from "@/lib/base-work-template";
import {
  defaultHamagshiyotPositions,
  isHamagshiyotPosition,
  materializeHamagshiyotPositions,
} from "@/lib/hamagshiyot-template";
import type { MissionPosition, MissionPositionKind, MissionSlot } from "@/lib/types";
import { DEFAULT_RESERVE_FORCE_SEATS } from "@/lib/types";
import {
  defaultPatrolPositions,
  isPatrolPosition,
  materializePatrolPositions,
} from "@/lib/patrol-day-template";
import {
  debugFormatPositionSlots,
  generatePositionSlots,
  slotStructuralKey,
  type GeneratedPositionSlot,
} from "@/lib/guard-slot-generation";
import {
  constantStaffingProfile,
  FOOT_PATROL_STAFFING_SUMMER,
  FOOT_PATROL_STAFFING_WINTER,
  getRequiredSeats,
  getRequiredSeatsAtWallMinute,
  REAR_GATE_STAFFING_SUMMER,
  REAR_GATE_STAFFING_WINTER,
  type StaffingProfile,
} from "@/lib/staffing-profile";
import {
  fmtMissionTimeLabel,
  fmtTimeLabel,
  materializeSlotAbsoluteBounds,
  missionInterval,
  normalizeTimeLabel,
  parseIsoMs,
  parseTimeMinutes,
  resolveSlotAbsoluteInterval,
  slotDurationMinutes,
} from "@/lib/time-interval";

export {
  fmtTimeLabel as fmtTimeFromMs,
  intervalsOverlap,
  parseTimeMinutes,
  slotDurationMinutes,
} from "@/lib/time-interval";
export {
  debugFormatPositionSlots,
  generatePositionSlots,
  partitionInterval,
} from "@/lib/guard-slot-generation";
export {
  getRequiredSeats,
  getRequiredSeatsAtWallMinute,
  type DailyStaffingRule,
  type StaffingProfile,
} from "@/lib/staffing-profile";

/** @deprecated Mission-relative cadence is anchored to missionStart, not 08:00. */
export const CANONICAL_GUARD_GRID_START = "08:00";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

/** HH:MM מתאריך ISO — תמיד לפי שעון ישראל (גם בשרת UTC). */
export function isoToTimeLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = parseIsoMs(iso);
  return ms === null ? null : fmtMissionTimeLabel(ms);
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
  const slot: MissionSlot = { id: uid(), start_time: start, end_time: end, seat_count: seats };
  if (missionStartsAt && missionEndsAt) {
    const missionIv = missionInterval(missionStartsAt, missionEndsAt);
    if (missionIv && (start === end || (start === isoToTimeLabel(missionStartsAt) && end === isoToTimeLabel(missionEndsAt)))) {
      Object.assign(slot, materializeSlotAbsoluteBounds(slot, missionIv));
    } else {
      const abs = resolveSlotAbsoluteInterval(missionStartsAt, missionEndsAt, start, end);
      if (abs) {
        Object.assign(slot, materializeSlotAbsoluteBounds(slot, abs));
      }
    }
  }
  return slot;
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

/** Legacy type — kept for callers that still reference window tuples. */
export type GuardShiftWindow = { startMin: number; endMin: number };

/** דקות מעוגנות ל-board_start — 0 = תחילת יום השמירות */
function cyclicMinutesFromBoard(startTime: string, boardStart: string): number {
  const start = parseTimeMinutes(startTime) ?? 0;
  const board = parseTimeMinutes(boardStart) ?? 0;
  return (start - board + 1440) % 1440;
}

/** מיון משמרות לפי סדר יום השמירות (מתחילת board_start), לא מחצות */
export function sortSlotsByBoardCycle(
  slots: MissionSlot[],
  boardStart: string,
): MissionSlot[] {
  return [...slots].sort((a, b) => {
    const ca = cyclicMinutesFromBoard(a.start_time, boardStart);
    const cb = cyclicMinutesFromBoard(b.start_time, boardStart);
    return ca - cb || a.end_time.localeCompare(b.end_time);
  });
}

/**
 * @deprecated Use generatePositionSlots with missionStartMs instead.
 * Returns nominal 4h windows relative to mission start for backward-compatible tests.
 */
export function buildPureFourHourShiftWindows(
  boardStart: string,
  cycleMin: number,
  shiftHours: number,
): GuardShiftWindow[] {
  const boardMin = parseTimeMinutes(boardStart) ?? 20 * 60;
  const cycleEnd = boardMin + cycleMin;
  const shiftMin = Math.max(60, Math.round(shiftHours * 60));
  const bounds = new Set<number>([boardMin, cycleEnd]);
  for (let t = boardMin + shiftMin; t < cycleEnd; t += shiftMin) {
    bounds.add(t);
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

/**
 * מאחד משמרות רצופות עם אותו מספר מאיישים כשסך הזמן ≤ maxSlotMinutes.
 * Used when preserving legacy slot IDs after regeneration.
 */
export function mergeAdjacentGuardSlots(
  slots: MissionSlot[],
  maxSlotMinutes: number,
  boardStart?: string,
): MissionSlot[] {
  if (slots.length < 2) return slots;

  const sorted = boardStart
    ? sortSlotsByBoardCycle(slots, boardStart)
    : [...slots].sort((a, b) => {
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

/** קצין תורן — שתי משמרות בלבד, חצי מחזור יום השמירות כל אחת */
function officerDutySlots(missionStartMs: number, missionEndMs: number): MissionSlot[] {
  const span = missionEndMs - missionStartMs;
  if (span <= 0) return [];
  const mid = missionStartMs + Math.floor(span / 2);
  return [
    {
      id: uid(),
      start_time: fmtMissionTimeLabel(missionStartMs),
      end_time: fmtMissionTimeLabel(mid),
      seat_count: 1,
      starts_at: new Date(missionStartMs).toISOString(),
      ends_at: new Date(mid).toISOString(),
    },
    {
      id: uid(),
      start_time: fmtMissionTimeLabel(mid),
      end_time: fmtMissionTimeLabel(missionEndMs),
      seat_count: 1,
      starts_at: new Date(mid).toISOString(),
      ends_at: new Date(missionEndMs).toISOString(),
    },
  ];
}

function sortOfficerDutySlots(slots: MissionSlot[]): MissionSlot[] {
  return [...slots].sort((a, b) => {
    const as = parseIsoMs(a.starts_at);
    const bs = parseIsoMs(b.starts_at);
    if (as !== null && bs !== null) return as - bs;
    return a.start_time.localeCompare(b.start_time);
  });
}

/** האם מבנה קצין תורן תקין — בדיוק 2 משמרות, כל אחת חצי מחזור המשימה */
export function officerDutySlotsValid(
  slots: MissionSlot[],
  missionStartsAt: string,
  missionEndsAt: string,
): boolean {
  const iv = missionInterval(missionStartsAt, missionEndsAt);
  if (!iv) return false;
  if (slots.length !== 2 || !slots.every((s) => s.seat_count >= 1)) return false;

  const expected = officerDutySlots(iv.startMs, iv.endMs);
  const sorted = sortOfficerDutySlots(slots);
  const sortedExpected = sortOfficerDutySlots(expected);

  for (let i = 0; i < 2; i++) {
    const got = sorted[i];
    const exp = sortedExpected[i];
    const gotStart = parseIsoMs(got.starts_at);
    const gotEnd = parseIsoMs(got.ends_at);
    const expStart = parseIsoMs(exp.starts_at);
    const expEnd = parseIsoMs(exp.ends_at);
    if (gotStart !== null && gotEnd !== null && expStart !== null && expEnd !== null) {
      if (gotStart !== expStart || gotEnd !== expEnd) return false;
      continue;
    }
    if (normalizeTimeLabel(got.start_time) !== normalizeTimeLabel(exp.start_time)) return false;
    if (normalizeTimeLabel(got.end_time) !== normalizeTimeLabel(exp.end_time)) return false;
  }
  return true;
}

/**
 * @deprecated Positions may legitimately have different slot boundaries (e.g. foot patrol vs front gate).
 * Always returns true — kept so older callers do not break.
 */
export function guardShiftWindowsAligned(_positions: MissionPosition[]): boolean {
  return true;
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
  const interval = startsAt && endsAt ? missionInterval(startsAt, endsAt) : null;
  if (!interval) return 1440;
  return Math.max(60, Math.round((interval.endMs - interval.startMs) / 60_000));
}

function slotsCrossStaffingBoundary(
  profile: StaffingProfile,
  missionStartsAt: string,
  missionEndsAt: string,
  slot: MissionSlot,
): boolean {
  const abs = resolveSlotAbsoluteInterval(
    missionStartsAt,
    missionEndsAt,
    slot.start_time,
    slot.end_time,
  );
  if (!abs) return true;
  const stepMs = 60_000;
  let prev = getRequiredSeats(profile, abs.startMs);
  for (let t = abs.startMs + stepMs; t < abs.endMs; t += stepMs) {
    const cur = getRequiredSeats(profile, t);
    if (cur !== prev) return true;
    prev = cur;
  }
  return false;
}

function slotsMatchStaffingProfile(
  profile: StaffingProfile,
  missionStartsAt: string,
  missionEndsAt: string,
  slots: MissionSlot[],
  allowZeroSeatSlots: boolean,
): boolean {
  for (const slot of slots) {
    if (!allowZeroSeatSlots && slot.seat_count <= 0) return false;
    if (allowZeroSeatSlots && slot.seat_count === 0) continue;

    const abs = resolveSlotAbsoluteInterval(
      missionStartsAt,
      missionEndsAt,
      slot.start_time,
      slot.end_time,
    );
    if (!abs) return false;
    if (slotsCrossStaffingBoundary(profile, missionStartsAt, missionEndsAt, slot)) {
      return false;
    }

    const midMs = abs.startMs + (abs.endMs - abs.startMs) / 2;
    if (getRequiredSeats(profile, midMs) !== slot.seat_count) return false;
  }
  return true;
}

/** האם משמרות ש״ג אחורי תקינות — 1 ב־06–18, 2 בכל שאר השעות, ללא חציית גבולות */
export function rearVehicleSlotsValid(
  slots: MissionSlot[],
  dayStart = "06:00",
  dayEnd = "18:00",
  missionStartsAt = "2026-01-01T20:00:00",
  missionEndsAt = "2026-01-02T20:00:00",
): boolean {
  const profile: StaffingProfile =
    dayStart === "05:00"
      ? REAR_GATE_STAFFING_WINTER
      : [
          { startTime: dayStart, endTime: dayEnd, seats: 1 },
          { startTime: dayEnd, endTime: dayStart, seats: 2 },
        ];
  return slotsMatchStaffingProfile(profile, missionStartsAt, missionEndsAt, slots, false);
}

/** האם משמרות ש״ג רגלי תקינות — 1 ב־06–19, ללא משמרות מחוץ לטווח */
export function footPatrolSlotsValid(
  slots: MissionSlot[],
  dayStart = "06:00",
  dayEnd = "19:00",
  missionStartsAt = "2026-01-01T20:00:00",
  missionEndsAt = "2026-01-02T20:00:00",
): boolean {
  const profile: StaffingProfile =
    dayStart === "05:00"
      ? FOOT_PATROL_STAFFING_WINTER
      : [
          { startTime: dayStart, endTime: dayEnd, seats: 1 },
          { startTime: dayEnd, endTime: dayStart, seats: 0 },
        ];
  if (slots.some((s) => s.seat_count <= 0)) return false;
  return slotsMatchStaffingProfile(profile, missionStartsAt, missionEndsAt, slots, false);
}

export type BuildGuardDayOptions = {
  shiftHours?: number;
  season?: "summer" | "winter";
  boardStart?: string;
  missionStartsAt?: string;
  missionEndsAt?: string;
  missionDate?: string;
  carmelSeats?: number;
  baseWorkSeatsPerShift?: number;
};

type GuardDayContext = {
  board: string;
  missionStartMs: number;
  missionEndMs: number;
  shiftMin: number;
  season: "summer" | "winter";
  missionStartsAt: string;
  missionEndsAt: string;
  missionDate?: string;
  carmelSeats: number;
  rearProfile: StaffingProfile;
  footProfile: StaffingProfile;
};

function resolveGuardDayContext(options?: BuildGuardDayOptions): GuardDayContext {
  const missionStartsAt =
    options?.missionStartsAt ??
    (options?.boardStart
      ? `2026-01-01T${options.boardStart}:00`
      : "2026-01-01T20:00:00");
  const missionEndsAt =
    options?.missionEndsAt ??
    (() => {
      const startMs = parseIsoMs(missionStartsAt) ?? Date.parse("2026-01-01T20:00:00");
      return new Date(startMs + 86_400_000).toISOString();
    })();

  const interval = missionInterval(missionStartsAt, missionEndsAt);
  const missionStartMs = interval?.startMs ?? parseIsoMs(missionStartsAt) ?? 0;
  const missionEndMs =
    interval?.endMs ?? missionStartMs + cycleMinutesFromMission(missionStartsAt, missionEndsAt) * 60_000;

  const shift = options?.shiftHours ?? 4;
  const board = options?.boardStart ?? isoToTimeLabel(missionStartsAt) ?? "20:00";
  const season = options?.season ?? "summer";

  return {
    board,
    missionStartMs,
    missionEndMs,
    shiftMin: Math.max(60, Math.round(shift * 60)),
    season,
    missionStartsAt,
    missionEndsAt,
    missionDate: options?.missionDate,
    carmelSeats: options?.carmelSeats ?? 3,
    rearProfile: season === "winter" ? REAR_GATE_STAFFING_WINTER : REAR_GATE_STAFFING_SUMMER,
    footProfile: season === "winter" ? FOOT_PATROL_STAFFING_WINTER : FOOT_PATROL_STAFFING_SUMMER,
  };
}

function slotWindowKey(slot: Pick<MissionSlot, "start_time" | "end_time" | "seat_count">): string {
  return `${slot.start_time}-${slot.end_time}-${slot.seat_count}`;
}

function generatedSlotsToMissionSlots(
  positionId: string,
  generated: GeneratedPositionSlot[],
  boardStart: string,
): MissionSlot[] {
  const slots = generated.map((g) => {
    const bounds = materializeSlotAbsoluteBounds(
      { start_time: fmtTimeLabel(g.startMs), end_time: fmtTimeLabel(g.endMs) },
      { startMs: g.startMs, endMs: g.endMs },
    );
    return {
      id: uid(),
      start_time: fmtTimeLabel(g.startMs),
      end_time: fmtTimeLabel(g.endMs),
      seat_count: g.requiredSeats,
      starts_at: bounds.starts_at,
      ends_at: bounds.ends_at,
      _key: slotStructuralKey(positionId, g.startMs, g.endMs),
    };
  });
  return sortSlotsByBoardCycle(
    slots.map(({ _key, ...s }) => s),
    boardStart,
  );
}

function mergeOfficerDutySlotsByIndex(prev: MissionSlot[], next: MissionSlot[]): MissionSlot[] {
  const sortedPrev = sortOfficerDutySlots(prev);
  return sortOfficerDutySlots(next).map((slot, i) => ({
    ...slot,
    id: sortedPrev[i]?.id ?? slot.id,
  }));
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
      (p) =>
        p.start_time === slot.start_time &&
        p.end_time === slot.end_time &&
        p.seat_count === slot.seat_count &&
        !usedPrevIds.has(p.id),
    );
    if (sameStart) {
      usedPrevIds.add(sameStart.id);
      return { ...slot, id: sameStart.id };
    }
    return slot;
  });
}

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

function staffingProfileForPosition(
  pos: MissionPosition,
  ctx: GuardDayContext,
): StaffingProfile | null {
  if (pos.kind === "officer_duty") return null;
  if (pos.name.includes("רכב אחורי")) return ctx.rearProfile;
  if (pos.name.includes("רגלי")) return ctx.footProfile;
  if (pos.name.includes("רכב קדמי")) return constantStaffingProfile(2);
  if (pos.name.includes("עתודה")) return constantStaffingProfile(DEFAULT_RESERVE_FORCE_SEATS);
  if (pos.kind === "duty") return constantStaffingProfile(DEFAULT_RESERVE_FORCE_SEATS);
  return constantStaffingProfile(1);
}

function guardSlotsForPosition(pos: MissionPosition, ctx: GuardDayContext): MissionSlot[] | null {
  if (pos.kind === "officer_duty") {
    return officerDutySlots(ctx.missionStartMs, ctx.missionEndMs);
  }

  const profile = staffingProfileForPosition(pos, ctx);
  if (!profile) return null;

  const generated = generatePositionSlots({
    missionStartMs: ctx.missionStartMs,
    missionEndMs: ctx.missionEndMs,
    nominalShiftDurationMin: ctx.shiftMin,
    staffingProfile: profile,
  });

  return generatedSlotsToMissionSlots(pos.id, generated, ctx.board);
}

/** מסנכרן חלונות משמרת — כל עמדה מייצרת משמרות משלה לפי פרופיל כיסוי. */
export function syncGuardShiftSlots(
  positions: MissionPosition[],
  options?: BuildGuardDayOptions,
): MissionPosition[] {
  const ctx = resolveGuardDayContext(options);

  return ensureUniqueSlotIds(
    positions.map((pos) => {
      if (isBaseWorkPosition(pos)) {
        return {
          ...pos,
          slots: materializeBaseWorkPositions([pos], ctx.missionStartsAt, ctx.missionEndsAt, ctx.missionDate)[0]
            .slots,
        };
      }

      if (pos.kind === "standby_carmel_a" || pos.kind === "standby_carmel_b") {
        const carmel = carmelSlotFromMission(
          ctx.missionStartsAt,
          ctx.missionEndsAt,
          ctx.board,
          ctx.carmelSeats,
        );
        return { ...pos, slots: mergeSlotsPreservingIds(pos.slots, [carmel]) };
      }

      if (isPatrolPosition(pos)) {
        const [patrol] = materializePatrolPositions([pos], ctx.missionDate);
        return patrol ?? pos;
      }

      if (isHamagshiyotPosition(pos)) {
        const [ham] = materializeHamagshiyotPositions([pos], ctx.missionDate);
        return ham ?? pos;
      }

      const next = guardSlotsForPosition(pos, ctx);
      if (!next) return pos;
      if (pos.kind === "officer_duty") {
        return { ...pos, slots: mergeOfficerDutySlotsByIndex(pos.slots, next) };
      }
      return { ...pos, slots: mergeSlotsPreservingIds(pos.slots, next) };
    }),
  );
}

/** מערך שמירות סטנדרטי — כל העמדות לפי הפקודה */
export function buildGuardDayPositions(options?: BuildGuardDayOptions): MissionPosition[] {
  const ctx = resolveGuardDayContext(options);

  const positions = [
    guardPosition(
      "כרמל א׳ (כוננות)",
      [carmelSlotFromMission(ctx.missionStartsAt, ctx.missionEndsAt, ctx.board, ctx.carmelSeats)],
      "standby_carmel_a",
      { same_room: true, same_gender: true },
    ),
    guardPosition(
      "כרמל ב׳ (כוננות)",
      [carmelSlotFromMission(ctx.missionStartsAt, ctx.missionEndsAt, ctx.board, ctx.carmelSeats)],
      "standby_carmel_b",
      { same_room: true, same_gender: true },
    ),
    guardPosition("ש״ג רכב אחורי", []),
    guardPosition("ש״ג רכב קדמי", []),
    guardPosition("פטל", []),
    guardPosition("תצפיתן", []),
    guardPosition("ש״ג רגלי", []),
    guardPosition("ימ״ח", []),
    guardPosition("נשקייה", []),
    guardPosition("בונקר", []),
    guardPosition("כוח עתודה", [], "duty"),
    guardPosition("קצין תורן", [], "officer_duty"),
  ];

  const synced = syncGuardShiftSlots(positions, options);
  const hasBaseWork = synced.some((p) => isBaseWorkPosition(p));
  const hasPatrol = synced.some((p) => isPatrolPosition(p));
  const hasHamagshiyot = synced.some((p) => isHamagshiyotPosition(p));
  const missionDate = ctx.missionDate ?? options?.missionDate;

  const extras: MissionPosition[] = [];
  if (!hasBaseWork) {
    extras.push(
      ...materializeBaseWorkPositions(
        defaultBaseWorkPositions({
          seatsPerShift: options?.baseWorkSeatsPerShift,
        }),
        ctx.missionStartsAt,
        ctx.missionEndsAt,
        missionDate,
      ),
    );
  }
  if (!hasPatrol) {
    extras.push(...defaultPatrolPositions({ missionDate }));
  }
  if (!hasHamagshiyot) {
    extras.push(...defaultHamagshiyotPositions({ missionDate }));
  }

  return [...synced, ...extras];
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
    case "patrol":
      return "סיורים לפי הפקודה — ככ״א או קצין תורן נוכחי. 1 נק׳ שמירה לסיור; חוסם זמן (לא חופף משמרות אחרות).";
    case "duty":
      if (pos.name.includes("עתודה")) {
        return "5 צוערים תמיד — משמרות מסתובבות לאורך כל יום המשימה.";
      }
      if (pos.name.includes("עבודות בסיס") || pos.name.includes("עב״ס")) {
        return "3 חלונות (בוקר/צהריים/ערב) — 13–15 צוערים בכל חלון לפי צדק.";
      }
      return null;
    default:
      break;
  }
  if (pos.name.includes("רכב אחורי")) {
    return "בדיוק 1 שומר 06:00–18:00, בדיוק 2 בכל שאר השעות. חלונות משמרת נקבעים לפי פרופיל הכיסוי.";
  }
  if (pos.name.includes("רכב קדמי")) {
    return "2 שומרים בכל משמרת — משמרות ~4 שעות מעוגנות לתחילת יום המשימה.";
  }
  if (pos.name.includes("רגלי")) {
    return "בדיוק 1 שומר 06:00–19:00. אין משמרות מחוץ לשעות הפעילות.";
  }
  if (pos.name.includes("חמגש")) {
    return "5 צוערים בכל חלון (07–08, 12–13, 18–19). 1 נק׳ תורנות למשמרת.";
  }
  if (["פטל", "תצפיתן", "ימ״ח", "נשקייה", "בונקר"].some((n) => pos.name.includes(n))) {
    return "משמרות מסתובבות ~4 שעות מעוגנות לתחילת יום המשימה.";
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
  { bucket: "duty", label: "עב״ס / עתודה", default: 0.1, examples: "עב״ס 0.75/שעה · עתודה 0.3/שעה" },
  { bucket: "kitchen", label: "מטבch", default: 0.1, examples: "35 למשמרת" },
] as const;

/** @deprecated Unused — unified grid removed. */
export function buildUnifiedGuardShiftWindows(
  boardStart: string,
  cycleMin: number,
  shiftHours: number,
): GuardShiftWindow[] {
  return buildPureFourHourShiftWindows(boardStart, cycleMin, shiftHours);
}

/** @deprecated Unused — replaced by staffing-profile segments. */
export function dayNightSegmentsInCycle(): Array<{ startMin: number; endMin: number; seats: number }> {
  return [];
}
