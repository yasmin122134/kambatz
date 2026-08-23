import { describe, expect, it } from "vitest";
import { meanAbsoluteDeviation, spreadWithOverrides } from "@/lib/fairness-spread";
import {
  compareByFairnessThenBurden,
  createEmptyScheduleTracker,
  rosterBurdenSpread,
  type ScheduleTracker,
} from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import { DEFAULT_FAIRNESS_RULES, type Person } from "@/lib/types";

function person(name: string, prior = 0): Person {
  return {
    id: name,
    name,
    email: null,
    room: null,
    gender: "m",
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: prior,
    created_at: "",
  };
}

function trackerWithDuty(name: string, duty: number): ScheduleTracker {
  const tracker = createEmptyScheduleTracker();
  tracker.dutyPoints[name] = duty;
  tracker.periodPoints[name] = duty;
  return tracker;
}

describe("meanAbsoluteDeviation", () => {
  it("returns 0 for uniform values", () => {
    expect(meanAbsoluteDeviation([2, 2, 2])).toBe(0);
  });

  it("measures average distance from mean", () => {
    expect(meanAbsoluteDeviation([0, 0, 6])).toBeCloseTo(8 / 3, 3);
  });
});

describe("spreadWithOverrides", () => {
  it("includes unassigned roster members at zero burden", () => {
    const base = new Map([
      ["א", 8],
      ["ב", 0],
      ["ג", 0],
    ]);
    expect(spreadWithOverrides(base, ["א", "ב", "ג"], new Map())).toBeCloseTo(32 / 9, 3);
  });
});

describe("rosterBurdenSpread", () => {
  it("includes unassigned roster members at zero duty burden", () => {
    const roster = [person("א"), person("ב"), person("ג")];
    const tracker = trackerWithDuty("א", 8);
    const spread = rosterBurdenSpread(
      roster,
      tracker,
      DEFAULT_FAIRNESS_RULES,
      undefined,
      "duty",
    );
    expect(spread).toBeCloseTo(meanAbsoluteDeviation([8, 0, 0]), 3);
  });

  it("tracks kitchen spread separately from duty", () => {
    const roster = [person("א"), person("ב")];
    const tracker = createEmptyScheduleTracker();
    tracker.kitchenPoints = { א: 0.1, ב: 0 };
    tracker.dutyPoints = { א: 6, ב: 6 };
    expect(
      rosterBurdenSpread(roster, tracker, DEFAULT_FAIRNESS_RULES, undefined, "kitchen"),
    ).toBeCloseTo(0.05, 3);
    expect(
      rosterBurdenSpread(roster, tracker, DEFAULT_FAIRNESS_RULES, undefined, "duty"),
    ).toBe(0);
  });
});

describe("compareByFairnessThenBurden", () => {
  it("prefers kitchen candidate that lowers kitchen spread", () => {
    const roster = [person("א"), person("ב"), person("ג", 20)];
    const tracker = createEmptyScheduleTracker();
    tracker.kitchenPoints = { א: 0.1 };
    tracker.dutyPoints = { א: 8 };
    const slot = {
      slotId: "s1",
      positionKind: "kitchen",
      missionType: "kitchen",
      seatCount: 1,
      startTime: "08:00",
      endTime: "12:00",
      timeLabel: "08:00–12:00",
      wallStartMin: 480,
      cyclicStart: 480,
      calendarDayOffset: 0,
      assignees: [],
      positionName: "מטבח",
      sortKey: 0,
    } as FlatSlot;

    const cmp = compareByFairnessThenBurden(
      person("ב"),
      person("ג", 20),
      slot,
      roster,
      tracker,
      DEFAULT_FAIRNESS_RULES,
      0,
    );
    expect(cmp).toBeLessThan(0);
  });
});
