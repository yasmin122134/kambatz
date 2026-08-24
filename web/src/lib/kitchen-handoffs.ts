import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";

export type KitchenShiftHandoff = {
  fromShiftIndex: number;
  toShiftIndex: number;
  boundaryTime: string;
  fromTimeLabel: string;
  toTimeLabel: string;
  leaving: string[];
  entering: string[];
  stayingCount: number;
  fromAssignedCount: number;
  toAssignedCount: number;
  fromSeatCapacity: number;
  toSeatCapacity: number;
};

export type KitchenShiftRosterView = {
  windowKey: string;
  shiftIndex: number;
  sortKey: number;
  timeLabel: string;
  assignedNames: string[];
  assignedCount: number;
  seatCapacity: number;
  absentNames: string[];
  rosterSize: number;
};

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "he");
}

export function kitchenShiftWindowKey(
  slot: Pick<FlatSlot, "startTime" | "endTime">,
): string {
  return `${slot.startTime}-${slot.endTime}`;
}

type ShiftRoster = {
  windowKey: string;
  shiftIndex: number;
  sortKey: number;
  boundaryTime: string;
  timeLabel: string;
  assignees: Set<string>;
  seatCapacity: number;
};

/** One roster per shift window (merges multiple kitchen slots at the same hours). */
export function kitchenShiftRostersFromSlots(slots: FlatSlot[]): ShiftRoster[] {
  const kitchenSlots = slots
    .filter((s) => s.kitchenShiftIndex != null)
    .slice()
    .sort(
      (a, b) =>
        a.sortKey - b.sortKey ||
        (a.kitchenShiftIndex ?? 0) - (b.kitchenShiftIndex ?? 0),
    );

  const byWindow = new Map<string, ShiftRoster>();
  for (const slot of kitchenSlots) {
    const key = kitchenShiftWindowKey(slot);
    let row = byWindow.get(key);
    if (!row) {
      row = {
        windowKey: key,
        shiftIndex: slot.kitchenShiftIndex ?? 0,
        sortKey: slot.sortKey,
        boundaryTime: slot.endTime,
        timeLabel: slot.timeLabel,
        assignees: new Set<string>(),
        seatCapacity: 0,
      };
      byWindow.set(key, row);
    }
    row.seatCapacity += slot.seatCount;
    row.sortKey = Math.min(row.sortKey, slot.sortKey);
    row.shiftIndex = Math.min(row.shiftIndex, slot.kitchenShiftIndex ?? row.shiftIndex);
    for (const name of slot.assignees) {
      const trimmed = name.trim();
      if (trimmed) row.assignees.add(trimmed);
    }
  }

  return [...byWindow.values()].sort(
    (a, b) => a.sortKey - b.sortKey || a.shiftIndex - b.shiftIndex,
  );
}

/** All roster names not assigned to this kitchen shift window. */
export function kitchenAbsentNames(
  assignees: Set<string>,
  rosterNames: string[],
): string[] {
  const roster = [...new Set(rosterNames.map((n) => n.trim()).filter(Boolean))];
  return roster.filter((name) => !assignees.has(name)).sort(compareNames);
}

/** Per-shift roster + who is out (full active roster minus assignees). */
export function kitchenShiftRosterViews(
  slots: FlatSlot[],
  rosterNames: string[],
): KitchenShiftRosterView[] {
  const roster = [...new Set(rosterNames.map((n) => n.trim()).filter(Boolean))];
  return kitchenShiftRostersFromSlots(slots).map((row) => ({
    windowKey: row.windowKey,
    shiftIndex: row.shiftIndex,
    sortKey: row.sortKey,
    timeLabel: row.timeLabel,
    assignedNames: [...row.assignees].sort(compareNames),
    assignedCount: row.assignees.size,
    seatCapacity: row.seatCapacity,
    absentNames: kitchenAbsentNames(row.assignees, roster),
    rosterSize: roster.length,
  }));
}

/** Compare assignees between consecutive kitchen shifts (sorted by time). */
export function kitchenShiftHandoffsFromSlots(slots: FlatSlot[]): KitchenShiftHandoff[] {
  const rosters = kitchenShiftRostersFromSlots(slots);
  const handoffs: KitchenShiftHandoff[] = [];

  for (let i = 0; i < rosters.length - 1; i++) {
    const from = rosters[i];
    const to = rosters[i + 1];
    const leaving = [...from.assignees].filter((n) => !to.assignees.has(n)).sort(compareNames);
    const entering = [...to.assignees].filter((n) => !from.assignees.has(n)).sort(compareNames);
    const stayingCount = [...from.assignees].filter((n) => to.assignees.has(n)).length;

    handoffs.push({
      fromShiftIndex: from.shiftIndex,
      toShiftIndex: to.shiftIndex,
      boundaryTime: from.boundaryTime,
      fromTimeLabel: from.timeLabel,
      toTimeLabel: to.timeLabel,
      leaving,
      entering,
      stayingCount,
      fromAssignedCount: from.assignees.size,
      toAssignedCount: to.assignees.size,
      fromSeatCapacity: from.seatCapacity,
      toSeatCapacity: to.seatCapacity,
    });
  }
  return handoffs;
}

export function kitchenShiftHandoffs(mission: MissionDay): KitchenShiftHandoff[] {
  const boardStartMin = effectiveBoardStartMin(mission);
  const slots = flattenMissionSlots(mission, boardStartMin);
  return kitchenShiftHandoffsFromSlots(slots);
}
