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
