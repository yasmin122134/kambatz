import { flattenMissionSlots, isGuardKind } from "@/lib/mission-utils";
import { intervalsOverlap, localMissionMidnightMs, parseIsoMs } from "@/lib/time-interval";
import type { MissionDay, Person } from "@/lib/types";

export type HourlyAvailabilityRow = {
  cyclicStart: number;
  wallLabel: string;
  names: string[];
};

function slotBlocksAvailability(slot: {
  positionKind: import("@/lib/types").MissionPositionKind;
  missionType: import("@/lib/types").MissionType;
}): boolean {
  if (slot.missionType === "guards" && isGuardKind(slot.positionKind)) return true;
  if (slot.missionType === "base_work") return true;
  return false;
}

function hourIntervalMs(
  missionDate: string,
  boardStartMin: number,
  cyclicStart: number,
  durationMin: number,
): { startMs: number; endMs: number } | null {
  const anchor = parseIsoMs(`${missionDate.slice(0, 10)}T12:00:00+03:00`);
  if (anchor === null) return null;
  const midnight = localMissionMidnightMs(anchor);
  const startMin = (boardStartMin + cyclicStart) % 1440;
  const startMs = midnight + startMin * 60_000;
  const endMs = startMs + durationMin * 60_000;
  return { startMs, endMs };
}

function formatWallLabel(boardStartMin: number, cyclicStart: number): string {
  const total = (boardStartMin + cyclicStart) % 1440;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** People not on guard or base work during each hour of the board cycle. */
export function computeHourlyAvailability(input: {
  missions: MissionDay[];
  people: Person[];
  missionDate: string;
  boardStartMin: number;
  stepMinutes?: number;
}): HourlyAvailabilityRow[] {
  const step = input.stepMinutes ?? 60;
  const active = input.people.filter((p) => p.active);
  if (!input.missions.length) return [];

  const blocking = new Map<string, Array<{ startMs: number; endMs: number }>>();
  for (const mission of input.missions) {
    for (const slot of flattenMissionSlots(mission)) {
      if (!slotBlocksAvailability(slot)) continue;
      const seats = mission.assignments[slot.slotId] || [];
      for (const name of seats) {
        if (!name) continue;
        const list = blocking.get(name) || [];
        list.push({ startMs: slot.startAtMs, endMs: slot.endAtMs });
        blocking.set(name, list);
      }
    }
  }

  const rows: HourlyAvailabilityRow[] = [];
  for (let cyclic = 0; cyclic < 1440; cyclic += step) {
    const hourIv = hourIntervalMs(input.missionDate, input.boardStartMin, cyclic, step);
    if (!hourIv) continue;
    const names = active
      .filter((person) => {
        const blocks = blocking.get(person.name) || [];
        return !blocks.some((b) =>
          intervalsOverlap(hourIv, { startMs: b.startMs, endMs: b.endMs }),
        );
      })
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, "he"));
    rows.push({
      cyclicStart: cyclic,
      wallLabel: formatWallLabel(input.boardStartMin, cyclic),
      names,
    });
  }
  return rows;
}
