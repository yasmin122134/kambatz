import {
  flattenMissionSlots,
  syncAssignmentSeats,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { MissionDay, MissionPositionKind, MissionType } from "@/lib/types";

export type PersonAssignmentRow = {
  id: string;
  missionId: string;
  missionTitle: string;
  missionDate: string;
  missionType: MissionType;
  slotId: string;
  seatIndex: number;
  positionName: string;
  positionKind: MissionPositionKind;
  timeLabel: string;
  startTime: string;
  endTime: string;
  sortKey: number;
  calendarDayOffset: number;
  startAtMs: number;
};

export type AvailableAssignmentSlot = {
  missionId: string;
  missionTitle: string;
  missionDate: string;
  missionType: MissionType;
  slotId: string;
  seatIndex: number;
  positionName: string;
  timeLabel: string;
  label: string;
};

function rowFromSlot(
  mission: MissionDay,
  slot: FlatSlot,
  seatIndex: number,
): PersonAssignmentRow {
  return {
    id: `${mission.id}:${slot.slotId}:${seatIndex}`,
    missionId: mission.id,
    missionTitle: mission.title,
    missionDate: mission.mission_date,
    missionType: mission.mission_type,
    slotId: slot.slotId,
    seatIndex,
    positionName: slot.positionName,
    positionKind: slot.positionKind,
    timeLabel: slot.timeLabel,
    startTime: slot.startTime,
    endTime: slot.endTime,
    sortKey: slot.sortKey,
    calendarDayOffset: slot.calendarDayOffset,
    startAtMs: slot.startAtMs,
  };
}

/** All seat assignments for one person across published missions. */
export function collectPersonAssignmentRows(
  personName: string,
  missions: MissionDay[],
): PersonAssignmentRow[] {
  const rows: PersonAssignmentRow[] = [];
  for (const mission of missions) {
    const assignments = syncAssignmentSeats(mission.positions, mission.assignments);
    for (const slot of flattenMissionSlots(mission)) {
      const seats = assignments[slot.slotId] || [];
      for (let seatIndex = 0; seatIndex < seats.length; seatIndex++) {
        if (seats[seatIndex] !== personName) continue;
        rows.push(rowFromSlot(mission, slot, seatIndex));
      }
    }
  }
  rows.sort(
    (a, b) =>
      a.startAtMs - b.startAtMs ||
      b.missionDate.localeCompare(a.missionDate) ||
      a.seatIndex - b.seatIndex,
  );
  return rows;
}

/** Empty seats admins can fill when editing a person's schedule. */
export function listAvailableAssignmentSlots(missions: MissionDay[]): AvailableAssignmentSlot[] {
  const options: AvailableAssignmentSlot[] = [];
  for (const mission of missions) {
    const assignments = syncAssignmentSeats(mission.positions, mission.assignments);
    for (const slot of flattenMissionSlots(mission)) {
      const seats = assignments[slot.slotId] || [];
      for (let seatIndex = 0; seatIndex < Math.max(seats.length, slot.seatCount); seatIndex++) {
        if (seats[seatIndex]) continue;
        const label = `${mission.mission_date.slice(0, 10)} · ${slot.positionName} · ${slot.timeLabel}`;
        options.push({
          missionId: mission.id,
          missionTitle: mission.title,
          missionDate: mission.mission_date,
          missionType: mission.mission_type,
          slotId: slot.slotId,
          seatIndex,
          positionName: slot.positionName,
          timeLabel: slot.timeLabel,
          label,
        });
      }
    }
  }
  options.sort(
    (a, b) =>
      b.missionDate.localeCompare(a.missionDate) ||
      a.label.localeCompare(b.label, "he"),
  );
  return options;
}
