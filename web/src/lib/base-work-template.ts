import type { MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_BASE_WORK_SCHEDULING_RULES } from "@/lib/types";
import {
  materializeSlotAbsoluteBounds,
  resolveCanonicalSlotInterval,
} from "@/lib/time-interval";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start: string, end: string, seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

export function isBaseWorkPositionName(name: string): boolean {
  const n = name.trim();
  if (n.includes("עתודה")) return false;
  return n.includes("עבודות בסיס") || n.includes("עב״ס");
}

export function isBaseWorkPosition(pos: Pick<MissionPosition, "name">): boolean {
  return isBaseWorkPositionName(pos.name);
}

/** Materialize ISO bounds on base-work slots so validation works inside guard mission window. */
export function materializeBaseWorkSlots(
  slots: MissionSlot[],
  missionStartsAt: string,
  missionEndsAt: string,
): MissionSlot[] {
  return slots.map((slot) => {
    const interval = resolveCanonicalSlotInterval(
      { starts_at: missionStartsAt, ends_at: missionEndsAt },
      slot,
    );
    if (!interval) return slot;
    return { ...slot, ...materializeSlotAbsoluteBounds(slot, interval) };
  });
}

export function materializeBaseWorkPositions(
  positions: MissionPosition[],
  missionStartsAt: string,
  missionEndsAt: string,
): MissionPosition[] {
  return positions.map((pos) =>
    isBaseWorkPosition(pos)
      ? { ...pos, slots: materializeBaseWorkSlots(pos.slots, missionStartsAt, missionEndsAt) }
      : pos,
  );
}

/** עבודות בסיס — 3 חלונות; צוות שלם (~13–15) בכל חלון */
export function defaultBaseWorkPositions(options?: { seatsPerShift?: number }): MissionPosition[] {
  const seats = options?.seatsPerShift ?? DEFAULT_BASE_WORK_SCHEDULING_RULES.seats_per_shift;
  const slots: MissionSlot[] = [
    newSlot("08:30", "11:30", seats),
    newSlot("13:30", "17:30", seats),
    newSlot("18:30", "20:00", seats),
  ];

  return [
    {
      id: uid(),
      name: "עבודות בסיס",
      kind: "duty",
      slots,
    },
  ];
}
