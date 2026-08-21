import type { FlatSlot } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import type {
  AssignmentUnit,
  CarmelFeasibilitySnapshot,
  GlobalAssignOutput,
  UnresolvedRequirement,
} from "./types";

export function countRequiredSeats(units: AssignmentUnit[]): number {
  return units.reduce((sum, u) => {
    if (u.kind === "carmel") return sum + u.need;
    return sum + 1;
  }, 0);
}

export function countFilledSeats(
  units: AssignmentUnit[],
  assignmentsByMission: Map<string, Record<string, string[]>>,
): number {
  let filled = 0;
  for (const unit of units) {
    const seats = assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    if (unit.kind === "carmel") {
      filled += unit.seatIndices.filter((i) => Boolean(seats[i])).length;
    } else if (seats[unit.seatIndex]) {
      filled += 1;
    }
  }
  return filled;
}

export function buildUnresolvedRequirements(input: {
  units: AssignmentUnit[];
  assignmentsByMission: Map<string, Record<string, string[]>>;
  carmelSnapshots: CarmelFeasibilitySnapshot[];
  failureReasons: Map<string, string[]>;
}): UnresolvedRequirement[] {
  const bySlot = new Map<string, UnresolvedRequirement>();

  for (const unit of input.units) {
    const seats = input.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    const key = `${unit.mission.id}:${unit.slot.slotId}`;

    if (unit.kind === "carmel") {
      const assigned = unit.seatIndices.filter((i) => Boolean(seats[i])).length;
      const required = unit.need;
      if (assigned >= required) continue;
      const snapshot = input.carmelSnapshots.find((s) => s.slotId === unit.slot.slotId);
      bySlot.set(key, {
        missionId: unit.mission.id,
        positionName: unit.slot.positionName,
        timeLabel: unit.slot.timeLabel,
        requiredSeats: required,
        assignedSeats: assigned,
        reasons: input.failureReasons.get(key) || [
          "לא נותרה קבוצת חדר/מגדר תקפה לאחר שיבוצים אחרים",
        ],
        carmelSnapshot: snapshot,
      });
      continue;
    }

    if (seats[unit.seatIndex]) continue;
    const existing = bySlot.get(key);
    if (existing) {
      existing.requiredSeats += 1;
      continue;
    }
    bySlot.set(key, {
      missionId: unit.mission.id,
      positionName: unit.slot.positionName,
      timeLabel: unit.slot.timeLabel,
      requiredSeats: 1,
      assignedSeats: 0,
      reasons: input.failureReasons.get(key) || ["לא נמצא צוער שעומד בכללים"],
    });
  }

  return [...bySlot.values()];
}

export function formatUnresolvedSummary(unresolved: UnresolvedRequirement[]): string[] {
  if (!unresolved.length) return [];
  const lines = [`Smart assignment completed with ${unresolved.length} unresolved requirements:`];
  for (const item of unresolved) {
    const missing = item.requiredSeats - item.assignedSeats;
    lines.push(`${item.positionName} ${item.timeLabel}`);
    lines.push(`- ${missing} seats missing`);
    for (const reason of item.reasons) lines.push(`- ${reason}`);
    if (item.carmelSnapshot) {
      lines.push(
        `- ${item.carmelSnapshot.initialGroupCount} possible room groups existed before other assignments`,
      );
      if (item.carmelSnapshot.initialRooms.length) {
        const rooms = item.carmelSnapshot.initialRooms
          .map((r) => `Room ${r.room}: ${r.candidateCount} groups`)
          .join(", ");
        lines.push(`- initially feasible rooms: ${rooms}`);
      }
    }
  }
  return lines;
}

export function deriveStatus(
  filled: number,
  required: number,
  validationErrors: string[],
): GlobalAssignOutput["status"] {
  if (validationErrors.length) {
    return filled >= required ? "partial" : filled === 0 ? "infeasible" : "partial";
  }
  if (filled >= required) return "complete";
  if (filled === 0) return "infeasible";
  return "partial";
}

export function slotLabel(slot: FlatSlot): string {
  return `${slot.positionName} ${slot.timeLabel}`;
}

export function missionRequiredSeats(mission: MissionDay): number {
  let total = 0;
  for (const pos of mission.positions) {
    for (const slot of pos.slots) {
      total += slot.seat_count;
    }
  }
  return total;
}
