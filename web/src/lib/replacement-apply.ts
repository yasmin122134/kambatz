import {
  flattenMissionSlots,
  resolveMissionForSlot,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import { withBaseWorkSlotLeader, getBaseWorkSlotLeader } from "@/lib/base-work-template";
import { saveMissionDay } from "@/lib/missions";
import {
  canAssignPersonToSlot,
  canSwapReplacementAssignments,
} from "@/lib/scheduling-engine";
import type { FairnessRules, Issue, MissionDay, Person } from "@/lib/types";

export type ReplacementApplyOption =
  | { type: "direct"; personName: string; force?: boolean }
  | { type: "manual"; personName: string }
  | {
      type: "swap";
      swapMissionId: string;
      swapSlotId: string;
      swapSeatIndex: number;
    };

export { resolveMissionForSlot } from "@/lib/mission-utils";

function slotById(mission: MissionDay, slotId: string) {
  return flattenMissionSlots(mission).find((s) => s.slotId === slotId);
}

function seatArray(mission: MissionDay, slotId: string): string[] {
  return [...(syncAssignmentSeats(mission.positions, mission.assignments)[slotId] || [])];
}

function cloneMissionAssignments(mission: MissionDay): MissionDay {
  const synced = syncAssignmentSeats(mission.positions, mission.assignments);
  const assignments = Object.fromEntries(
    Object.entries(synced).map(([slotId, seats]) => [slotId, [...seats]]),
  );
  return { ...mission, assignments };
}

export function isForcedReplacementOption(option: ReplacementApplyOption): boolean {
  return option.type === "manual" || (option.type === "direct" && option.force === true);
}

/** שיבוץ ידני — רק המשבצת הנוכחית; משמרות אחרות של אותו אדם נשארות. */
export function applyManualSlotAssignment(
  mission: MissionDay,
  slotId: string,
  seatIndex: number,
  nextName: string,
  removeName: string,
): MissionDay {
  const next = cloneMissionAssignments(mission);
  const seats = [...(next.assignments[slotId] || [])];
  while (seats.length <= seatIndex) seats.push("");
  seats[seatIndex] = nextName;
  next.assignments[slotId] = seats;

  if (getBaseWorkSlotLeader(mission, slotId) === removeName) {
    return withBaseWorkSlotLeader(next, slotId, nextName);
  }
  return next;
}

export function manualSlotAssignmentWarnings(input: {
  sameDayMissions: MissionDay[];
  missionId: string;
  slotId: string;
  seatIndex: number;
  nextName: string;
  removeName: string;
  peopleByName: Record<string, Person>;
  issues: Issue[];
  rules: FairnessRules;
}): string[] {
  const mission =
    resolveMissionForSlot(input.sameDayMissions, input.missionId, input.slotId) ??
    input.sameDayMissions.find((m) => m.id === input.missionId);
  const slot = mission ? slotById(mission, input.slotId) : undefined;
  const person = input.peopleByName[input.nextName];
  if (!mission || !slot || !person) return [];

  const check = canAssignPersonToSlot({
    missions: input.sameDayMissions,
    rules: input.rules,
    missionId: mission.id,
    slot,
    seatIndex: input.seatIndex,
    person,
    issues: input.issues,
    peopleByName: input.peopleByName,
    replaceName: input.removeName,
  });
  return check.ok ? [] : [check.reason];
}

export async function applyReplacementAssignment(input: {
  sourceMission: MissionDay;
  sameDayMissions: MissionDay[];
  slotId: string;
  seatIndex: number;
  removeName: string;
  option: ReplacementApplyOption;
  peopleByName: Record<string, Person>;
  issues: Issue[];
  rules: FairnessRules;
}): Promise<{ missions: MissionDay[]; warnings?: string[] }> {
  const seatIndex = Number(input.seatIndex);
  if (!Number.isFinite(seatIndex) || seatIndex < 0) {
    throw new Error("מספר מושב לא תקין");
  }

  const sourceMission =
    resolveMissionForSlot(
      input.sameDayMissions,
      input.sourceMission.id,
      input.slotId,
    ) ??
    input.sameDayMissions.find((m) => m.id === input.sourceMission.id) ??
    input.sourceMission;
  const srcSlot = slotById(sourceMission, input.slotId);
  if (!srcSlot) throw new Error("משמרת לא נמצאה");

  const currentName =
    seatArray(sourceMission, input.slotId)[seatIndex]?.trim() || "";
  if (currentName !== input.removeName.trim()) {
    throw new Error("השיבוץ השתנה — רעננו ונסו שוב");
  }

  if (input.option.type === "direct" || input.option.type === "manual") {
    const nextName = input.option.personName.trim();
    const person = input.peopleByName[nextName];
    if (!person) throw new Error(`${nextName}: לא נמצא במחזור`);

    if (isForcedReplacementOption(input.option)) {
      const warnings = manualSlotAssignmentWarnings({
        sameDayMissions: input.sameDayMissions,
        missionId: sourceMission.id,
        slotId: input.slotId,
        seatIndex,
        nextName,
        removeName: input.removeName,
        peopleByName: input.peopleByName,
        issues: input.issues,
        rules: input.rules,
      });
      const updated = applyManualSlotAssignment(
        sourceMission,
        input.slotId,
        seatIndex,
        nextName,
        input.removeName,
      );
      const { mission: saved } = await saveMissionDay(
        { ...updated, id: sourceMission.id },
        { validateAssignments: false },
      );
      return warnings.length ? { missions: [saved], warnings } : { missions: [saved] };
    }

    const check = canAssignPersonToSlot({
      missions: input.sameDayMissions,
      rules: input.rules,
      missionId: sourceMission.id,
      slot: srcSlot,
      seatIndex,
      person,
      issues: input.issues,
      peopleByName: input.peopleByName,
      replaceName: input.removeName,
    });
    if (!check.ok) throw new Error(check.reason);

    const seats = seatArray(sourceMission, input.slotId);
    seats[seatIndex] = nextName;
    let updated = {
      ...sourceMission,
      assignments: { ...sourceMission.assignments, [input.slotId]: seats },
    };
    if (getBaseWorkSlotLeader(sourceMission, input.slotId) === input.removeName) {
      updated = withBaseWorkSlotLeader(updated, input.slotId, nextName);
    }
    const { mission: saved } = await saveMissionDay(
      { ...updated, id: sourceMission.id },
      { validateAssignments: false },
    );
    return { missions: [saved] };
  }

  const targetMissionId = input.option.swapMissionId;
  const targetMission =
    resolveMissionForSlot(
      input.sameDayMissions,
      targetMissionId,
      input.option.swapSlotId,
    ) ??
    (targetMissionId === sourceMission.id
      ? sourceMission
      : input.sameDayMissions.find((m) => m.id === targetMissionId));
  if (!targetMission) throw new Error("משימת יעד לא נמצאה");

  const dstSlot = slotById(targetMission, input.option.swapSlotId);
  if (!dstSlot) throw new Error("משמרת יעד לא נמצאה");

  const swapSeatIndex = Number(input.option.swapSeatIndex);
  const srcSeats = seatArray(sourceMission, input.slotId);
  const dstSeats = seatArray(targetMission, input.option.swapSlotId);
  const srcName = srcSeats[seatIndex];
  const dstName = dstSeats[swapSeatIndex];
  if (!srcName || !dstName) throw new Error("אין עם מי להחליף");

  const swapPerson = input.peopleByName[dstName];
  if (!swapPerson) throw new Error(`${dstName}: לא נמצא במחזור`);

  const swapCheck = canSwapReplacementAssignments({
    missions: input.sameDayMissions,
    rules: input.rules,
    missionId: sourceMission.id,
    slot: srcSlot,
    seatIndex,
    removeName: srcName,
    swapMissionId: targetMission.id,
    swapSlot: dstSlot,
    swapSeatIndex,
    swapPerson,
    issues: input.issues,
    peopleByName: input.peopleByName,
  });
  if (!swapCheck.ok) throw new Error(swapCheck.reason);

  if (sourceMission.id === targetMission.id && input.slotId === input.option.swapSlotId) {
    const seats = seatArray(sourceMission, input.slotId);
    seats[seatIndex] = dstName;
    seats[swapSeatIndex] = srcName;
    const updated = {
      ...sourceMission,
      assignments: { ...sourceMission.assignments, [input.slotId]: seats },
    };
    const { mission: saved } = await saveMissionDay(
      { ...updated, id: sourceMission.id },
      { validateAssignments: false },
    );
    return { missions: [saved] };
  }

  srcSeats[seatIndex] = dstName;
  dstSeats[swapSeatIndex] = srcName;

  const updatedSrc = {
    ...sourceMission,
    assignments: { ...sourceMission.assignments, [input.slotId]: srcSeats },
  };
  const updatedDst = {
    ...targetMission,
    assignments: {
      ...targetMission.assignments,
      [input.option.swapSlotId]: dstSeats,
    },
  };

  if (sourceMission.id === targetMission.id) {
    const merged = {
      ...sourceMission,
      assignments: {
        ...sourceMission.assignments,
        [input.slotId]: srcSeats,
        [input.option.swapSlotId]: dstSeats,
      },
    };
    const { mission: saved } = await saveMissionDay(
      { ...merged, id: sourceMission.id },
      { validateAssignments: false },
    );
    return { missions: [saved] };
  }

  const [{ mission: savedSrc }, { mission: savedDst }] = await Promise.all([
    saveMissionDay({ ...updatedSrc, id: sourceMission.id }, { validateAssignments: false }),
    saveMissionDay({ ...updatedDst, id: targetMission.id }, { validateAssignments: false }),
  ]);
  return { missions: [savedSrc, savedDst] };
}

export function sameDayMissionsFor(
  mission: MissionDay,
  allMissions: MissionDay[],
): MissionDay[] {
  const date = mission.mission_date.slice(0, 10);
  return allMissions.filter((m) => m.mission_date.slice(0, 10) === date);
}

export function normalizeReplacementApplyOption(
  raw: unknown,
  bodyForce?: boolean,
): ReplacementApplyOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type === "manual") {
    const personName = String(o.personName || "").trim();
    return personName ? { type: "manual", personName } : null;
  }
  if (type === "direct") {
    const personName = String(o.personName || "").trim();
    if (!personName) return null;
    if (o.force === true || bodyForce === true) {
      return { type: "manual", personName };
    }
    return { type: "direct", personName };
  }
  if (type === "swap") {
    return {
      type: "swap",
      swapMissionId: String(o.swapMissionId || ""),
      swapSlotId: String(o.swapSlotId || ""),
      swapSeatIndex: Number(o.swapSeatIndex),
    };
  }
  return null;
}
