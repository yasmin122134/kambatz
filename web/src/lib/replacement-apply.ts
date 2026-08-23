import {
  flattenMissionSlots,
  resolveMissionForSlot,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import { saveMissionDay } from "@/lib/missions";
import {
  canAssignPersonToSlot,
  canSwapReplacementAssignments,
} from "@/lib/scheduling-engine";
import type { FairnessRules, Issue, MissionDay, Person } from "@/lib/types";

export type ReplacementApplyOption =
  | { type: "direct"; personName: string }
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
}): Promise<{ missions: MissionDay[] }> {
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

  if (input.option.type === "direct") {
    const nextName = input.option.personName.trim();
    const person = input.peopleByName[nextName];
    if (!person) throw new Error(`${nextName}: לא נמצא במחזור`);

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
