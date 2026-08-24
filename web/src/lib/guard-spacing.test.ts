import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  buildTrackerFromMissions,
  fitsPerson,
  stripGuardSpacingViolations,
} from "@/lib/scheduling-engine";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
} from "@/lib/types";

function person(name: string): Person {
  return {
    id: name,
    name,
    email: null,
    room: "101",
    gender: "m",
    squad: 1,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
  };
}

describe("guard spacing 2:1", () => {
  it("rejects consecutive guard shifts on wall clock (Aug 26 board)", () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g1",
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

    const slots = flattenMissionSlots(mission).filter((s) => s.positionKind === "guard");
    const yamach = slots.filter((s) => s.positionName.includes("ימ״ח"));
    const first = yamach.find((s) => s.startTime === "08:00" && s.endTime === "12:00");
    const second = yamach.find((s) => s.startTime === "12:00" && s.endTime === "16:00");
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const assignments: Record<string, string[]> = {};
    for (const pos of positions) {
      for (const slot of pos.slots) {
        assignments[slot.id] = Array(slot.seat_count).fill("");
      }
    }
    assignments[first!.slotId] = ["Alex"];
    const tracker = buildTrackerFromMissions(
      [{ ...mission, assignments }],
      DEFAULT_FAIRNESS_RULES,
    );
    const peopleByName = { Alex: person("Alex") };

    expect(
      fitsPerson(
        peopleByName.Alex,
        second!,
        tracker,
        [],
        DEFAULT_MISSION_SCHEDULING_RULES,
        [],
        peopleByName,
      ),
    ).toBe(false);
  });

  it("stripGuardSpacingViolations removes back-to-back guard assignments", () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g1",
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

    const slots = flattenMissionSlots(mission).filter((s) => s.positionName.includes("ימ״ח"));
    const a = slots.find((s) => s.startTime === "08:00" && s.endTime === "12:00")!;
    const b = slots.find((s) => s.startTime === "12:00" && s.endTime === "16:00")!;

    const assignments: Record<string, string[]> = {};
    for (const pos of positions) {
      for (const slot of pos.slots) {
        assignments[slot.id] = Array(slot.seat_count).fill("");
      }
    }
    assignments[a.slotId] = ["Alex"];
    assignments[b.slotId] = ["Alex"];

    const { assignments: cleaned, removed } = stripGuardSpacingViolations({
      mission,
      assignments,
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
      rules: DEFAULT_FAIRNESS_RULES,
    });

    expect(removed).toBe(1);
    const filled = (cleaned[a.slotId]?.[0] ? 1 : 0) + (cleaned[b.slotId]?.[0] ? 1 : 0);
    expect(filled).toBe(1);
  });
});
