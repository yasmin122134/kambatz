import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { runGlobalAssign } from "@/lib/global-assign";
import {
  blockedByIssue,
  createEmptyScheduleTracker,
  findAssignmentConflicts,
  fitsPerson,
  validateGeneratedRoster,
} from "@/lib/scheduling-engine";
import type { Issue, MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES, rest_hours: 8 };

function person(name: string, overrides: Partial<Person> = {}): Person {
  return {
    id: name,
    name,
    email: null,
    room: "101",
    gender: "m",
    squad: 1,
    active: true,
    no_guard: false,
    prior_score: 0,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
    ...overrides,
  };
}

function guardMission(assignments: Record<string, string[]> = {}): MissionDay {
  const startsAt = "2026-03-01T07:00:00.000Z";
  const endsAt = "2026-03-02T07:00:00.000Z";
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "09:00",
    shiftHours: 4,
  });
  return {
    id: "m1",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function approvedIssue(
  personName: string,
  start: string,
  end: string,
  constraintDate = "2026-03-01",
): Issue {
  return {
    id: `issue-${personName}-${start}`,
    person_id: personName,
    person_name: personName,
    constraint_date: constraintDate,
    start_time: start,
    end_time: end,
    issue_type: "trial",
    note: "מבחן",
    status: "approved",
    created_at: "",
  };
}

function pendingIssue(
  personName: string,
  start: string,
  end: string,
): Issue {
  return { ...approvedIssue(personName, start, end), status: "pending" };
}

describe("constraints end-to-end", () => {
  it("pending issue does not block assignment", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find((s) => s.positionKind === "guard")!;
    const blocked = person("חסום");
    const peopleByName = { [blocked.name]: blocked };
    const issues = [pendingIssue(blocked.name, guardSlot.startTime, guardSlot.endTime)];

    expect(blockedByIssue(blocked.name, guardSlot, issues)).toBe(false);
    expect(
      fitsPerson(blocked, guardSlot, createEmptyScheduleTracker(), issues, scheduling, [], peopleByName),
    ).toBe(true);
  });

  it("approved issue blocks manual roster via findAssignmentConflicts", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find((s) => s.positionKind === "guard")!;
    const blocked = person("חסום");
    const peopleByName = { [blocked.name]: blocked };
    const issues = [approvedIssue(blocked.name, guardSlot.startTime, guardSlot.endTime)];

    const conflicts = findAssignmentConflicts(
      {
        ...mission,
        assignments: { [guardSlot.slotId]: [blocked.name] },
      },
      peopleByName,
      issues,
    );

    expect(conflicts.some((m) => m.includes("התנגשות עם חסימה מאושרת"))).toBe(true);
  });

  it("approved issue on another date does not block assignment", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find((s) => s.positionKind === "guard")!;
    const blocked = person("חסום");
    const peopleByName = { [blocked.name]: blocked };
    const issues = [
      approvedIssue(blocked.name, guardSlot.startTime, guardSlot.endTime, "2026-03-15"),
    ];

    expect(blockedByIssue(blocked.name, guardSlot, issues)).toBe(false);
    expect(
      findAssignmentConflicts(
        {
          ...mission,
          assignments: { [guardSlot.slotId]: [blocked.name] },
        },
        peopleByName,
        issues,
      ),
    ).toEqual([]);
  });

  it("smart assign skips person with approved time block", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const morningGuard = slots.find(
      (s) => s.positionKind === "guard" && s.startTime === "09:00",
    ) ?? slots.find((s) => s.positionKind === "guard");
    expect(morningGuard).toBeDefined();
    if (!morningGuard) return;

    const blocked = person("חסום");
    const free = person("פנוי");
    const people = [blocked, free];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
    const issues = [
      approvedIssue(blocked.name, morningGuard.startTime, morningGuard.endTime),
    ];

    const result = runGlobalAssign({
      missions: [mission],
      people,
      issues,
      rules,
      meanPrior: 0,
      keepExisting: false,
    });

    const assignments = result.assignmentsByMission.get(mission.id) || {};
    const assignedBlocked = (assignments[morningGuard.slotId] || []).includes(
      blocked.name,
    );
    expect(assignedBlocked).toBe(false);

    const missionWithAssignments = {
      ...mission,
      assignments,
    };
    const rosterErrors = validateGeneratedRoster({
      missions: [missionWithAssignments],
      peopleByName,
      issues,
    });
    expect(rosterErrors.some((e) => e.includes("אילוץ מאושר"))).toBe(false);
  });

  it("approved no_guard flag blocks guard assignment", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find((s) => s.positionKind === "guard")!;
    const exempt = person("פטור", { no_guard: true });
    const peopleByName = { [exempt.name]: exempt };

    const conflicts = findAssignmentConflicts(
      {
        ...mission,
        assignments: { [guardSlot.slotId]: [exempt.name] },
      },
      peopleByName,
      [],
    );

    expect(conflicts.some((m) => m.includes("פטור משמירה"))).toBe(true);
  });
});
