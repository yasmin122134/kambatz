import type { MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_KITCHEN_SCHEDULING_RULES } from "@/lib/types";

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

/**
 * תורנות מטבח — 40 צוערים בכל משמרת, 4 משמרות ביום (06–22).
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
