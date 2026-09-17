import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  isGuardKind,
  isReserveForcePositionName,
  isReserveForceSlot,
  type FlatSlot,
} from "@/lib/mission-utils";
import { normalizeTimeLabel, parseTimeMinutes } from "@/lib/time-interval";
import type { MissionDay, MissionPosition, MissionSlot } from "@/lib/types";

export type GuardShiftPositionEntry = {
  positionId: string;
  positionName: string;
  assignees: string[];
  seatCount: number;
};

export type GuardShiftRosterView = {
  windowKey: string;
  sortKey: number;
  timeLabel: string;
  startTime: string;
  endTime: string;
  positions: GuardShiftPositionEntry[];
  /** כל השמות המשובצים בגלגול — ממוינים, ללא כפילויות */
  allNames: string[];
  assignedCount: number;
  seatCapacity: number;
  /** חלון שמכיל רק כוח עתודה (בלי עמדות שמירה) */
  reserveOnly: boolean;
};

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "he");
}

export function guardShiftWindowKey(
  slot: Pick<FlatSlot, "startTime" | "endTime">,
): string {
  return `${slot.startTime}-${slot.endTime}`;
}

function isGuardMissionSlot(slot: FlatSlot): boolean {
  return slot.missionType === "guards" && isGuardKind(slot.positionKind);
}

function isRosterShiftSlot(slot: FlatSlot): boolean {
  return isGuardMissionSlot(slot) || isReserveForceSlot(slot);
}

function isRemovableShiftSlot(slot: FlatSlot): boolean {
  return (
    slot.missionType === "guards" &&
    (slot.positionKind === "guard" || isReserveForceSlot(slot))
  );
}

function isRemovableShiftPosition(pos: MissionPosition): boolean {
  return (
    pos.kind === "guard" ||
    (pos.kind === "duty" && isReserveForcePositionName(pos.name))
  );
}

function removableSlotIdsForWindow(mission: MissionDay, key: string): string[] {
  const slots = flattenMissionSlots(mission, effectiveBoardStartMin(mission));
  return slots
    .filter((slot) => isRemovableShiftSlot(slot) && guardShiftWindowKey(slot) === key)
    .map((slot) => slot.slotId);
}

function clockLabel(value: string): string {
  const raw = String(value || "").trim();
  const withSeconds = /^(\d{1,2}):(\d{2}):\d{2}$/.exec(raw);
  return normalizeTimeLabel(withSeconds ? `${withSeconds[1]}:${withSeconds[2]}` : raw);
}

function slotWithWindowTimes(slot: MissionSlot, start: string, end: string): MissionSlot {
  const next: MissionSlot = {
    id: slot.id,
    start_time: start,
    end_time: end,
    seat_count: slot.seat_count,
  };
  if (slot.label) next.label = slot.label;
  return next;
}

export type RemoveGuardShiftWindowResult = {
  mission: MissionDay;
  removedSlotIds: string[];
  removedNames: string[];
};

export type ResizeGuardShiftWindowResult =
  | {
      ok: true;
      mission: MissionDay;
      resizedSlotIds: string[];
      startTime: string;
      endTime: string;
    }
  | { ok: false; error: string };

/**
 * Deletes cadet-guard and reserve-force slots in one time window and drops
 * their assignments. Used to retroactively remove a rotation that did not happen.
 */
export function removeGuardSlotsForWindow(
  mission: MissionDay,
  windowKey: string,
): RemoveGuardShiftWindowResult {
  const key = windowKey.trim();
  if (!key || mission.mission_type !== "guards") {
    return { mission, removedSlotIds: [], removedNames: [] };
  }

  const removedSlotIds = removableSlotIdsForWindow(mission, key);
  const remove = new Set(removedSlotIds);
  if (!remove.size) {
    return { mission, removedSlotIds: [], removedNames: [] };
  }

  const removedNames = [
    ...new Set(
      removedSlotIds.flatMap((id) =>
        (mission.assignments[id] || []).map((n) => n.trim()).filter(Boolean),
      ),
    ),
  ].sort(compareNames);

  const positions = mission.positions.map((pos) =>
    isRemovableShiftPosition(pos)
      ? { ...pos, slots: pos.slots.filter((slot) => !remove.has(slot.id)) }
      : pos,
  );
  const assignments = { ...mission.assignments };
  const lockedSeats = { ...(mission.locked_seats || {}) };
  for (const id of removedSlotIds) {
    delete assignments[id];
    delete lockedSeats[id];
  }

  return {
    mission: {
      ...mission,
      positions,
      assignments,
      locked_seats: lockedSeats,
    },
    removedSlotIds,
    removedNames,
  };
}

