/**
 * Mission lifecycle phases — enforced separation of structure vs assignment.
 *
 * CREATE / EDIT STRUCTURE  → may change positions, slots, times, seat counts
 * SMART ASSIGN             → assignments only
 * MANUAL ASSIGN            → assignments only
 * PUBLISH                  → status only
 * VIEW                     → read only
 */

import type { MissionDay, MissionPosition, MissionSlot } from "@/lib/types";
import { isBaseWorkPosition, resolveBaseWorkSlotInterval } from "@/lib/base-work-template";
import { officerDutySlotsValid } from "@/lib/guard-day-template";
import { positionUsesWallClockSchedule } from "@/lib/mission-utils";
import { resolveCanonicalSlotInterval } from "@/lib/time-interval";

export type MissionStructureSnapshot = {
  starts_at: string;
  ends_at: string;
  positions: Array<{
    id: string;
    name: string;
    slots: Array<{
      id: string;
      start_time: string;
      end_time: string;
      seat_count: number;
      starts_at: string | null;
      ends_at: string | null;
    }>;
  }>;
};

export type MissionAssignmentPayload = Pick<MissionDay, "assignments">;

/** Snapshot persisted slot structure — used to detect illegal mutation during assignment. */
export function snapshotMissionStructure(mission: MissionDay): MissionStructureSnapshot {
  return {
    starts_at: mission.starts_at,
    ends_at: mission.ends_at,
    positions: (mission.positions || []).map((pos) => ({
      id: pos.id,
      name: pos.name,
      slots: (pos.slots || []).map((slot) => ({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        seat_count: slot.seat_count,
        starts_at: slot.starts_at ?? null,
        ends_at: slot.ends_at ?? null,
      })),
    })),
  };
}

export function fingerprintMissionStructure(mission: MissionDay): string {
  return JSON.stringify(snapshotMissionStructure(mission));
}

export function assertMissionStructureUnchanged(
  before: MissionStructureSnapshot,
  after: MissionStructureSnapshot,
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("BUG: Smart Assignment modified mission slot structure");
  }
}

/** Validate slot structure before assigning people — does NOT repair or regenerate. */
export function validateMissionStructureForAssignment(mission: MissionDay): string[] {
  const messages: string[] = [];
  const missionStartMs = Date.parse(mission.starts_at);
  const missionEndMs = Date.parse(mission.ends_at);

  if (Number.isNaN(missionStartMs) || Number.isNaN(missionEndMs) || missionEndMs <= missionStartMs) {
    messages.push("Mission interval is invalid (starts_at / ends_at)");
    return messages;
  }

  if (!mission.positions?.length) {
    messages.push("Mission has no positions — generate structure before assignment");
    return messages;
  }

  const slotIds = new Set<string>();
  for (const pos of mission.positions) {
    if (!pos.slots?.length) {
      messages.push(`${pos.name}: position has no slots`);
      continue;
    }
    if (pos.kind === "officer_duty" && !officerDutySlotsValid(pos.slots, mission.starts_at, mission.ends_at)) {
      messages.push(
        `${pos.name}: שתי משמרות בדיוק — כל אחת חצי מחזור המשימה (${mission.starts_at} → ${mission.ends_at})`,
      );
    }
    for (const slot of pos.slots) {
      if (slotIds.has(slot.id)) {
        messages.push(`${pos.name}: duplicate slot id ${slot.id}`);
      }
      slotIds.add(slot.id);

      if (slot.seat_count < 1) {
        messages.push(`${pos.name} ${slot.start_time}–${slot.end_time}: seat_count must be >= 1`);
      }

      const interval = isBaseWorkPosition(pos)
        ? resolveBaseWorkSlotInterval(
            mission.mission_date,
            mission.starts_at,
            mission.ends_at,
            slot,
          )
        : resolveCanonicalSlotInterval(mission, slot);
      if (!interval) {
        messages.push(
          `${pos.name} ${slot.start_time}–${slot.end_time}: cannot resolve absolute interval within mission window`,
        );
        continue;
      }

      if (interval.startMs >= interval.endMs) {
        messages.push(`${pos.name} ${slot.start_time}–${slot.end_time}: start >= end`);
      }
      if (!positionUsesWallClockSchedule(pos, slot)) {
        if (interval.startMs < missionStartMs || interval.endMs > missionEndMs) {
          messages.push(
            `${pos.name} ${slot.start_time}–${slot.end_time}: outside mission interval`,
          );
        }
      }
    }
  }

  return messages;
}

/** Apply assignments to a mission without touching structure fields. */
export function applyAssignmentsOnly(
  mission: MissionDay,
  assignments: Record<string, string[]>,
): MissionDay {
  return {
    ...mission,
    assignments,
    positions: mission.positions,
    starts_at: mission.starts_at,
    ends_at: mission.ends_at,
  };
}

export function cloneMissionPositions(positions: MissionPosition[]): MissionPosition[] {
  return positions.map((pos) => ({
    ...pos,
    slots: pos.slots.map((slot) => ({ ...slot })),
  }));
}

export function cloneMissionSlots(slots: MissionSlot[]): MissionSlot[] {
  return slots.map((slot) => ({ ...slot }));
}
