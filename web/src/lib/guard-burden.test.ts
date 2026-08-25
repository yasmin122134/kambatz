import { describe, expect, it } from "vitest";
import {
  calculateGuardAssignmentBurden,
  calculatePersonBurden,
  calculateProjectedCandidateBurden,
  blockFromFlatSlot,
  getGuardBaseBurden,
  getRestHoursBetween,
  getRestPenalty,
  toranutPointsForMissionBlock,
  type BurdenTimelineBlock,
} from "@/lib/guard-burden";
import {
  canAssignKind,
  createEmptyScheduleTracker,
  fitsPerson,
  pickBestCandidate,
  type ScheduleTracker,
} from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import type { FairnessRules, Issue, MissionSchedulingRules, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules: FairnessRules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling: MissionSchedulingRules = { ...DEFAULT_MISSION_SCHEDULING_RULES };

function guardBlock(
  start: string,
  end: string,
  seats: number,
  slotId = crypto.randomUUID(),
): BurdenTimelineBlock {
  const [sh, sm] = start.split(":").map(Number);
  const dur =
    end === start
      ? 1440
      : (() => {
          const [eh, em] = end.split(":").map(Number);
          let d = eh * 60 + em - (sh * 60 + sm);
          if (d <= 0) d += 1440;
          return d;
        })();
  return {
    wallStartMin: sh * 60 + sm,
    calendarDayOffset: 0,
    durationMinutes: dur,
    eatsRest: true,
    positionKind: "guard",
    missionType: "guards",
    seatCount: seats,
    startTime: start,
    endTime: end,
    slotId,
  };
}

function flatSlot(
  start: string,
  end: string,
  seats: number,
  slotId = "slot-1",
): FlatSlot {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let dur = eh * 60 + em - (sh * 60 + sm);
  if (dur <= 0) dur += 1440;
  return {
    slotId,
    positionId: "pos-1",
    positionName: "פטל",
    positionKind: "guard",
    sameRoom: false,
    sameGender: false,
    missionType: "guards",
    startTime: start,
    endTime: end,
    timeLabel: `${start}–${end}`,
    seatCount: seats,
    assignees: [],
    sortKey: sh * 60 + sm,
    durationMinutes: dur,
    cyclicStart: ((sh * 60 + sm - 20 * 60) % 1440 + 1440) % 1440,
    wallStartMin: sh * 60 + sm,
    calendarDayOffset: sh * 60 + sm < 20 * 60 ? 1 : 0,
    startAtMs: new Date(`2026-01-15T${start}:00`).getTime(),
    endAtMs: new Date(`2026-01-15T${start}:00`).getTime() + dur * 60_000,
  };
}

describe("guard base scoring", () => {
  it("daytime 08–12 = 4 points solo, 3.6 paired (−0.1/h)", () => {
    expect(getGuardBaseBurden("08:00", "12:00", 1)).toBe(4);
    expect(getGuardBaseBurden("08:00", "12:00", 2)).toBe(3.6);
  });

  it("night 00–04 = 5 points (1.25/h)", () => {
    expect(getGuardBaseBurden("00:00", "04:00", 1)).toBe(5);
  });

  it("shortened 2h night 00–02 = 2.5", () => {
    expect(getGuardBaseBurden("00:00", "02:00", 1)).toBe(2.5);
  });

  it("shift spanning night and day 02–06 is all night window", () => {
    expect(getGuardBaseBurden("02:00", "06:00", 1)).toBe(5);
  });

  it("three night hours 02–05", () => {
    expect(getGuardBaseBurden("02:00", "05:00", 1)).toBe(3.75);
  });

  it("cross-midnight 22–02 = 5", () => {
    expect(getGuardBaseBurden("22:00", "02:00", 1)).toBe(5);
  });

  it("observation post uses lower rate", () => {
    expect(getGuardBaseBurden("08:00", "12:00", 1, rules, "תצפיתן")).toBe(2.4);
  });
});

describe("rest penalty boundaries", () => {
  it.each([
    [12, 0],
    [11.9, 1],
    [10, 1],
    [9.9, 2],
    [8, 2],
    [7.9, 3],
    [6, 3],
    [5.9, 4],
    [4, 4],
    [3.9, 5],
    [3, 5],
    [2.9, 6],
    [2, 6],
    [1.9, 7],
    [1, 7],
    [0.5, 8],
  ] as const)("rest %sh → +%i", (hours, penalty) => {
    expect(getRestPenalty(hours)).toBe(penalty);
  });
});

describe("rest hours between blocks", () => {
  it("computes gap between kitchen and guard", () => {
    const kitchen = guardBlock("08:00", "12:00", 1);
    kitchen.missionType = "kitchen";
    kitchen.positionKind = "kitchen";
    const guard = guardBlock("20:00", "00:00", 1);
    guard.calendarDayOffset = 0;
    expect(getRestHoursBetween(kitchen, guard)).toBe(8);
  });
});

describe("kitchen vs guard day point categories", () => {
  it("kitchen mission → toranut; guard day → guard points", () => {
    const kitchen: BurdenTimelineBlock = {
      ...guardBlock("08:00", "12:00", 1),
      missionType: "kitchen",
      positionKind: "kitchen",
    };
    const guard = guardBlock("20:00", "00:00", 1);
    const breakdown = calculatePersonBurden([kitchen, guard], rules, scheduling);
    expect(breakdown.kitchenPoints).toBe(1);
    expect(breakdown.toranutPoints).toBe(1);
    expect(breakdown.guardPoints).toBeGreaterThan(0);
    expect(breakdown.dutyPoints).toBe(breakdown.guardPoints);
    expect(breakdown.fairnessPoints).toBe(
      Math.round((breakdown.guardPoints + breakdown.toranutPoints) * 100) / 100,
    );
  });
});

describe("no double-counting rest penalties", () => {
  it("two guards share one gap penalty total", () => {
    const a = guardBlock("00:00", "04:00", 1, "a");
    const b = guardBlock("12:00", "16:00", 1, "b");
    const breakdown = calculatePersonBurden([a, b], rules);
    expect(breakdown.restPenalties).toBe(getRestPenalty(8));
    expect(breakdown.guardBaseBurden).toBe(5 + 4);
  });
});

describe("ABAS base work shift points", () => {
  it("assigns fixed points per ABAS window", () => {
    const morning: BurdenTimelineBlock = {
      ...guardBlock("08:30", "11:30", 14),
      missionType: "base_work",
      positionKind: "duty",
    };
    const breakdown = calculatePersonBurden([morning], rules, scheduling);
    expect(breakdown.otherMissionPoints).toBe(2.25);
    expect(breakdown.guardPoints).toBe(2.25);
    expect(breakdown.toranutPoints).toBe(0);
  });
});

describe("reserve force scoring", () => {
  it("scores 0.3 points per hour", () => {
    const block: BurdenTimelineBlock = {
      wallStartMin: 8 * 60,
      calendarDayOffset: 0,
      durationMinutes: 240,
      eatsRest: false,
      positionKind: "duty",
      missionType: "guards",
      seatCount: 1,
      startTime: "08:00",
      endTime: "12:00",
      slotId: "r1",
      positionName: "כוח עתודה",
    };
    expect(toranutPointsForMissionBlock(block, rules)).toBe(1.2);
  });
});

describe("paired guard individual burden", () => {
  it("each person gets paired score with hourly discount", () => {
    const detail = calculateGuardAssignmentBurden(guardBlock("00:00", "04:00", 2), null);
    expect(detail.baseBurden).toBe(4.6);
    expect(detail.isSolo).toBe(false);
  });
});

describe("fairness candidate selection", () => {
  it("prefers cadet with easy shift over cadet with hard night shift", () => {
    const hardWorker: Person = {
      id: "1",
      name: "א׳",
      email: null,
      room: "1",
      gender: "m",
      active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
      prior_score: 0,
      created_at: "",
    };
    const easyWorker: Person = {
      ...hardWorker,
      id: "2",
      name: "ב׳",
    };

    const tracker: ScheduleTracker = {
      busy: {
        "א׳": [
          {
            ...guardBlock("00:00", "04:00", 1, "hard"),
            cyclicStart: 240,
            missionId: "m1",
            slotId: "hard",
            startAtMs: new Date("2026-01-15T00:00:00").getTime(),
            endAtMs: new Date("2026-01-15T04:00:00").getTime(),
          },
        ],
        "ב׳": [
          {
            ...guardBlock("08:00", "12:00", 2, "easy"),
            cyclicStart: 720,
            missionId: "m1",
            slotId: "easy",
            startAtMs: new Date("2026-01-15T08:00:00").getTime(),
            endAtMs: new Date("2026-01-15T12:00:00").getTime(),
          },
        ],
      },
      guardShifts: {},
      periodPoints: {},
      kitchenPoints: {},
      dutyPoints: { "א׳": 10, "ב׳": 5 },
    };

    const slot = flatSlot("00:00", "04:00", 1, "next-hard");
    const chosen = pickBestCandidate(
      [hardWorker, easyWorker],
      slot,
      tracker,
      rules,
      0,
      { scheduling },
    );
    expect(chosen?.name).toBe("ב׳");
  });
});

describe("hard constraints still gate eligibility", () => {
  const slot = flatSlot("08:00", "12:00", 1);
  const emptyTracker = createEmptyScheduleTracker();
  const peopleByName: Record<string, Person> = {};

  const basePerson = (overrides: Partial<Person> = {}): Person => ({
    id: "p1",
    name: "צוער",
    email: null,
    room: null,
    gender: null,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
    ...overrides,
  });

  it("only duty officers can fill officer_duty", () => {
    const officer = basePerson({ id: "o1", name: "רני פלג", is_officer: true });
    const cadet = basePerson({ id: "c1", name: "צוער", is_officer: false });
    expect(canAssignKind(officer, "officer_duty")).toBe(true);
    expect(canAssignKind(cadet, "officer_duty")).toBe(false);
  });

  it("duty officer with no_guard can still fill officer_duty", () => {
    const yasmin = basePerson({
      id: "y1",
      name: "יסמין חדד",
      is_officer: true,
      no_guard: true,
    });
    expect(canAssignKind(yasmin, "officer_duty")).toBe(true);
    expect(canAssignKind(yasmin, "guard")).toBe(false);
  });

  it("prefers the other duty officer for the second half-day shift", () => {
    const rani = basePerson({ id: "r1", name: "רני פלג", is_officer: true });
    const yasmin = basePerson({
      id: "y2",
      name: "יסמין חדד",
      is_officer: true,
      no_guard: true,
    });
    const officerSlot: FlatSlot = {
      ...flatSlot("12:00", "00:00", 1),
      positionKind: "officer_duty",
      positionName: "קצין תורן",
    };
    const chosen = pickBestCandidate(
      [rani, yasmin],
      officerSlot,
      emptyTracker,
      DEFAULT_FAIRNESS_RULES,
      0,
      { dutyOfficerAlreadyAssigned: "רני פלג" },
    );
    expect(chosen?.name).toBe("יסמין חדד");
  });

  it("no_guard cannot be assigned to guard", () => {
    const p = basePerson({ id: "1", name: "פטור", no_guard: true });
    expect(canAssignKind(p, "guard")).toBe(false);
    expect(
      fitsPerson(p, slot, emptyTracker, [], scheduling, [], peopleByName),
    ).toBe(false);
  });

  it("no_standing only allows observation post", () => {
    const p = basePerson({ id: "2", name: "יושב", no_standing: true });
    const patrol: FlatSlot = {
      ...slot,
      positionName: "פטל",
    };
    const watch: FlatSlot = {
      ...slot,
      positionName: "תצפיתן",
    };
    expect(
      canAssignKind(p, "guard", { positionName: patrol.positionName }),
    ).toBe(false);
    expect(
      canAssignKind(p, "guard", { positionName: watch.positionName }),
    ).toBe(true);
    expect(
      fitsPerson(p, patrol, emptyTracker, [], scheduling, [], peopleByName),
    ).toBe(false);
    expect(
      fitsPerson(p, watch, emptyTracker, [], scheduling, [], peopleByName),
    ).toBe(true);
  });

  it("no_kitchen blocks kitchen duty", () => {
    const p = basePerson({ id: "3", name: "לא מטבח", no_kitchen: true });
    expect(canAssignKind(p, "kitchen")).toBe(false);
  });

  it("no_standby blocks carmel", () => {
    const p = basePerson({ id: "4", name: "לא כרמל", no_standby: true });
    expect(canAssignKind(p, "standby_carmel_a")).toBe(false);
    expect(canAssignKind(p, "standby_carmel_b")).toBe(false);
  });

  it("no_base_work blocks base work", () => {
    const p = basePerson({ id: "5", name: "לא עבס", no_base_work: true });
    expect(canAssignKind(p, "duty", { missionType: "base_work" })).toBe(false);
  });

  it("approved issue blocks assignment", () => {
    const p = basePerson({ id: "6", name: "חסום" });
    peopleByName[p.name] = p;
    const issues: Issue[] = [
      {
        id: "i1",
        person_id: p.id,
        person_name: p.name,
        constraint_date: "2026-01-15",
        start_time: "07:00",
        end_time: "13:00",
        issue_type: "medical",
        note: null,
        status: "approved",
        created_at: "",
      },
    ];
    expect(fitsPerson(p, slot, emptyTracker, issues, scheduling, [], peopleByName)).toBe(
      false,
    );
  });
});

describe("projected burden with cross-mission rest", () => {
  it("earlier kitchen affects rest penalty for later guard", () => {
    const kitchen: BurdenTimelineBlock = {
      ...guardBlock("08:00", "12:00", 1),
      missionType: "kitchen",
      positionKind: "kitchen",
    };
    const guardSlot = flatSlot("14:00", "18:00", 1);
    guardSlot.calendarDayOffset = 0;
    const projected = calculateProjectedCandidateBurden(
      "cadet",
      guardSlot,
      [kitchen],
      rules,
      scheduling,
    );
    const baseOnly = getGuardBaseBurden("14:00", "18:00", 1);
    const breakdown = calculatePersonBurden(
      [kitchen, blockFromFlatSlot(guardSlot, guardSlot.missionType, 1)],
      rules,
      scheduling,
    );
    expect(breakdown.restPenalties).toBeGreaterThan(0);
    expect(breakdown.dutyPoints).toBeGreaterThan(baseOnly);
    expect(projected).toBe(breakdown.dutyPoints);
  });
});
