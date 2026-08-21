import { createClient } from "@/lib/supabase/server";
import { getFairnessRules } from "@/lib/fairness";
import { runGlobalAssign, type SmartAssignStatus, type UnresolvedRequirement } from "@/lib/global-assign";
import {
  findAssignmentConflicts,
  validateGeneratedRoster,
  validateNoPersonOverlaps,
} from "@/lib/scheduling-engine";
import { syncAssignmentSeats } from "@/lib/mission-utils";
import {
  applyAssignmentsOnly,
  assertMissionStructureUnchanged,
  cloneMissionPositions,
  snapshotMissionStructure,
  validateMissionStructureForAssignment,
} from "@/lib/mission-slot-structure";
import { getMissionDay, listMissionDays, saveMissionDay } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import type { Issue, MissionDay, Person } from "@/lib/types";

export type AutoAssignResult = {
  mission: MissionDay;
  filled: number;
  skipped: number;
  warnings: string[];
  status?: SmartAssignStatus;
  assignedSeats?: number;
  requiredSeats?: number;
  unresolved?: UnresolvedRequirement[];
};

export type SmartAssignDayResult = {
  status: SmartAssignStatus;
  assignedSeats: number;
  requiredSeats: number;
  results: AutoAssignResult[];
  warnings: string[];
  unresolved: UnresolvedRequirement[];
  objectiveSummary?: {
    filledSeats: number;
    requiredSeats: number;
    carmelFilled: number;
    carmelRequired: number;
    fairnessSpread: number;
    searchNodes: number;
    attempts: number;
  };
};

async function loadPeople(): Promise<Person[]> {
  const supabase = await createClient();
  return fetchActivePeople(supabase);
}

async function loadApprovedIssues(): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("status", "approved");

  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data || []) as Issue[];
}

function sameDayMissionScope(mission: MissionDay, allMissions: MissionDay[]): MissionDay[] {
  const date = mission.mission_date.slice(0, 10);
  return allMissions.filter((m) => m.mission_date.slice(0, 10) === date);
}

function countSkippedSeats(mission: MissionDay, keepExisting: boolean): number {
  if (!keepExisting) return 0;
  let skipped = 0;
  const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
  for (const seats of Object.values(assignments)) {
    skipped += seats.filter(Boolean).length;
  }
  return skipped;
}

function countMissionRequiredSeats(mission: MissionDay): number {
  let total = 0;
  for (const pos of mission.positions) {
    for (const slot of pos.slots) {
      total += slot.seat_count;
    }
  }
  return total;
}

function countMissionFilledSeats(assignments: Record<string, string[]>): number {
  let filled = 0;
  for (const seats of Object.values(assignments)) {
    filled += seats.filter(Boolean).length;
  }
  return filled;
}

