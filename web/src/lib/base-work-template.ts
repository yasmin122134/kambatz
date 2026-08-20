import type { MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_BASE_WORK_SCHEDULING_RULES } from "@/lib/types";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start: string, end: string, seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
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
