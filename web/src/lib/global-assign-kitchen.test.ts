import { describe, expect, it } from "vitest";
import { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
import { runGlobalAssign } from "@/lib/global-assign";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  kitchenShiftsOnMission,
  MAX_KITCHEN_SHIFTS_PER_DAY,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(id: string, name: string, squad: number): Person {
  return {
    id,
    name,
    email: null,
    squad,
    room: `10${squad}`,
    gender: squad % 2 === 0 ? "f" : "m",
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

describe("kitchen smart assign", () => {
  it("spreads kitchen shifts so nobody works all 4 and eligible people get shifts", () => {
    const positions = defaultKitchenDayPositions({ seatsPerShift: 3 });
    const mission: MissionDay = {
      id: "kitchen-1",
      title: "מטבch",
      mission_type: "kitchen",
      mission_date: "2026-08-26",
      starts_at: "2026-08-26T06:00:00+03:00",
      ends_at: "2026-08-26T22:00:00+03:00",
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        kitchen: {
          ...DEFAULT_MISSION_SCHEDULING_RULES.kitchen!,
          seats_per_shift: 3,
          squad_rest_by_shift: [1, 2, 3, 4],
        },
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const people = Array.from({ length: 12 }, (_, i) =>
      person(`p${i}`, `cadet-${i + 1}`, (i % 4) + 1),
    );

    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });

    const assignments = output.assignmentsByMission.get(mission.id)!;
    const shiftCounts = new Map<string, number>();
    for (const slot of flattenMissionSlots(mission)) {
      for (const name of assignments[slot.slotId] || []) {
        if (!name) continue;
        shiftCounts.set(name, (shiftCounts.get(name) || 0) + 1);
      }
    }

    for (const p of people) {
      const count = shiftCounts.get(p.name) || 0;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(MAX_KITCHEN_SHIFTS_PER_DAY);
      expect(kitchenShiftsOnMission(p.name, { busy: {}, guardShifts: {}, periodPoints: {}, kitchenPoints: {}, dutyPoints: {} }, mission.id)).toBe(0);
    }

    const totalAssigned = [...shiftCounts.values()].reduce((a, b) => a + b, 0);
    expect(totalAssigned).toBe(3 * 4);
    expect(output.filled).toBeGreaterThanOrEqual(totalAssigned);
  });
});
