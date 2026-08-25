import { flattenMissionSlots, syncAssignmentSeats, type FlatSlot } from "@/lib/mission-utils";
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
      pairs: Array<[string, string]>;
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

/** בוחר צוערים מחדר לכרמל א׳ — אותו מגדר, לא על כרמל ב׳. */
export function pickCarmelTrioFromRoom(
  room: string,
  people: Person[],
  exclude: Set<string>,
  need: number,
): string[] {
  const pool = people
    .filter((p) => p.active && p.room?.trim() === room && !exclude.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  if (!pool.length || need <= 0) return [];

  const anchorGender = pool[0].gender?.trim() || "";
  const sameGender = anchorGender
    ? pool.filter((p) => (p.gender?.trim() || "") === anchorGender)
    : pool;
  return sameGender.slice(0, need).map((p) => p.name);
}

/** מחליף שמות בכל המשימות לפי מיפוי חד-כיווני (legacy). */
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

/** החלפת שמות דו-כיוונית — כל שיבוץ של א׳ עובר ל-ב׳ ולהפך (ראש בראש). */
export function applyPersonSwapsToMissions(
  missions: MissionDay[],
  pairs: Array<[string, string]>,
): MissionDay[] {
  if (!pairs.length) return missions;
  const swap = new Map<string, string>();
  for (const [a, b] of pairs) {
    if (!a || !b || a === b) continue;
    swap.set(a, b);
    swap.set(b, a);
  }
  if (!swap.size) return missions;

  return missions.map((mission) => {
    const next = cloneMissionAssignments(mission);
    for (const [slotId, seats] of Object.entries(next.assignments)) {
      next.assignments[slotId] = seats.map((name) => {
        const trimmed = name?.trim();
        if (!trimmed) return name;
        return swap.get(trimmed) ?? name;
      });
    }
    return next;
  });
}

/** זוגות 1:1 לחילוף — קודם כרמל א׳, אחר כך שאר השיבוצים ביום. */
export function buildRoomBidirectionalPairs(input: {
  fromRoom: string;
  targetRoom: string;
  oldCarmelNames: string[];
  newCarmelNames: string[];
  assignedNames: Set<string>;
  people: Person[];
  carmelBNames: Set<string>;
}): Array<[string, string]> {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const pairs: Array<[string, string]> = [];
  const paired = new Set<string>();

  const link = (a: string, b: string) => {
    if (!a || !b || a === b || paired.has(a) || paired.has(b)) return;
    pairs.push([a, b]);
    paired.add(a);
    paired.add(b);
  };

  const oldCarmel = input.oldCarmelNames.filter(Boolean);
  const newCarmel = input.newCarmelNames.filter(Boolean);
  for (let i = 0; i < Math.min(oldCarmel.length, newCarmel.length); i++) {
    link(oldCarmel[i], newCarmel[i]);
  }

  const otherOld = namesAssignedInRoom(
    input.fromRoom,
    input.assignedNames,
    peopleByName,
  ).filter((n) => !paired.has(n));
  const otherNew = activePeopleInRoom(input.targetRoom, input.people, input.carmelBNames).filter(
    (n) => !paired.has(n),
  );
  for (let i = 0; i < Math.min(otherOld.length, otherNew.length); i++) {
    link(otherOld[i], otherNew[i]);
  }

  return pairs;
}

export function swapCarmelARoom(input: SwapCarmelARoomInput): SwapCarmelARoomResult {
  const targetRoom = input.targetRoom.trim();
  if (!targetRoom) {
    return { ok: false, error: "חסר מספר חדר" };
  }

  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const carmelSlot = findCarmelASlot(input.guardsMission);
  if (!carmelSlot) {
    return { ok: false, error: "לא נמצאה עמדת כרמל א׳ ביום השמירות" };
  }

  const carmelBSlot = findCarmelBSlot(input.guardsMission);
  const carmelBNames = new Set(
    (input.guardsMission.assignments[carmelBSlot?.slotId || ""] || []).filter(Boolean),
  );

  const targetRoomPeople = activePeopleInRoom(targetRoom, input.people, carmelBNames);
  if (!targetRoomPeople.length) {
    return { ok: false, error: `אין צוערים פעילים בחדר ${targetRoom}` };
  }

  let missions = input.missions.map(cloneMissionAssignments);
  const guardsIdx = missions.findIndex((m) => m.id === input.guardsMission.id);
  if (guardsIdx < 0) {
    return { ok: false, error: "יום השמירות לא נמצא ברשימת המשימות" };
  }
  const guardsMission = missions[guardsIdx];

  const oldCarmelNames = (guardsMission.assignments[carmelSlot.slotId] || []).map(
    (n) => n?.trim() || "",
  );
  const fromRoom = roomFromNames(oldCarmelNames.filter(Boolean), peopleByName);

  if (fromRoom === targetRoom) {
    return { ok: false, error: "כרמל א׳ כבר משובץ מחדר זה" };
  }

  const newCarmelNames = pickCarmelTrioFromRoom(
    targetRoom,
    input.people,
    carmelBNames,
    carmelSlot.seatCount,
  );

  if (!fromRoom) {
    if (newCarmelNames.length < carmelSlot.seatCount) {
      return {
        ok: false,
        error: `בחדר ${targetRoom} אין ${carmelSlot.seatCount} צוערים מאותו מגדר לכרמל א׳`,
      };
    }
    const seats = Array.from({ length: carmelSlot.seatCount }, (_, i) => newCarmelNames[i] || "");
    missions[guardsIdx] = {
      ...missions[guardsIdx],
      assignments: {
        ...missions[guardsIdx].assignments,
        [carmelSlot.slotId]: seats,
      },
    };
    return {
      ok: true,
      missions,
      fromRoom: null,
      targetRoom,
      pairs: [],
    };
  }

  const assignedNames = collectAssignedNames(missions);
  const pairs = buildRoomBidirectionalPairs({
    fromRoom,
    targetRoom,
    oldCarmelNames: oldCarmelNames.filter(Boolean),
    newCarmelNames,
    assignedNames,
    people: input.people,
    carmelBNames,
  });

  if (!pairs.length) {
    return {
      ok: false,
      error: `לא נמצאו זוגות להחלפה בין חדר ${fromRoom} ל-${targetRoom}`,
    };
  }

  missions = applyPersonSwapsToMissions(missions, pairs);

  return {
    ok: true,
    missions,
    fromRoom,
    targetRoom,
    pairs,
  };
}
