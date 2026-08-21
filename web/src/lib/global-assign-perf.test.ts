import { describe, expect, it } from "vitest";
import { runGlobalAssign } from "@/lib/global-assign";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(name: string, room: string, squad: number): Person {
  return {
    id: name,
    name,
    email: null,
    room,
    gender: squad % 2 === 0 ? "f" : "m",
    squad,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: squad,
    created_at: "",
  };
}

describe("global assign performance", () => {
  it(
    "finishes a full guard day within 15s",
    () => {
    const startsAt = "2026-08-21T09:00:00+03:00";
    const endsAt = "2026-08-22T09:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "09:00",
    });
    const mission: MissionDay = {
      id: "g-perf",
      title: "perf",
      mission_type: "guards",
      mission_date: "2026-08-21",
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

    const people: Person[] = [];
    for (let squad = 1; squad <= 6; squad++) {
      for (let i = 1; i <= 8; i++) {
        people.push(person(`s${squad}-${i}`, `room-${squad}`, squad));
      }
    }

    const required = flattenMissionSlots(mission).reduce((s, sl) => s + sl.seatCount, 0);
    expect(required).toBeGreaterThan(20);

    const t0 = Date.now();
    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
      deadlineMs: 14_000,
    });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(15_000);
    expect(output.filled).toBeGreaterThan(0);
    expect(output.objectiveSummary.searchNodes).toBeLessThanOrEqual(15_000);
  },
  20_000,
  );
});
