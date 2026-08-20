import type { MissionDay, MissionPosition, MissionSlot, MissionType } from "@/lib/types";

export type FlatSlot = {
  slotId: string;
  positionId: string;
  positionName: string;
  startTime: string;
  endTime: string;
  timeLabel: string;
  seatCount: number;
  assignees: string[];
  sortKey: number;
};

export type UpcomingMissionItem = {
  id: string;
  missionId: string;
  missionTitle: string;
  missionType: MissionType;
  missionDate: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  sortKey: number;
};

function timeLabel(start: string, end: string) {
  return `${start}–${end}`;
}

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export function flattenMissionSlots(mission: MissionDay): FlatSlot[] {
  const out: FlatSlot[] = [];
  for (const pos of mission.positions || []) {
    for (const slot of pos.slots || []) {
      const assignees = (mission.assignments[slot.id] || []).filter(Boolean);
      const startMin = parseTime(slot.start_time) ?? 0;
      out.push({
        slotId: slot.id,
        positionId: pos.id,
        positionName: pos.name,
        startTime: slot.start_time,
        endTime: slot.end_time,
        timeLabel: timeLabel(slot.start_time, slot.end_time),
        seatCount: slot.seat_count,
        assignees,
        sortKey: startMin,
      });
    }
  }
  out.sort((a, b) => a.sortKey - b.sortKey || a.positionName.localeCompare(b.positionName));
  return out;
}

export function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return {
    id: crypto.randomUUID(),
    start_time: start,
    end_time: end,
    seat_count: seats,
  };
}

export function newPosition(name: string, slots?: MissionSlot[]): MissionPosition {
  return {
    id: crypto.randomUUID(),
    name,
    slots: slots || [newSlot()],
  };
}

export function emptyAssignments(positions: MissionPosition[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const pos of positions) {
    for (const slot of pos.slots) {
      out[slot.id] = Array.from({ length: slot.seat_count }, () => "");
    }
  }
  return out;
}

export function syncAssignmentSeats(
  positions: MissionPosition[],
  assignments: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...assignments };
  for (const pos of positions) {
    for (const slot of pos.slots) {
      const cur = out[slot.id] || [];
      out[slot.id] = Array.from({ length: slot.seat_count }, (_, i) => cur[i] || "");
    }
  }
  return out;
}

const MISSION_TYPE_SHORT: Record<MissionType, string> = {
  guards: "שמירה",
  base_work: "עב״ס",
  kitchen: "מטבח",
};

export function upcomingFromMissions(
  missions: MissionDay[],
  personName: string,
): UpcomingMissionItem[] {
  const now = Date.now();
  const items: UpcomingMissionItem[] = [];

  for (const mission of missions.filter((m) => m.status === "published")) {
    const missionStart = new Date(mission.starts_at).getTime();
    if (missionStart + 48 * 3600_000 < now) continue;

    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      items.push({
        id: `${mission.id}:${slot.slotId}`,
        missionId: mission.id,
        missionTitle: mission.title,
        missionType: mission.mission_type,
        missionDate: mission.mission_date,
        timeLabel: slot.timeLabel,
        title: slot.positionName,
        subtitle: MISSION_TYPE_SHORT[mission.mission_type],
        sortKey:
          new Date(`${mission.mission_date}T${slot.startTime}:00`).getTime() ||
          missionStart,
      });
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items.filter((i) => i.sortKey >= now - 3600_000);
}
