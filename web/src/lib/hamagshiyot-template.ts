import type { MissionPosition, MissionSlot } from "@/lib/types";
import {
  localMissionMidnightMs,
  materializeSlotAbsoluteBounds,
  normalizeTimeLabel,
  parseIsoMs,
  parseTimeMinutes,
  slotDurationMinutes,
  type TimeInterval,
} from "@/lib/time-interval";

function uid() {
  return crypto.randomUUID();
}

export type HamagshiyotShiftDef = { start: string; end: string };

/** תורנות חמגשיות לפי הפקודה — 5 צוערים בכל חלון */
export const DEFAULT_HAMAGSHIYOT_SHIFTS: HamagshiyotShiftDef[] = [
  { start: "07:00", end: "08:00" },
  { start: "12:00", end: "13:00" },
  { start: "18:00", end: "19:00" },
];

export const DEFAULT_HAMAGSHIYOT_SEATS = 5;

export function isHamagshiyotPositionName(name: string): boolean {
  return name.trim().includes("חמגש");
}

export function isHamagshiyotPosition(pos: Pick<MissionPosition, "name" | "kind">): boolean {
  return pos.kind === "kitchen" && isHamagshiyotPositionName(pos.name);
}

export function isHamagshiyotShiftSlot(startTime: string, endTime: string): boolean {
  const start = normalizeTimeLabel(startTime);
  const end = normalizeTimeLabel(endTime);
  return DEFAULT_HAMAGSHIYOT_SHIFTS.some((s) => s.start === start && s.end === end);
}

export function hamagshiyotWallClockInterval(
  missionDate: string,
  startTime: string,
  endTime: string,
): TimeInterval | null {
  const startMin = parseTimeMinutes(normalizeTimeLabel(startTime));
  const durMin = slotDurationMinutes(startTime, endTime);
  if (startMin === null || durMin <= 0) return null;

  const date = missionDate.slice(0, 10);
  const anchor = parseIsoMs(`${date}T12:00:00+03:00`);
  if (anchor === null) return null;

  const midnight = localMissionMidnightMs(anchor);
  const startMs = midnight + startMin * 60_000;
  const endMs = startMs + durMin * 60_000;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

function materializeHamagshiyotSlot(
  missionDate: string,
  shift: HamagshiyotShiftDef,
  seats: number,
  existing?: MissionSlot,
): MissionSlot {
  const slot: MissionSlot = {
    id: existing?.id ?? uid(),
    start_time: shift.start,
    end_time: shift.end,
    seat_count: existing?.seat_count ?? seats,
  };
  const abs = hamagshiyotWallClockInterval(missionDate, shift.start, shift.end);
  if (abs) {
    Object.assign(slot, materializeSlotAbsoluteBounds(slot, abs));
  }
  return slot;
}

export function materializeHamagshiyotPositions(
  positions: MissionPosition[],
  missionDate?: string,
  seatsPerShift = DEFAULT_HAMAGSHIYOT_SEATS,
): MissionPosition[] {
  const date = missionDate ?? new Date().toISOString().slice(0, 10);
  return positions.map((pos) =>
    isHamagshiyotPosition(pos)
      ? {
          ...pos,
          kind: "kitchen" as const,
          slots: pos.slots.map((slot, i) => {
            const shift =
              DEFAULT_HAMAGSHIYOT_SHIFTS.find(
                (s) =>
                  normalizeTimeLabel(s.start) === normalizeTimeLabel(slot.start_time) &&
                  normalizeTimeLabel(s.end) === normalizeTimeLabel(slot.end_time),
              ) ?? DEFAULT_HAMAGSHIYOT_SHIFTS[i];
            return shift
              ? materializeHamagshiyotSlot(date, shift, seatsPerShift, slot)
              : slot;
          }),
        }
      : pos,
  );
}

export function defaultHamagshiyotPositions(options?: {
  seatsPerShift?: number;
  shifts?: HamagshiyotShiftDef[];
  missionDate?: string;
}): MissionPosition[] {
  const seats = options?.seatsPerShift ?? DEFAULT_HAMAGSHIYOT_SEATS;
  const shifts = options?.shifts ?? DEFAULT_HAMAGSHIYOT_SHIFTS;
  const missionDate = options?.missionDate ?? new Date().toISOString().slice(0, 10);
  return [
    {
      id: uid(),
      name: "חמגשיות",
      kind: "kitchen",
      slots: shifts.map((s) => materializeHamagshiyotSlot(missionDate, s, seats)),
    },
  ];
}
