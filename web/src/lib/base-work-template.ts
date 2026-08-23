import type { MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_BASE_WORK_SCHEDULING_RULES } from "@/lib/types";
import {
  localMissionMidnightMs,
  materializeSlotAbsoluteBounds,
  normalizeTimeLabel,
  parseIsoMs,
  parseTimeMinutes,
  resolveCanonicalSlotInterval,
  slotDurationMinutes,
  type TimeInterval,
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
  if (isBaseWorkOfficerPositionName(n)) return false;
  return n.includes("עבודות בסיס") || n.includes("עב״ס");
}

export function isBaseWorkOfficerPositionName(name: string): boolean {
  const n = name.trim();
  return /אחראי/.test(n) && (n.includes("עב") || n.includes("עב״ס"));
}

export function isBaseWorkOfficerPosition(pos: Pick<MissionPosition, "name">): boolean {
  return isBaseWorkOfficerPositionName(pos.name);
}

/** עמדות שמוצגות בלוח/עורך תחת «עב״ס». */
export function isBaseWorkPanelPosition(pos: Pick<MissionPosition, "name">): boolean {
  return isBaseWorkPosition(pos) || isBaseWorkOfficerPosition(pos);
}

export function isBaseWorkPosition(pos: Pick<MissionPosition, "name">): boolean {
  return isBaseWorkPositionName(pos.name);
}

export const BASE_WORK_SLOT_WINDOWS = [
  ["08:30", "11:30"],
  ["13:30", "17:30"],
  ["18:30", "20:00"],
] as const;

/** שעות קבועות על תאריך mission_date (שעון ישראל) — לא תלוי בחלון השמירות. */
export function baseWorkWallClockInterval(
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

/** עב״ס — תמיד mission_date + שעות הקיר מהמשמרת (08:30, 13:30, 18:30…). */
export function resolveBaseWorkSlotInterval(
  missionDate: string,
  missionStartsAt: string,
  missionEndsAt: string,
  slot: { start_time: string; end_time: string; starts_at?: string; ends_at?: string },
): TimeInterval | null {
  const fixed = baseWorkWallClockInterval(missionDate, slot.start_time, slot.end_time);
  if (fixed) return fixed;

  // legacy standalone base_work mission — fall back to mission window
  return resolveCanonicalSlotInterval(
    { starts_at: missionStartsAt, ends_at: missionEndsAt },
    slot,
  );
}
export function materializeBaseWorkSlots(
  slots: MissionSlot[],
  missionStartsAt: string,
  missionEndsAt: string,
  missionDate?: string,
): MissionSlot[] {
  return slots.map((slot) => {
    const interval = missionDate
      ? resolveBaseWorkSlotInterval(missionDate, missionStartsAt, missionEndsAt, slot)
      : resolveCanonicalSlotInterval(
          { starts_at: missionStartsAt, ends_at: missionEndsAt },
          slot,
        );
    if (!interval) {
      return { ...slot, starts_at: undefined, ends_at: undefined };
    }
    return { ...slot, ...materializeSlotAbsoluteBounds(slot, interval) };
  });
}

export function materializeBaseWorkPositions(
  positions: MissionPosition[],
  missionStartsAt: string,
  missionEndsAt: string,
  missionDate?: string,
): MissionPosition[] {
  return positions.map((pos) =>
    isBaseWorkPanelPosition(pos)
      ? {
          ...pos,
          slots: materializeBaseWorkSlots(
            pos.slots,
            missionStartsAt,
            missionEndsAt,
            missionDate,
          ),
        }
      : pos,
  );
}

/** עבודות בסיס — 3 חלונות; צוות שלם (~13–15) + אחראי עב״ס (1 בכל חלון) */
export function defaultBaseWorkPositions(options?: { seatsPerShift?: number }): MissionPosition[] {
  const seats = options?.seatsPerShift ?? DEFAULT_BASE_WORK_SCHEDULING_RULES.seats_per_shift;
  const bulkSlots: MissionSlot[] = [
    newSlot("08:30", "11:30", seats),
    newSlot("13:30", "17:30", seats),
    newSlot("18:30", "20:00", seats),
  ];
  const officerSlots: MissionSlot[] = [
    newSlot("08:30", "11:30", 1),
    newSlot("13:30", "17:30", 1),
    newSlot("18:30", "20:00", 1),
  ];

  return [
    {
      id: uid(),
      name: "עבודות בסיס",
      kind: "duty",
      slots: bulkSlots,
    },
    {
      id: uid(),
      name: "אחראי עב״ס",
      kind: "duty",
      slots: officerSlots,
    },
  ];
}
