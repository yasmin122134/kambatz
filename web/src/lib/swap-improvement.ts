import { flattenMissionSlots, syncAssignmentSeats, type FlatSlot } from "@/lib/mission-utils";
import {
  computeScheduleQuality,
  lexBetter,
  scheduleLexScore,
  type ScheduleLexScore,
} from "@/lib/schedule-quality";
import {
  buildTrackerFromMissions,
  canSwapReplacementAssignments,
} from "@/lib/scheduling-engine";
import type { FairnessRules, Issue, MissionDay, Person } from "@/lib/types";

type AssignedSeat = {
  missionId: string;
  slotId: string;
  seatIndex: number;
  personName: string;
  slot: FlatSlot;
};

export type SwapImprovementResult = {
  missions: MissionDay[];
  swapsApplied: number;
  messages: string[];
};

function cloneScopeMissions(missions: MissionDay[]): MissionDay[] {
  return missions.map((mission) => ({
    ...mission,
    assignments: Object.fromEntries(
      Object.entries(syncAssignmentSeats(mission.positions, { ...mission.assignments })).map(
        ([slotId, seats]) => [slotId, [...seats]],
      ),
    ),
  }));
}

function countScopeSeats(missions: MissionDay[]): { filled: number; required: number } {
  let filled = 0;
  let required = 0;
  for (const mission of missions) {
    for (const pos of mission.positions) {
      for (const slot of pos.slots) {
        required += slot.seat_count;
      }
    }
    const synced = syncAssignmentSeats(mission.positions, mission.assignments);
    for (const seats of Object.values(synced)) {
      filled += seats.filter(Boolean).length;
    }
  }
  return { filled, required };
}

function listAssignedSeats(missions: MissionDay[]): AssignedSeat[] {
  const seats: AssignedSeat[] = [];
  for (const mission of missions) {
    for (const slot of flattenMissionSlots(mission)) {
      const arr = mission.assignments[slot.slotId] || [];
      for (let seatIndex = 0; seatIndex < arr.length; seatIndex++) {
        const personName = arr[seatIndex];
        if (!personName) continue;
        seats.push({
          missionId: mission.id,
          slotId: slot.slotId,
          seatIndex,
          personName,
          slot,
        });
      }
    }
  }
  return seats;
}

function scoreScope(
  scopeMissions: MissionDay[],
  crossDayMissions: MissionDay[],
  people: Person[],
  rules: FairnessRules,
  meanPrior: number,
): ScheduleLexScore {
  const tracker = buildTrackerFromMissions([...crossDayMissions, ...scopeMissions], rules);
  const { filled, required } = countScopeSeats(scopeMissions);
  return scheduleLexScore(
    computeScheduleQuality({
      tracker,
      people,
      rules,
      meanPrior,
      filledSeats: filled,
      requiredSeats: required,
    }),
  );
}

function applySwap(
  missions: MissionDay[],
  a: Pick<AssignedSeat, "missionId" | "slotId" | "seatIndex">,
  b: Pick<AssignedSeat, "missionId" | "slotId" | "seatIndex">,
): MissionDay[] {
  if (a.missionId === b.missionId) {
    const mission = missions.find((m) => m.id === a.missionId);
    if (!mission) return missions;
    const assignments = Object.fromEntries(
      Object.entries(mission.assignments).map(([slotId, seats]) => [slotId, [...seats]]),
    );
    const nameA = assignments[a.slotId][a.seatIndex];
    const nameB = assignments[b.slotId][b.seatIndex];
    assignments[a.slotId][a.seatIndex] = nameB;
    assignments[b.slotId][b.seatIndex] = nameA;
    return missions.map((m) =>
      m.id === a.missionId ? { ...m, assignments } : m,
    );
  }

  const byId = new Map(missions.map((m) => [m.id, m]));
  const missionA = byId.get(a.missionId)!;
  const missionB = byId.get(b.missionId)!;
  const nameA = missionA.assignments[a.slotId][a.seatIndex];
  const nameB = missionB.assignments[b.slotId][b.seatIndex];

  const nextA = { ...missionA.assignments, [a.slotId]: [...missionA.assignments[a.slotId]] };
  const nextB = { ...missionB.assignments, [b.slotId]: [...missionB.assignments[b.slotId]] };
  nextA[a.slotId][a.seatIndex] = nameB;
  nextB[b.slotId][b.seatIndex] = nameA;

  return missions.map((m) => {
    if (m.id === a.missionId) return { ...m, assignments: nextA };
    if (m.id === b.missionId) return { ...m, assignments: nextB };
    return m;
  });
}

/**
 * Post-processing pass: try pairwise swaps (including cross-mission) that
 * improve lexicographic schedule quality while preserving hard constraints.
 */
export function improveScheduleBySwaps(input: {
  missions: MissionDay[];
  people: Person[];
  issues: Issue[];
  rules: FairnessRules;
  meanPrior: number;
  crossDayMissions?: MissionDay[];
  maxIterations?: number;
  maxSwaps?: number;
}): SwapImprovementResult {
  const crossDay = input.crossDayMissions ?? [];
  const maxIterations = input.maxIterations ?? 24;
  const maxSwaps = input.maxSwaps ?? 48;
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));

  let missions = cloneScopeMissions(input.missions);
  let swapsApplied = 0;
  const messages: string[] = [];

  for (let round = 0; round < maxIterations && swapsApplied < maxSwaps; round++) {
    const currentScore = scoreScope(missions, crossDay, input.people, input.rules, input.meanPrior);
    const assigned = listAssignedSeats(missions);

    let best:
      | {
          a: AssignedSeat;
          b: AssignedSeat;
          score: ScheduleLexScore;
        }
      | null = null;

    for (let i = 0; i < assigned.length; i++) {
      for (let j = i + 1; j < assigned.length; j++) {
        const a = assigned[i];
        const b = assigned[j];
        if (a.personName === b.personName) continue;

        const swapPerson = peopleByName[b.personName];
        if (!swapPerson) continue;

        const check = canSwapReplacementAssignments({
          missions,
          rules: input.rules,
          missionId: a.missionId,
          slot: a.slot,
          seatIndex: a.seatIndex,
          removeName: a.personName,
          swapMissionId: b.missionId,
          swapSlot: b.slot,
          swapSeatIndex: b.seatIndex,
          swapPerson,
          issues: input.issues,
          peopleByName,
        });
        if (!check.ok) continue;

        const trial = applySwap(missions, a, b);
        const trialScore = scoreScope(
          trial,
          crossDay,
          input.people,
          input.rules,
          input.meanPrior,
        );
        if (!lexBetter(trialScore, currentScore)) continue;
        if (!best || lexBetter(trialScore, best.score)) {
          best = { a, b, score: trialScore };
        }
      }
    }

    if (!best) break;

    missions = applySwap(missions, best.a, best.b);
    swapsApplied += 1;
    messages.push(
      `${best.a.personName} (${best.a.slot.positionName} ${best.a.slot.timeLabel}) ↔ ${best.b.personName} (${best.b.slot.positionName} ${best.b.slot.timeLabel})`,
    );
  }

  return { missions, swapsApplied, messages };
}