/**
 * Changes start/end of cadet-guard and reserve-force slots in one window.
 * Assignments and locks stay on the same slot ids.
 */
export function resizeGuardSlotsForWindow(
  mission: MissionDay,
  windowKey: string,
  startTime: string,
  endTime: string,
): ResizeGuardShiftWindowResult {
  const key = windowKey.trim();
  const start = clockLabel(startTime);
  const end = clockLabel(endTime);
  if (!key || mission.mission_type !== "guards") {
    return { ok: false, error: "עריכת שעות זמינה רק ביום שמירות" };
  }
  if (parseTimeMinutes(start) === null || parseTimeMinutes(end) === null) {
    return { ok: false, error: "שעות לא תקינות" };
  }
  if (start === end) {
    return { ok: false, error: "שעת ההתחלה והסיום לא יכולות להיות זהות" };
  }

  const resizedSlotIds = removableSlotIdsForWindow(mission, key);
  if (!resizedSlotIds.length) {
    return { ok: false, error: "לא נמצא גלגול שמירה או עתודה בשעות אלה" };
  }

  const newKey = `${start}-${end}`;
  if (newKey !== key) {
    const occupied = removableSlotIdsForWindow(mission, newKey);
    if (occupied.length) {
      return { ok: false, error: "כבר קיים גלגול שמירה או עתודה באותן שעות" };
    }
  }

  const resize = new Set(resizedSlotIds);
  const positions = mission.positions.map((pos) =>
    isRemovableShiftPosition(pos)
      ? {
          ...pos,
          slots: pos.slots.map((slot) =>
            resize.has(slot.id) ? slotWithWindowTimes(slot, start, end) : slot,
          ),
        }
      : pos,
  );

  return {
    ok: true,
    mission: { ...mission, positions },
    resizedSlotIds,
    startTime: start,
    endTime: end,
  };
}

/** רשימת גלגולי שמירה — לכל חלון זמן, מי משובץ בכל עמדת שמירה */
export function guardShiftRosterViewsFromSlots(
  slots: FlatSlot[],
  positionOrder: Map<string, number>,
): GuardShiftRosterView[] {
  const byWindow = new Map<
    string,
    {
      sortKey: number;
      timeLabel: string;
      startTime: string;
      endTime: string;
      positions: GuardShiftPositionEntry[];
      seatCapacity: number;
    }
  >();

  for (const slot of slots.filter(isRosterShiftSlot)) {
    const key = guardShiftWindowKey(slot);
    let row = byWindow.get(key);
    if (!row) {
      row = {
        sortKey: slot.sortKey,
        timeLabel: slot.timeLabel,
        startTime: slot.startTime,
        endTime: slot.endTime,
        positions: [],
        seatCapacity: 0,
      };
      byWindow.set(key, row);
    }
    row.sortKey = Math.min(row.sortKey, slot.sortKey);
    row.seatCapacity += slot.seatCount;
    row.positions.push({
      positionId: slot.positionId,
      positionName: slot.positionName,
      assignees: slot.assignees.filter((n) => n?.trim()),
      seatCount: slot.seatCount,
    });
  }

  return [...byWindow.values()]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((row) => {
      const positions = row.positions.slice().sort(
        (a, b) =>
          (positionOrder.get(a.positionId) ?? 999) -
          (positionOrder.get(b.positionId) ?? 999),
      );
      const allNames = [...new Set(positions.flatMap((p) => p.assignees))].sort(
        compareNames,
      );
      const reserveOnly =
        positions.length > 0 &&
        positions.every((p) => isReserveForcePositionName(p.positionName));
      return {
        windowKey: guardShiftWindowKey(row),
        sortKey: row.sortKey,
        timeLabel: row.timeLabel,
        startTime: row.startTime,
        endTime: row.endTime,
        positions,
        allNames,
        assignedCount: allNames.length,
        seatCapacity: row.seatCapacity,
        reserveOnly,
      };
    });
}

export function guardShiftRosterViews(
  mission: MissionDay,
  boardStartMin?: number,
): GuardShiftRosterView[] {
  const t0 = boardStartMin ?? effectiveBoardStartMin(mission);
  const slots = flattenMissionSlots(mission, t0);
  const positionOrder = new Map(
    (mission.positions || []).map((p, i) => [p.id, i]),
  );
  return guardShiftRosterViewsFromSlots(slots, positionOrder);
}
