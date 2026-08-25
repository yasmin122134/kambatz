import {
  assignStandbyRoom,
  buildTrackerFromMissions,
  findAssignmentConflicts,
  unplacePerson,
  validateNoPersonOverlaps,
} from "@/lib/scheduling-engine";
import {
  flattenMissionSlots,
  syncAssignmentSeats,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { FairnessRules, Issue, MissionDay, Person } from "@/lib/types";

export type SwapCarmelARoomInput = {
  missions: MissionDay[];
  guardsMission: MissionDay;
  targetRoom: string;
  people: Person[];
  issues: Issue[];
  rules: FairnessRules;
};

export type SwapCarmelARoomResult =
  | {
      ok: true;
      missions: MissionDay[];
      fromRoom: string | null;
      targetRoom: string;
      mapping: Record<string, string>;
    }
  | { ok: false; error: string };

export function findCarmelASlot(mission: MissionDay): FlatSlot | undefined {
  return flattenMissionSlots(mission).find((s) => s.positionKind === "standby_carmel_a");
}

export function findCarmelBSlot(mission: MissionDay): FlatSlot | undefined {
  return flattenMissionSlots(mission).find((s) => s.positionKind === "standby_carmel_b");
}

function cloneMissionAssignments(mission: MissionDay): MissionDay {
  const synced = syncAssignmentSeats(mission.positions, mission.assignments);
  const assignments = Object.fromEntries(
    Object.entries(synced).map(([slotId, seats]) => [slotId, [...seats]]),
  );
  return { ...mission, assignments };
}

function collectAssignedNames(missions: MissionDay[]): Set<string> {
  const names = new Set<string>();
  for (const mission of missions) {
    for (const seats of Object.values(mission.assignments || {})) {
      for (const name of seats) {
        if (name?.trim()) names.add(name.trim());
      }
    }
  }
  return names;
}

export function inferRoomFromAssignees(
  names: string[],
  peopleByName: Record<string, Person>,
): string | null {
  return roomFromNames(names, peopleByName);
}

function roomFromNames(
  names: string[],
  peopleByName: Record<string, Person>,
): string | null {
  const rooms = new Set(
    names.map((n) => peopleByName[n]?.room?.trim()).filter(Boolean) as string[],
  );
  if (rooms.size === 1) return [...rooms][0];
  if (rooms.size > 1) {
    const counts = new Map<string, number>();
    for (const n of names) {
      const room = peopleByName[n]?.room?.trim();
      if (!room) continue;
      counts.set(room, (counts.get(room) || 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [room, count] of counts) {
      if (count > bestCount) {
        best = room;
        bestCount = count;
      }
    }
    return best;
  }
  return null;
}

function namesAssignedInRoom(
  room: string,
  assigned: Set<string>,
  peopleByName: Record<string, Person>,
): string[] {
  return [...assigned]
    .filter((n) => peopleByName[n]?.room?.trim() === room)
    .sort((a, b) => a.localeCompare(b, "he"));
}

function activePeopleInRoom(
  room: string,
  people: Person[],
  exclude: Set<string>,
): string[] {
  return people
    .filter((p) => p.active && p.room?.trim() === room && !exclude.has(p.name))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, "he"));
}

export function applyNameMappingToMissions(
  missions: MissionDay[],
  mapping: Record<string, string>,
): MissionDay[] {
  if (!Object.keys(mapping).length) return missions;
  return missions.map((mission) => {
    const next = cloneMissionAssignments(mission);
    for (const [slotId, seats] of Object.entries(next.assignments)) {
      next.assignments[slotId] = seats.map((name) => {
        const trimmed = name?.trim();
        if (!trimmed) return name;
        return mapping[trimmed] ?? name;
      });
    }
    return next;
  });
}

/** בונה מיפוי 1:1 בין חדר ישן לחדר חדש — קודם כרמל א׳, אחר כך שאר השיבוצים. */
export function buildRoomSwapMapping(input: {
  fromRoom: string;
  targetRoom: string;
  oldCarmelNames: string[];
  newCarmelNames: string[];
  assignedNames: Set<string>;
  people: Person[];
  carmelBNames: Set<string>;
}): Record<string, string> | { error: string } {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const mapping: Record<string, string> = {};

  const oldCarmel = input.oldCarmelNames.filter(Boolean);
  const newCarmel = input.newCarmelNames.filter(Boolean);
  if (newCarmel.length < oldCarmel.length) {
    return { error: `בחדר ${input.targetRoom} אין מספיק צוערים לכרמל א׳ (${newCarmel.length}/${oldCarmel.length})` };
  }
  for (let i = 0; i < oldCarmel.length; i++) {
    mapping[oldCarmel[i]] = newCarmel[i];
  }

  const usedNew = new Set(Object.values(mapping));
  const otherOld = namesAssignedInRoom(
    input.fromRoom,
    input.assignedNames,
    peopleByName,
  ).filter((n) => !mapping[n]);
  const otherNew = activePeopleInRoom(input.targetRoom, input.people, input.carmelBNames).filter(
    (n) => !usedNew.has(n),
  );

  if (otherOld.length > otherNew.length) {
    return {
      error: `בחדר ${input.targetRoom} אין מספיק צוערים להחלפת כל השיבוצים (${otherNew.length}/${otherOld.length} נוספים)`,
    };
  }
  for (let i = 0; i < otherOld.length; i++) {
    mapping[otherOld[i]] = otherNew[i];
  }

  return mapping;
}

export function swapCarmelARoom(input: SwapCarmelARoomInput): SwapCarmelARoomResult {
  const targetRoom = input.targetRoom.trim();
  if (!targetRoom) {
    return { ok: false, error: "חסר מספר חדר" };
  }

  const carmelSlot = findCarmelASlot(input.guardsMission);
  if (!carmelSlot) {
    return { ok: false, error: "לא נמצאה עמדת כרמל א׳ ביום השמירות" };
  }

  const carmelBSlot = findCarmelBSlot(input.guardsMission);
  const carmelBNames = new Set(
    (input.guardsMission.assignments[carmelBSlot?.slotId || ""] || []).filter(Boolean),
  );

  let missions = input.missions.map(cloneMissionAssignments);
  const guardsIdx = missions.findIndex((m) => m.id === input.guardsMission.id);
  if (guardsIdx < 0) {
    return { ok: false, error: "יום השמירות לא נמצא ברשימת המשימות" };
  }
  const guardsMission = missions[guardsIdx];

  const oldCarmelNames = [
    ...(guardsMission.assignments[carmelSlot.slotId] || []),
  ].map((n) => n?.trim() || "");
  const fromRoom = roomFromNames(
    oldCarmelNames.filter(Boolean),
    Object.fromEntries(input.people.map((p) => [p.name, p])),
  );

  if (fromRoom === targetRoom) {
    return { ok: false, error: "כרמל א׳ כבר משובץ מחדר זה" };
  }

  const scheduling = guardsMission.scheduling_rules;
  const meanPrior =
    input.people.reduce((s, p) => s + (p.prior_score || 0), 0) /
    Math.max(1, input.people.length);

  const tracker = buildTrackerFromMissions(missions, input.rules);
  for (const name of oldCarmelNames) {
    if (!name) continue;
    unplacePerson(name, carmelSlot, guardsMission.id, tracker, input.rules, scheduling);
  }

  const newCarmelNames = assignStandbyRoom(
    input.people,
    carmelSlot,
    carmelSlot.seatCount,
    [],
    tracker,
    input.issues,
    scheduling,
    input.rules,
    meanPrior,
    guardsMission.id,
    guardsMission.mission_type,
    { onlyRoom: targetRoom },
  );

  if (newCarmelNames.length < carmelSlot.seatCount) {
    return {
      ok: false,
      error: `לא ניתן לשבץ ${carmelSlot.seatCount} צוערים מחדר ${targetRoom} בכרמל א׳ (כללים / חפיפות / כרמל ב׳)`,
    };
  }

  const assignedNames = collectAssignedNames(missions);
  let mapping: Record<string, string> = {};

  if (fromRoom) {
    const built = buildRoomSwapMapping({
      fromRoom,
      targetRoom,
      oldCarmelNames: oldCarmelNames.filter(Boolean),
      newCarmelNames,
      assignedNames,
      people: input.people,
      carmelBNames,
    });
    if ("error" in built) {
      return { ok: false, error: built.error };
    }
    mapping = built;
    missions = applyNameMappingToMissions(missions, mapping);
  } else {
    const seats = [...(missions[guardsIdx].assignments[carmelSlot.slotId] || [])];
    while (seats.length < carmelSlot.seatCount) seats.push("");
    for (let i = 0; i < newCarmelNames.length; i++) {
      seats[i] = newCarmelNames[i];
    }
    missions[guardsIdx] = {
      ...missions[guardsIdx],
      assignments: {
        ...missions[guardsIdx].assignments,
        [carmelSlot.slotId]: seats,
      },
    };
  }

  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const overlapErrors = validateNoPersonOverlaps(missions);
  if (overlapErrors.length) {
    return { ok: false, error: overlapErrors[0] };
  }
  for (const mission of missions) {
    const conflicts = findAssignmentConflicts(mission, peopleByName, input.issues);
    if (conflicts.length) {
      return { ok: false, error: conflicts[0] };
    }
  }

  return {
    ok: true,
    missions,
    fromRoom,
    targetRoom,
    mapping,
  };
}