async function smartAssignScope(input: {
  scopeMissions: MissionDay[];
  allMissions: MissionDay[];
  people: Person[];
  issues: Issue[];
  rules: Awaited<ReturnType<typeof getFairnessRules>>;
  keepExisting: boolean;
  preWarnings?: string[];
}): Promise<SmartAssignDayResult> {
  const meanPrior =
    input.people.reduce((sum, p) => sum + (p.prior_score || 0), 0) /
    (input.people.length || 1);
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));

  const structureBefore = input.scopeMissions.map((m) => snapshotMissionStructure(m));
  for (const mission of input.scopeMissions) {
    const structureErrors = validateMissionStructureForAssignment(mission);
    if (structureErrors.length) {
      throw new Error(
        `מבנה המשימה אינו תקין — תקנו או סנכרנו משמרות לפני שיבוץ:\n${structureErrors.join("\n")}`,
      );
    }
  }

  const output = runGlobalAssign({
    missions: input.scopeMissions,
    people: input.people,
    issues: input.issues,
    rules: input.rules,
    meanPrior,
    keepExisting: input.keepExisting,
    crossDayMissions: input.allMissions.filter(
      (m) => !input.scopeMissions.some((s) => s.id === m.id),
    ),
  });

  const draftMissions = input.scopeMissions.map((mission) => ({
    ...mission,
    assignments: output.assignmentsByMission.get(mission.id) ?? mission.assignments,
  }));

  const validationErrors = [
    ...validateGeneratedRoster({
      missions: draftMissions,
      issues: input.issues,
      peopleByName,
    }),
    ...validateNoPersonOverlaps(draftMissions).map((msg) => `⚠ ${msg}`),
  ];

  let status = output.status;
  if (validationErrors.length) {
    status = output.filled >= output.requiredSeats ? "partial" : status;
  } else if (output.filled >= output.requiredSeats) {
    status = "complete";
  }

  const warnings = [...(input.preWarnings ?? []), ...output.warnings, ...validationErrors];

  const results: AutoAssignResult[] = [];
  for (let mi = 0; mi < input.scopeMissions.length; mi++) {
    const mission = input.scopeMissions[mi];
    const assignments = output.assignmentsByMission.get(mission.id) ?? mission.assignments;
    const structureAfter = snapshotMissionStructure({
      ...mission,
      assignments,
      positions: cloneMissionPositions(mission.positions),
    });
    assertMissionStructureUnchanged(structureBefore[mi], structureAfter);

    const draft: MissionDay = applyAssignmentsOnly(mission, assignments);
    const missionWarnings = [...warnings];
    for (const msg of findAssignmentConflicts(draft, peopleByName)) {
      if (!missionWarnings.includes(msg)) missionWarnings.push(msg);
    }

    const saved = await saveMissionDay(
      applyAssignmentsOnly(mission, assignments),
      { validateAssignments: status === "complete" },
    );

    const requiredSeats = countMissionRequiredSeats(mission);
    const assignedSeats = countMissionFilledSeats(assignments);
    const missionUnresolved = output.unresolved.filter((u) => u.missionId === mission.id);

    results.push({
      mission: saved,
      filled: Math.max(0, assignedSeats - countSkippedSeats(mission, input.keepExisting)),
      skipped: countSkippedSeats(mission, input.keepExisting),
      warnings: missionWarnings,
      status,
      assignedSeats,
      requiredSeats,
      unresolved: missionUnresolved,
    });
  }

  return {
    status,
    assignedSeats: output.filled,
    requiredSeats: output.requiredSeats,
    results,
    warnings,
    unresolved: output.unresolved,
    objectiveSummary: output.objectiveSummary,
  };
}

export async function autoAssignMission(
  missionId: string,
  options: { keepExisting?: boolean; includeSameDay?: boolean } = {},
): Promise<AutoAssignResult> {
  const keepExisting = options.keepExisting !== false;
  const includeSameDay = options.includeSameDay !== false;
  const mission = await getMissionDay(missionId);
  if (!mission) throw new Error("יום משימה לא נמצא");

  const [people, issues, rules, allMissions] = await Promise.all([
    loadPeople(),
    loadApprovedIssues(),
    getFairnessRules(),
    listMissionDays(false),
  ]);

  if (!people.length) throw new Error("אין צוערים פעילים במאגר");

  const scopeMissions =
    !includeSameDay
      ? [mission]
      : sameDayMissionScope(mission, allMissions);

  const dayResult = await smartAssignScope({
    scopeMissions,
    allMissions,
    people,
    issues,
    rules,
    keepExisting,
  });

  const focus = dayResult.results.find((r) => r.mission.id === missionId);
  if (!focus) {
    throw new Error("שגיאה בשמירת שיבוץ");
  }
  return focus;
}

export async function autoAssignDate(
  missionDate: string,
  options: { keepExisting?: boolean } = {},
): Promise<SmartAssignDayResult> {
  const keepExisting = options.keepExisting !== false;
  const allMissions = await listMissionDays(false);
  const scopeMissions = allMissions.filter(
    (m) => m.mission_date === missionDate.slice(0, 10),
  );

  if (!scopeMissions.length) {
    throw new Error("אין ימי משימה בתאריך זה");
  }

  const typeOrder: Record<string, number> = {
    kitchen: 0,
    base_work: 1,
    guards: 2,
  };
  scopeMissions.sort(
    (a, b) =>
      (typeOrder[a.mission_type] ?? 9) - (typeOrder[b.mission_type] ?? 9) ||
      a.starts_at.localeCompare(b.starts_at),
  );

  const [people, issues, rules] = await Promise.all([
    loadPeople(),
    loadApprovedIssues(),
    getFairnessRules(),
  ]);

  if (!people.length) throw new Error("אין צוערים פעילים במאגר");

  return smartAssignScope({
    scopeMissions,
    allMissions,
    people,
    issues,
    rules,
    keepExisting,
  });
}
