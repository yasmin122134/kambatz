import type { MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_KITCHEN_SCHEDULING_RULES } from "@/lib/types";
import {
  materializeSlotAbsoluteBounds,
  resolveCanonicalSlotInterval,
  wallClockIntervalOnCalendarDate,
  type TimeInterval,
} from "@/lib/time-interval";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start: string, end: string, seats: number): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

export type KitchenShiftDef = { start: string; end: string; label?: string };

export const DEFAULT_KITCHEN_SHIFTS: KitchenShiftDef[] = [
  { start: "06:00", end: "10:00", label: "בוקר" },
  { start: "10:00", end: "15:00", label: "צהריים" },
  { start: "15:00", end: "19:00", label: "אחה״צ" },
  { start: "19:00", end: "22:00", label: "ערב" },
];

/** מטבch — תמיד mission_date + שעות קיר (06:00–22:00), לא תלוי ב-starts_at שגוי. */
export function resolveKitchenSlotInterval(
  missionDate: string,
  missionStartsAt: string,
  missionEndsAt: string,
  slot: { start_time: string; end_time: string; starts_at?: string; ends_at?: string },
): TimeInterval | null {
  const fixed = wallClockIntervalOnCalendarDate(
    missionDate,
    slot.start_time,
    slot.end_time,
  );
  if (fixed) return fixed;
  return resolveCanonicalSlotInterval(
    { starts_at: missionStartsAt, ends_at: missionEndsAt },
    slot,
  );
}

export function materializeKitchenSlots(
  slots: MissionSlot[],
  missionStartsAt: string,
  missionEndsAt: string,
  missionDate: string,
): MissionSlot[] {
  return slots.map((slot) => {
    const interval = resolveKitchenSlotInterval(
      missionDate,
      missionStartsAt,
      missionEndsAt,
      slot,
    );
    if (!interval) {
      return { ...slot, starts_at: undefined, ends_at: undefined };
    }
    return {
      ...slot,
      ...materializeSlotAbsoluteBounds(slot, interval),
    };
  });
}

/**
 * תורנות מטבח — 35 צוערים בכל משמרת, 4 משמרות ביום (06–22).
 * שיבוץ לפי 4 צוותים: בכל משמרת צוות אחד במנוחה.
 */
export function defaultKitchenDayPositions(options?: {
  seatsPerShift?: number;
  shifts?: KitchenShiftDef[];
}): MissionPosition[] {
  const seats = options?.seatsPerShift ?? DEFAULT_KITCHEN_SCHEDULING_RULES.seats_per_shift;
  const shifts = options?.shifts ?? DEFAULT_KITCHEN_SHIFTS;

  return [
    {
      id: uid(),
      name: "משמרות מטבח",
      kind: "kitchen",
      slots: shifts.map((s) => newSlot(s.start, s.end, seats)),
    },
  ];
}
