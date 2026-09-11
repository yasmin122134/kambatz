import type { MissionDay, MissionPosition, MissionSlot } from "@/lib/types";
import { syncAssignmentSeats } from "@/lib/mission-utils";

export function emptyLockedSeats(positions: MissionPosition[]): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  for (const pos of positions) {
    for (const slot of pos.slots) {
      out[slot.id] = Array.from({ length: slot.seat_count }, () => false);
    }
  }
  return out;
}

export function syncLockedSeats(
  positions: MissionPosition[],
  locked: Record<string, boolean[]> | undefined | null,
): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  for (const pos of positions) {
    for (const slot of pos.slots) {
      const cur = locked?.[slot.id] || [];
      out[slot.id] = Array.from({ length: slot.seat_count }, (_, i) => Boolean(cur[i]));
    }
  }
  return out;
}

/** Empty seats cannot stay locked. */
export function syncLockedSeatsWithAssignments(
  positions: MissionPosition[],
  assignments: Record<string, string[]>,
  locked: Record<string, boolean[]> | undefined | null,
): Record<string, boolean[]> {
  const syncedAssignments = syncAssignmentSeats(positions, assignments);
  const syncedLocks = syncLockedSeats(positions, locked);
  for (const pos of positions) {
    for (const slot of pos.slots) {
      const seats = syncedAssignments[slot.id] || [];
      syncedLocks[slot.id] = (syncedLocks[slot.id] || []).map(
        (isLocked, i) => Boolean(isLocked && seats[i]),
      );
    }
  }
  return syncedLocks;
}

export function isSeatLocked(
  mission: Pick<MissionDay, "locked_seats">,
  slotId: string,
  seatIndex: number,
): boolean {
  return Boolean(mission.locked_seats?.[slotId]?.[seatIndex]);
}

export function shouldKeepSeatOnAssign(
  mission: Pick<MissionDay, "locked_seats">,
  slotId: string,
  seatIndex: number,
  name: string | undefined,
  keepExisting: boolean,
): boolean {
  if (!name) return false;
  return keepExisting || isSeatLocked(mission, slotId, seatIndex);
}

export function lockFilledSeats(
  positions: MissionPosition[],
  assignments: Record<string, string[]>,
): Record<string, boolean[]> {
  const synced = syncAssignmentSeats(positions, assignments);
  const out = emptyLockedSeats(positions);
  for (const pos of positions) {
    for (const slot of pos.slots) {
      const seats = synced[slot.id] || [];
      out[slot.id] = Array.from({ length: slot.seat_count }, (_, i) => Boolean(seats[i]));
    }
  }
  return out;
}

export function withSeatLock(
  mission: MissionDay,
  slotId: string,
  seatIndex: number,
  locked: boolean,
): MissionDay {
  const lockedSeats = syncLockedSeats(mission.positions, mission.locked_seats);
  const row = [...(lockedSeats[slotId] || [])];
  while (row.length <= seatIndex) row.push(false);
  const name = (mission.assignments[slotId] || [])[seatIndex];
  row[seatIndex] = Boolean(locked && name);
  lockedSeats[slotId] = row;
  return { ...mission, locked_seats: lockedSeats };
}

export function restoreLockedAssignments(
  mission: MissionDay,
  nextAssignments: Record<string, string[]>,
): Record<string, string[]> {
  const original = syncAssignmentSeats(mission.positions, mission.assignments);
  const next = syncAssignmentSeats(mission.positions, nextAssignments);
  const locks = syncLockedSeats(mission.positions, mission.locked_seats);
  for (const pos of mission.positions) {
    for (const slot of pos.slots) {
      const row = [...(next[slot.id] || [])];
      const orig = original[slot.id] || [];
      const slotLocks = locks[slot.id] || [];
      for (let i = 0; i < slot.seat_count; i++) {
        if (slotLocks[i] && orig[i]) row[i] = orig[i];
      }
      next[slot.id] = row;
    }
  }
  return next;
}

export function reconcileLockedSeatsOnStructureChange(
  prevPositions: MissionPosition[],
  nextPositions: MissionPosition[],
  locked: Record<string, boolean[]> | undefined | null,
): Record<string, boolean[]> {
  const prevSlotById = new Map<string, MissionSlot>();
  for (const pos of prevPositions) {
    for (const slot of pos.slots) {
      prevSlotById.set(slot.id, slot);
    }
  }

  const kept: Record<string, boolean[]> = {};
  for (const pos of nextPositions) {
    for (const slot of pos.slots) {
      const prev = prevSlotById.get(slot.id);
      const unchanged =
        prev &&
        prev.start_time === slot.start_time &&
        prev.end_time === slot.end_time &&
        prev.seat_count === slot.seat_count;
      if (unchanged && locked?.[slot.id]?.some(Boolean)) {
        kept[slot.id] = locked[slot.id];
      }
    }
  }
  return syncLockedSeats(nextPositions, kept);
}
