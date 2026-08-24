import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { patrolAssigneeRole } from "@/lib/patrol-day-template";
import { runGlobalAssign } from "@/lib/global-assign";
import { flattenMissionSlots, syncAssignmentSeats } from "@/lib/mission-utils";
import {
  buildTrackerFromMissions,
  repairGuardAssignmentGaps,
  forceFillEmptySeats,
} from "@/lib/scheduling-engine";
import { normalizeSchedulingRules } from "@/lib/mission-utils";
import type { MissionDay, MissionPositionKind, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function rosterPerson(i: number): Person {
  return {
    id: `p${i}`,
    name: `person-${i}`,
    email: null,
    squad: (i % 4) + 1,
    room: `10${(i % 4) + 1}`,
    gender: i % 2 === 0 ? "m" : "f",
    active: true,
    prior_score: 0,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
  };
}

type PostProcessGap = {
  slot: string;
  filled: number;
  need: number;
  kind: MissionPositionKind;
};

function runPostProcessPipeline(
  mission: MissionDay,
  people: Person[],
  initialAssignments: Record<string, string[]>,
): {
  assignments: Record<string, string[]>;
  filled: number;
  required: number;
  gaps: PostProcessGap[];
} {
  let assignments = syncAssignmentSeats(mission.positions, { ...initialAssignments });
  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const required = flattenMissionSlots(mission).reduce((s, sl) => s + sl.seatCount, 0);

  for (let round = 0; round < 3; round++) {
    let tracker = buildTrackerFromMissions(
      [{ ...mission, assignments }],
      DEFAULT_FAIRNESS_RULES,
      new Set(),
    );
    assignments = repairGuardAssignmentGaps({
      mission,
      assignments,
      people,
      tracker,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
    }).assignments;
    tracker = buildTrackerFromMissions(
      [{ ...mission, assignments }],
      DEFAULT_FAIRNESS_RULES,
      new Set(),
    );
    const pass = forceFillEmptySeats({
      mission,
      assignments,
      people,
      tracker,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
    });
    assignments = pass.assignments;
    if (pass.filled === 0) break;
  }

  const filled = Object.values(assignments).reduce(
    (sum, seats) => sum + seats.filter(Boolean).length,
    0,
  );
  const gaps = flattenMissionSlots(mission)
    .filter((s) => {
      const seats = assignments[s.slotId] || [];
      return seats.filter(Boolean).length < s.seatCount;
    })
    .map((s) => ({
      slot: `${s.positionName} ${s.timeLabel}`,
      filled: (assignments[s.slotId] || []).filter(Boolean).length,
      need: s.seatCount,
      kind: s.positionKind,
    }));
  return { assignments, filled, required, gaps };
}

function autoAssignableSeatCount(mission: MissionDay): number {
  return flattenMissionSlots(mission)
    .filter((s) => {
      if (s.positionKind === "officer_duty") return false;
      if (
        s.positionKind === "patrol" &&
        patrolAssigneeRole(s.startTime, s.endTime) === "company_commander"
      ) {
        return false;
      }
      return true;
    })
    .reduce((sum, sl) => sum + sl.seatCount, 0);
}

function isExpectedManualGap(gap: PostProcessGap): boolean {
  if (gap.kind === "officer_duty") return true;
  if (gap.kind === "patrol") return true;
  return false;
}

describe("full guard day pipeline", () => {
  it("fills most seats with repair + forceFill (53 people, Aug 26-like window)", { timeout: 15000 }, () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-aug26",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const people = Array.from({ length: 53 }, (_, i) => rosterPerson(i));
    const required = flattenMissionSlots(mission).reduce((s, sl) => s + sl.seatCount, 0);
    expect(required).toBeGreaterThan(100);

    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });

    const { assignments, filled, required: req, gaps } = runPostProcessPipeline(mission, people, {
      ...(output.assignmentsByMission.get(mission.id) ?? {}),
    });

    const guardSlots = flattenMissionSlots(mission).filter((s) => s.positionName.includes("ימ״ח"));
    const yamach = guardSlots[0];
    const yamachFilled = (assignments[yamach?.slotId] || []).filter(Boolean).length;
    const cadetRequired = autoAssignableSeatCount(mission);

    expect(filled).toBeGreaterThan(100);
    expect(filled).toBe(cadetRequired);
    expect(gaps.every(isExpectedManualGap)).toBe(true);
    expect(yamachFilled).toBeGreaterThan(0);
  });

  it("repair alone leaves many guard gaps on full guard day", () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-aug26",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const people = Array.from({ length: 53 }, (_, i) => rosterPerson(i));
    const required = flattenMissionSlots(mission).reduce((s, sl) => s + sl.seatCount, 0);
    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });
    let assignments = syncAssignmentSeats(mission.positions, {
      ...(output.assignmentsByMission.get(mission.id) ?? {}),
    });
    const tracker = buildTrackerFromMissions(
      [{ ...mission, assignments }],
      DEFAULT_FAIRNESS_RULES,
      new Set(),
    );
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    const repaired = repairGuardAssignmentGaps({
      mission,
      assignments,
      people,
      tracker,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
    });
    let assigned = 0;
    for (const seats of Object.values(repaired.assignments)) {
      assigned += seats.filter(Boolean).length;
    }
    expect(assigned).toBeLessThan(required);
  });

  it("reports fill rate with 50 available cadets (2 officers excluded)", () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-aug26",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const people = Array.from({ length: 50 }, (_, i) => rosterPerson(i));
    const slots = flattenMissionSlots(mission);
    const required = slots.reduce((s, sl) => s + sl.seatCount, 0);
    const abasRequired = slots
      .filter((s) => s.missionType === "base_work")
      .reduce((s, sl) => s + sl.seatCount, 0);

    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });
    const { filled, required: req, gaps } = runPostProcessPipeline(mission, people, {
      ...(output.assignmentsByMission.get(mission.id) ?? {}),
    });
    const cadetRequired = autoAssignableSeatCount(mission);

    expect(required).toBeGreaterThan(abasRequired);
    expect(filled).toBe(cadetRequired);
    expect(gaps.every(isExpectedManualGap)).toBe(true);
    expect(req - cadetRequired).toBe(5);
  });
});
