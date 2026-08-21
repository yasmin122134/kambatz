import { fitsPerson } from "@/lib/scheduling-engine";
import type { ScheduleTracker } from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import type { Issue, MissionSchedulingRules, Person } from "@/lib/types";
import type { CarmelGroupCandidate } from "./types";

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [];
  if (size === 1) return items.map((item) => [item]);
  const out: T[][] = [];
  for (let i = 0; i <= items.length - size; i++) {
    for (const tail of combinations(items.slice(i + 1), size - 1)) {
      out.push([items[i], ...tail]);
    }
  }
  return out;
}

function genderKey(p: Person): string {
  return p.gender?.trim() || "unknown";
}

/** Enumerate valid Carmel room/gender trios (or larger need) for a slot. */
export function enumerateCarmelGroups(input: {
  slot: FlatSlot;
  people: Person[];
  need: number;
  fixedNames: string[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  peopleByName: Record<string, Person>;
}): CarmelGroupCandidate[] {
  const { slot, people, need, fixedNames, tracker, issues, scheduling, peopleByName } = input;
  if (need <= 0) return [];

  const fixed = fixedNames.filter(Boolean);
  const fixedPeople = fixed.map((n) => peopleByName[n]).filter(Boolean) as Person[];
  const fixedRoom = fixedPeople.find((p) => p.room)?.room;
  const fixedGender = fixedPeople.length ? genderKey(fixedPeople[0]) : null;

  const eligible = people.filter(
    (p) =>
      !fixed.includes(p.name) &&
      fitsPerson(p, slot, tracker, issues, scheduling, fixed, peopleByName),
  );

  const byRoom = new Map<string, Person[]>();
  for (const p of eligible) {
    if (!p.room) continue;
    if (fixedRoom && p.room !== fixedRoom) continue;
    const list = byRoom.get(p.room) || [];
    list.push(p);
    byRoom.set(p.room, list);
  }

  const candidates: CarmelGroupCandidate[] = [];
  for (const [room, pool] of byRoom) {
    const byGender = new Map<string, Person[]>();
    for (const p of pool) {
      const g = genderKey(p);
      if (fixedGender && g !== fixedGender) continue;
      const list = byGender.get(g) || [];
      list.push(p);
      byGender.set(g, list);
    }

    for (const [gender, genderPool] of byGender) {
      const needFromPool = need - fixed.length;
      if (genderPool.length < needFromPool) continue;
      for (const combo of combinations(genderPool, needFromPool)) {
        candidates.push({
          room,
          gender,
          people: [...fixedPeople, ...combo],
        });
      }
    }
  }

  return candidates;
}

export function summarizeCarmelRooms(groups: CarmelGroupCandidate[]): Array<{ room: string; candidateCount: number }> {
  const counts = new Map<string, number>();
  for (const g of groups) {
    counts.set(g.room, (counts.get(g.room) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([room, candidateCount]) => ({ room, candidateCount }))
    .sort((a, b) => b.candidateCount - a.candidateCount);
}
