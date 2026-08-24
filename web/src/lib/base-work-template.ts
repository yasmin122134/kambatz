import type { MissionDay, MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_BASE_WORK_SCHEDULING_RULES } from "@/lib/types";
import type { FlatSlot } from "@/lib/mission-utils";
import { normalizeSchedulingRules } from "@/lib/mission-utils";
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
  return n.includes("עבודות בסיס") || n.includes("עב״ס");
}

export function isBaseWorkPosition(pos: Pick<MissionPosition, "name">): boolean {
  return isBaseWorkPositionName(pos.name);
}

export const BASE_WORK_SLOT_WINDOWS = [
  ["08:30", "11:30"],
  ["13:30", "17:30"],
  ["18:30", "20:00"],
] as const;

export function isBaseWorkShiftSlot(startTime: string, endTime: string): boolean {
  const start = normalizeTimeLabel(startTime);
  const end = normalizeTimeLabel(endTime);
  return BASE_WORK_SLOT_WINDOWS.some(([s, e]) => s === start && e === end);
}

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
    isBaseWorkPosition(pos)
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

/** עבודות בסיס — 3 חלונות; 13–15 צוערים בכל חלון */
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

export function isBaseWorkFlatSlot(
  slot: Pick<FlatSlot, "missionType" | "baseWorkShiftIndex" | "positionName">,
): boolean {
  if (slot.missionType === "base_work") return true;
  if (slot.baseWorkShiftIndex !== undefined) return true;
  return isBaseWorkPositionName(slot.positionName);
}

export function getBaseWorkSlotLeader(mission: MissionDay, slotId: string): string | null {
  const leader = mission.scheduling_rules.base_work?.slot_leaders?.[slotId]?.trim();
  if (!leader) return null;
  const seats = mission.assignments[slotId] || [];
  return seats.includes(leader) ? leader : null;
}

export function withBaseWorkSlotLeader(
  mission: MissionDay,
  slotId: string,
  leaderName: string | null,
): MissionDay {
  const rules = normalizeSchedulingRules(mission.scheduling_rules);
  const slotLeaders = { ...(rules.base_work?.slot_leaders ?? {}) };
  const trimmed = leaderName?.trim() || "";
  if (trimmed) slotLeaders[slotId] = trimmed;
  else delete slotLeaders[slotId];

  const nextLeaders = Object.keys(slotLeaders).length ? slotLeaders : undefined;
  return {
    ...mission,
    scheduling_rules: {
      ...rules,
      base_work: {
        ...rules.base_work!,
        slot_leaders: nextLeaders,
      },
    },
  };
}

/** מסיר אחראים שלא משובצים; ממלא אחראי ראשון אם חסר בחלון עם צוות. */
export function ensureBaseWorkLeaders(mission: MissionDay): MissionDay {
  const rules = normalizeSchedulingRules(mission.scheduling_rules);
  const slotLeaders = { ...(rules.base_work?.slot_leaders ?? {}) };
  let changed = false;

  for (const pos of mission.positions || []) {
    if (!isBaseWorkPosition(pos)) continue;
    for (const slot of pos.slots || []) {
      const seats = (mission.assignments[slot.id] || []).filter(Boolean);
      const current = slotLeaders[slot.id];
      if (current && !seats.includes(current)) {
        delete slotLeaders[slot.id];
        changed = true;
      }
      if (seats.length && !slotLeaders[slot.id]) {
        slotLeaders[slot.id] = seats[0];
        changed = true;
      }
      if (!seats.length && slotLeaders[slot.id]) {
        delete slotLeaders[slot.id];
        changed = true;
      }
    }
  }

  if (!changed && Object.keys(slotLeaders).length === Object.keys(rules.base_work?.slot_leaders ?? {}).length) {
    return mission;
  }

  const nextLeaders = Object.keys(slotLeaders).length ? slotLeaders : undefined;
  return {
    ...mission,
    scheduling_rules: {
      ...rules,
      base_work: {
        ...rules.base_work!,
        slot_leaders: nextLeaders,
      },
    },
  };
}
