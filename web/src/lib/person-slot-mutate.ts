import { getFairnessRules } from "@/lib/fairness";
import { loadApprovedIssues } from "@/lib/issues";
import {
  getMissionDay,
  listMissionDaysForContext,
  saveMissionDay,
} from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import {
  applyManualSlotAssignment,
  manualSlotAssignmentWarnings,
  sameDayMissionsFor,
} from "@/lib/replacement-apply";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { createClient } from "@/lib/supabase/server";

export async function removePersonFromMissionSlot(input: {
  missionId: string;
  slotId: string;
  seatIndex: number;
  personName: string;
}): Promise<{ warnings: string[] }> {
  const mission = await getMissionDay(input.missionId);
  if (!mission) throw new Error("משימה לא נמצאה");
  if (mission.status !== "published") {
    throw new Error("שיבוץ מפרופיל צוער — רק במשימות מפורסמות. לערוך טיוטה: עמוד ניהול המשימה.");
  }

  const seats = [...(mission.assignments[input.slotId] || [])];
  const current = seats[input.seatIndex]?.trim() || "";
  if (current && current !== input.personName) {
    throw new Error("המשבצת משובצת לצוער אחר");
  }

  seats[input.seatIndex] = "";
  const { mission: saved } = await saveMissionDay(
    {
      ...mission,
      assignments: { ...mission.assignments, [input.slotId]: seats },
    },
    { validateAssignments: false },
  );
  void saved;
  return { warnings: [] };
}

export async function assignPersonToMissionSlot(input: {
  missionId: string;
  slotId: string;
  seatIndex: number;
  personName: string;
}): Promise<{ warnings: string[] }> {
  const supabase = await createClient();
  const [mission, people, issues, rules] = await Promise.all([
    getMissionDay(input.missionId),
    fetchActivePeople(supabase),
    loadApprovedIssues(),
    getFairnessRules(),
  ]);
  if (!mission) throw new Error("משימה לא נמצאה");
  if (mission.status !== "published") {
    throw new Error("שיבוץ מפרופיל צוער — רק במשימות מפורסמות. לערוך טיוטה: עמוד ניהול המשימה.");
  }

  const slot = flattenMissionSlots(mission).find((s) => s.slotId === input.slotId);
  if (!slot) throw new Error("משמרת לא נמצאה");

  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const person = peopleByName[input.personName];
  if (!person) throw new Error(`${input.personName}: לא נמצא במחזור`);

  const seats = [...(mission.assignments[input.slotId] || [])];
  while (seats.length <= input.seatIndex) seats.push("");
  const currentName = seats[input.seatIndex]?.trim() || "";

  const allMissions = await listMissionDaysForContext({
    includeDraftIds: [mission.id],
  });
  const sameDay = sameDayMissionsFor(mission, allMissions);

  const warnings = manualSlotAssignmentWarnings({
    sameDayMissions: sameDay,
    missionId: mission.id,
    slotId: input.slotId,
    seatIndex: input.seatIndex,
    nextName: input.personName,
    removeName: currentName,
    peopleByName,
    issues,
    rules,
  });
  if (warnings.some((w) => w.includes("חפיפה"))) {
    throw new Error(warnings[0]);
  }

  const updated = applyManualSlotAssignment(
    mission,
    input.slotId,
    input.seatIndex,
    input.personName,
    currentName,
  );

  await saveMissionDay({ ...updated, id: mission.id }, { validateAssignments: false });
  return { warnings };
}
