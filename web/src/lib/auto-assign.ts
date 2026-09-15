import { createClient } from "@/lib/supabase/server";
import { linkedGuardDayAssignScope } from "@/lib/guard-day-bundle";
import { missionsForDateAssignScope } from "@/lib/guard-day-scope";
import { getFairnessRules } from "@/lib/fairness";
import { runGlobalAssign, type SmartAssignStatus, type UnresolvedRequirement } from "@/lib/global-assign";
import { hashStringsToSeed } from "@/lib/seeded-random";
import {
  filterStaleUnresolvedRequirements,
  formatUnresolvedSummary,
} from "@/lib/global-assign/diagnostics";
import {
  forceFillEmptySeats,
  repairGuardAssignmentGaps,
  stripGuardSpacingViolations,
  stripAbasTimeViolations,
  clearOverlappingAbasAssignments,
  auditAssignedRoster,
  buildTrackerFromMissions,
  type AssignConstraintPolicy,
} from "@/lib/scheduling-engine";
import {
  coverageFillRank,
  flattenMissionSlots,
  syncAssignmentSeats,
  normalizeSchedulingRules,
} from "@/lib/mission-utils";
import { restoreLockedAssignments, shouldKeepSeatOnAssign } from "@/lib/assignment-lock";
import { validateAbasRosterIndependent } from "@/lib/abas-validator";
import {
  applyAssignmentsOnly,
  assertMissionStructureUnchanged,
  cloneMissionPositions,
  snapshotMissionStructure,
  validateMissionStructureForAssignment,
} from "@/lib/mission-slot-structure";
import {
  getMissionDay,
  listMissionDays,
  listMissionDaysForContext,
  listVisibleMissionDays,
  saveMissionDay,
} from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { loadApprovedIssues } from "@/lib/issues";
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

function sameDayMissionScope(mission: MissionDay, allMissions: MissionDay[]): MissionDay[] {
  const date = mission.mission_date.slice(0, 10);
  return allMissions.filter((m) => m.mission_date.slice(0, 10) === date);
}

function missionsForAssignAudit(
  drafts: MissionDay[],
  allMissions: MissionDay[],
): MissionDay[] {
  const byId = new Map<string, MissionDay>();
  const dates = new Set<string>();
  for (const mission of drafts) {
    byId.set(mission.id, mission);
    dates.add(mission.mission_date.slice(0, 10));
  }
  for (const mission of allMissions) {
    if (byId.has(mission.id)) continue;
    if (!dates.has(mission.mission_date.slice(0, 10))) continue;
    byId.set(mission.id, mission);
  }
  return [...byId.values()];
}

