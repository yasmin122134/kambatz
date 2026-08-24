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
};

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "he");
}

function assigneeSet(slot: FlatSlot): Set<string> {
  return new Set(slot.assignees.map((n) => n.trim()).filter(Boolean));
}

/** Compare assignees between consecutive kitchen shifts (sorted by time). */
export function kitchenShiftHandoffsFromSlots(slots: FlatSlot[]): KitchenShiftHandoff[] {
  const kitchenSlots = slots
    .filter((s) => s.kitchenShiftIndex != null)
    .slice()
    .sort(
      (a, b) =>
        a.sortKey - b.sortKey ||
        (a.kitchenShiftIndex ?? 0) - (b.kitchenShiftIndex ?? 0),
    );

  const handoffs: KitchenShiftHandoff[] = [];
  for (let i = 0; i < kitchenSlots.length - 1; i++) {
    const from = kitchenSlots[i];
    const to = kitchenSlots[i + 1];
    const fromSet = assigneeSet(from);
    const toSet = assigneeSet(to);
    const leaving = [...fromSet].filter((n) => !toSet.has(n)).sort(compareNames);
    const entering = [...toSet].filter((n) => !fromSet.has(n)).sort(compareNames);
    const stayingCount = [...fromSet].filter((n) => toSet.has(n)).length;

    handoffs.push({
      fromShiftIndex: from.kitchenShiftIndex!,
      toShiftIndex: to.kitchenShiftIndex!,
      boundaryTime: from.endTime,
      fromTimeLabel: from.timeLabel,
      toTimeLabel: to.timeLabel,
      leaving,
      entering,
      stayingCount,
    });
  }
  return handoffs;
}

export function kitchenShiftHandoffs(mission: MissionDay): KitchenShiftHandoff[] {
  const boardStartMin = effectiveBoardStartMin(mission);
  const slots = flattenMissionSlots(mission, boardStartMin);
  return kitchenShiftHandoffsFromSlots(slots);
}
