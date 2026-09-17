import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  isGuardKind,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";

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

export type RemoveGuardShiftWindowResult = {
  mission: MissionDay;
  removedSlotIds: string[];
  removedNames: string[];
};

/**
 * Deletes cadet-guard slots in one time window and drops their assignments.
 * Used to retroactively remove a rotation that did not happen.
 */
export function removeGuardSlotsForWindow(
  mission: MissionDay,
  windowKey: string,
): RemoveGuardShiftWindowResult {
  const key = windowKey.trim();
  if (!key || mission.mission_type !== "guards") {
    return { mission, removedSlotIds: [], removedNames: [] };
  }

  const slots = flattenMissionSlots(mission, effectiveBoardStartMin(mission));
  const removedSlotIds = slots
    .filter(
      (slot) =>
        slot.positionKind === "guard" &&
        guardShiftWindowKey(slot) === key,
    )
    .map((slot) => slot.slotId);
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
    pos.kind === "guard"
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

  for (const slot of slots.filter(isGuardMissionSlot)) {
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