function countSkippedSeats(mission: MissionDay, keepExisting: boolean): number {
  let skipped = 0;
  const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
  for (const [slotId, seats] of Object.entries(assignments)) {
    for (let i = 0; i < seats.length; i++) {
      if (shouldKeepSeatOnAssign(mission, slotId, i, seats[i], keepExisting)) {
        skipped += 1;
      }
    }
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

function countMandatoryEmptySeats(
  mission: MissionDay,
  assignments: Record<string, string[]>,
): number {
  return flattenMissionSlots({ ...mission, assignments }).reduce((n, slot) => {
    if (coverageFillRank(slot) !== 0) return n;
    const filled = (assignments[slot.slotId] || []).filter(Boolean).length;
    return n + Math.max(0, slot.seatCount - filled);
  }, 0);
}

async function smartAssignScope(input: {
  scopeMissions: MissionDay[];
  allMissions: MissionDay[];
  people: Person[];
  issues: Issue[];
  rules: Awaited<ReturnType<typeof getFairnessRules>>;
  keepExisting: boolean;
  preWarnings?: string[];
  constraintPolicy?: AssignConstraintPolicy;
}): Promise<SmartAssignDayResult> {
  const meanPrior =
    input.people.reduce((sum, p) => sum + (p.prior_score || 0), 0) /
    (input.people.length || 1);
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const constraintPolicy: AssignConstraintPolicy =
    input.constraintPolicy === "strict_rest" ? "strict_rest" : "standard";

  const structureBefore = input.scopeMissions.map((m) => snapshotMissionStructure(m));
  for (const mission of input.scopeMissions) {
    const structureErrors = validateMissionStructureForAssignment(mission);
    if (structureErrors.length) {
      throw new Error(
        `מבנה המשימה אינו תקין — תקנו או סנכרנו משמרות לפני שיבוץ:\n${structureErrors.join("\n")}`,
      );
    }
  }

  const randomSeed = hashStringsToSeed([
    ...input.scopeMissions.map((m) => m.mission_date),
    ...input.scopeMissions.map((m) => m.id),
    String(Date.now()),
    String(Math.random()),
  ]);

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
    randomSeed,
    constraintPolicy,
  });

  for (const mission of input.scopeMissions) {
    if (mission.mission_type !== "guards") continue;
    const assignments = output.assignmentsByMission.get(mission.id);
    if (!assignments) continue;

    let currentAssignments = syncAssignmentSeats(mission.positions, { ...assignments });
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);

    for (let round = 0; round < 3; round++) {
      const draftMissions = input.scopeMissions.map((m) => ({
        ...m,
        assignments:
          m.id === mission.id
            ? currentAssignments
            : output.assignmentsByMission.get(m.id) ?? m.assignments,
      }));
      const tracker = buildTrackerFromMissions(
        [
          ...input.allMissions.filter((m) => !draftMissions.some((d) => d.id === m.id)),
          ...draftMissions,
        ],
        input.rules,
        new Set(),
        constraintPolicy,
      );

      const { assignments: repaired } = repairGuardAssignmentGaps({
        mission: { ...mission, assignments: currentAssignments },
        assignments: currentAssignments,
        people: input.people,
        tracker,
        issues: input.issues,
        scheduling,
        rules: input.rules,
        meanPrior,
        randomSeed,
      });
      currentAssignments = repaired;

      const trackerAfterRepair = buildTrackerFromMissions(
        [
          ...input.allMissions.filter((m) => !draftMissions.some((d) => d.id === m.id)),
          ...draftMissions.map((m) =>
            m.id === mission.id ? { ...m, assignments: currentAssignments } : m,
          ),
        ],
        input.rules,
        new Set(),
        constraintPolicy,
      );
      const { assignments: forceFilled, warnings: fillWarnings, filled: roundFilled } =
        forceFillEmptySeats({
          mission: { ...mission, assignments: currentAssignments },
          assignments: currentAssignments,
          people: input.people,
          tracker: trackerAfterRepair,
          issues: input.issues,
          scheduling,
          rules: input.rules,
          meanPrior,
          randomSeed,
          allowCoverageFill: false,
        });
      currentAssignments = forceFilled;
      if (fillWarnings.length) {
        for (const w of fillWarnings) {
          if (!output.warnings.includes(w)) output.warnings.push(w);
        }
      }

      let guardStripped = 0;
      if (constraintPolicy !== "strict_rest") {
        const stripped = stripGuardSpacingViolations({
          mission,
          assignments: currentAssignments,
          scheduling,
          rules: input.rules,
        });
        currentAssignments = stripped.assignments;
        guardStripped = stripped.removed;
        if (guardStripped > 0) {
          const msg = `הוסרו ${guardStripped} שיבוצי שמירה רצופים/צמודים (יחס ${scheduling.guard_ratio ?? 2}:1)`;
          if (!output.warnings.includes(msg)) output.warnings.push(msg);
        }
      }

      if (roundFilled === 0 && guardStripped === 0) break;
    }

    if (countMandatoryEmptySeats(mission, currentAssignments) > 0) {
      const draftMissions = input.scopeMissions.map((m) => ({
        ...m,
        assignments:
          m.id === mission.id
            ? currentAssignments
            : output.assignmentsByMission.get(m.id) ?? m.assignments,
      }));
      const lastResortTracker = buildTrackerFromMissions(
        [
          ...input.allMissions.filter((m) => !draftMissions.some((d) => d.id === m.id)),
          ...draftMissions,
        ],
        input.rules,
        new Set(),
        constraintPolicy,
      );
      const lastResort = forceFillEmptySeats({
        mission: { ...mission, assignments: currentAssignments },
        assignments: currentAssignments,
        people: input.people,
        tracker: lastResortTracker,
        issues: input.issues,
        scheduling,
        rules: input.rules,
        meanPrior,
        randomSeed,
        allowCoverageFill: true,
      });
      currentAssignments = lastResort.assignments;
      if (lastResort.warnings.length) {
        for (const w of lastResort.warnings) {
          if (!output.warnings.includes(w)) output.warnings.push(w);
        }
      }
    }

    const abasStripped = stripAbasTimeViolations({
      mission,
      assignments: currentAssignments,
      scheduling,
      rules: input.rules,
      constraintPolicy,
    });
    currentAssignments = abasStripped.assignments;
    if (abasStripped.removed > 0) {
      const msg = `הוסרו ${abasStripped.removed} שיבוצי עב״ס שחפפו שמירה או הפרו מרווח מנוחה`;
      if (!output.warnings.includes(msg)) output.warnings.push(msg);
    }

    currentAssignments = restoreLockedAssignments(mission, currentAssignments);
    const afterLocks = stripAbasTimeViolations({
      mission,
      assignments: currentAssignments,
      scheduling,
      rules: input.rules,
      constraintPolicy,
    });
    currentAssignments = afterLocks.assignments;
    if (afterLocks.removed > 0) {
      const msg = `הוסרו ${afterLocks.removed} שיבוצי עב״ס נעולים שחפפו שמירה`;
      if (!output.warnings.includes(msg)) output.warnings.push(msg);
    }
    output.assignmentsByMission.set(mission.id, currentAssignments);
  }

  for (const mission of input.scopeMissions) {
    const assignments = output.assignmentsByMission.get(mission.id);
    if (!assignments) continue;
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    const restored = restoreLockedAssignments(mission, assignments);
    const stripped = stripAbasTimeViolations({
      mission,
      assignments: restored,
      scheduling,
      rules: input.rules,
    });
    const sanitized = clearOverlappingAbasAssignments({
      mission,
      assignments: stripped.assignments,
    });
    output.assignmentsByMission.set(mission.id, sanitized.assignments);
    if (sanitized.removed > 0) {
      const msg = `הוסרו ${sanitized.removed} שיבוצי עב״ס שחפפו שמירה`;
      if (!output.warnings.includes(msg)) output.warnings.push(msg);
    }
  }

  let postFilled = 0;
  for (const mission of input.scopeMissions) {
    const assignments = output.assignmentsByMission.get(mission.id);
    if (!assignments) continue;
    postFilled += countMissionFilledSeats(assignments);
  }
  output.filled = postFilled;

  output.unresolved = filterStaleUnresolvedRequirements(
    output.unresolved,
    input.scopeMissions,
    output.assignmentsByMission,
  );
  output.warnings = output.warnings.filter(
    (w) => !w.startsWith("Smart assignment completed with"),
  );
  output.warnings.push(...formatUnresolvedSummary(output.unresolved));

  const draftMissions = input.scopeMissions.map((mission) => ({
    ...mission,
    assignments: output.assignmentsByMission.get(mission.id) ?? mission.assignments,
  }));

  const auditMissions = missionsForAssignAudit(draftMissions, input.allMissions);
  const validationErrors = [
    ...auditAssignedRoster({
      missions: auditMissions,
      issues: input.issues,
      peopleByName,
      focusMissionIds: draftMissions.map((m) => m.id),
    }),
  ];
  for (const mission of draftMissions) {
    const original = input.scopeMissions.find((m) => m.id === mission.id);
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    validationErrors.push(
      ...validateAbasRosterIndependent({
        mission,
        people: input.people,
        minGuardAbasRestMin: scheduling.duty_guard_gap_minutes ?? 30,
        minGuardGuardRestMin: 8,
        originalAssignments: input.keepExisting ? original?.assignments : undefined,
      }),
    );
  }

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

    const { mission: saved } = await saveMissionDay(
      applyAssignmentsOnly(mission, assignments),
      { validateAssignments: false },
    );

    const requiredSeats = countMissionRequiredSeats(mission);
    const assignedSeats = countMissionFilledSeats(assignments);
    const missionUnresolved = output.unresolved.filter((u) => u.missionId === mission.id);

    results.push({
      mission: saved,
      filled: Math.max(0, assignedSeats - countSkippedSeats(mission, input.keepExisting)),
      skipped: countSkippedSeats(mission, input.keepExisting),
      warnings,
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
  options: {
    keepExisting?: boolean;
    includeSameDay?: boolean;
    constraintPolicy?: AssignConstraintPolicy;
  } = {},
): Promise<AutoAssignResult> {
  const keepExisting = options.keepExisting !== false;
  const includeSameDay = options.includeSameDay !== false;
  const mission = await getMissionDay(missionId);
  if (!mission) throw new Error("יום משימה לא נמצא");

  const [people, issues, rules, publishedMissions, contextMissions] = await Promise.all([
    loadPeople(),
    loadApprovedIssues(),
    getFairnessRules(),
    listVisibleMissionDays(),
    listMissionDaysForContext({ includeDraftIds: [missionId] }),
  ]);

  if (!people.length) throw new Error("אין צוערים פעילים במאגר");

  const scopeMissions = includeSameDay
    ? sameDayMissionScope(mission, contextMissions)
    : linkedGuardDayAssignScope(mission, contextMissions);

  const dayResult = await smartAssignScope({
    scopeMissions,
    allMissions: publishedMissions,
    people,
    issues,
    rules,
    keepExisting,
    constraintPolicy: options.constraintPolicy,
  });

  const focus = dayResult.results.find((r) => r.mission.id === missionId);
  if (!focus) {
    throw new Error("שגיאה בשמירת שיבוץ");
  }
  return focus;
}

export async function autoAssignDate(
  missionDate: string,
  options: {
    keepExisting?: boolean;
    constraintPolicy?: AssignConstraintPolicy;
    focusMissionId?: string;
  } = {},
): Promise<SmartAssignDayResult> {
  const keepExisting = options.keepExisting !== false;
  const loaded = await listMissionDays(false);
  // משאירים משימות עב״ס מקושרות בקונטקסט — כדי שחפיפות מולן ייחסמו ויזוהו באזהרות.
  const allMissions = loaded;
  const scopeMissions = missionsForDateAssignScope(loaded, missionDate);

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
    constraintPolicy: options.constraintPolicy,
  });
}
