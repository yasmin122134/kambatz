import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/seeded-random";
import { pickStochasticGuardCandidate } from "@/lib/stochastic-guard-pick";
import { createEmptyScheduleTracker } from "@/lib/scheduling-engine";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import type { FlatSlot } from "@/lib/mission-utils";
import type { Person } from "@/lib/types";

function person(name: string, prior = 0): Person {
  return {
    id: name,
    name,
    email: null,
    room: null,
    gender: "male",
    prior_score: prior,
    active: true,
    squad: null,
    role: "scout",
  };
}

function guardSlot(): FlatSlot {
  return {
    slotId: "rear",
    positionName: "ש״ג רכב אחורי",
    positionKind: "guard",
    missionType: "guards",
    startTime: "08:00",
    endTime: "12:00",
    seatCount: 1,
    timeLabel: "08:00–12:00",
    sameGender: false,
    sameRoom: false,
    cyclicStart: 480,
    kitchenShiftIndex: null,
  };
}

describe("pickStochasticGuardCandidate", () => {
  const roster = [person("א"), person("ב"), person("ג"), person("ד"), person("ה")];
  const tracker = createEmptyScheduleTracker();
  const slot = guardSlot();

  it("returns the only candidate when there is one", () => {
    const chosen = pickStochasticGuardCandidate([person("א")], {
      slot,
      roster,
      tracker,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      rng: mulberry32(1),
    });
    expect(chosen?.name).toBe("א");
  });

  it("picks deterministically with the same rng seed", () => {
    const sorted = [...roster];
    const pick = () =>
      pickStochasticGuardCandidate(sorted, {
        slot,
        roster,
        tracker,
        rules: DEFAULT_FAIRNESS_RULES,
        meanPrior: 0,
        rng: mulberry32(42),
      })?.name;
    expect(pick()).toBe(pick());
    expect(roster.some((p) => p.name === pick())).toBe(true);
  });

  it("can produce different picks for different seeds among similar candidates", () => {
    const sorted = [...roster];
    const picks = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const chosen = pickStochasticGuardCandidate(sorted, {
        slot,
        roster,
        tracker,
        rules: DEFAULT_FAIRNESS_RULES,
        meanPrior: 0,
        rng: mulberry32(seed),
      });
      if (chosen) picks.add(chosen.name);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
