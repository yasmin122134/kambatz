import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { collectRosterWarnings } from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

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

describe("Carmel B + ABAS parallel warnings", () => {
  it("Aug 26 guard bundle — no overlap warnings when same people on carmel B and ABAS", () => {
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

    const slots = flattenMissionSlots(mission);
    const carmel = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const abas = slots.find(
      (s) => s.missionType === "base_work" && s.startTime === "08:30",
    )!;

    expect(carmel.missionType).toBe("guards");
    expect(abas.missionType).toBe("base_work");
    expect(abas.positionKind).toBe("duty");

    const names = ["Alex", "Bob", "Cal"];
    const assignments: Record<string, string[]> = {};
    for (const pos of positions) {
      for (const slot of pos.slots) {
        assignments[slot.id] = Array(slot.seat_count).fill("");
      }
    }
    assignments[carmel.slotId] = [...names];
    const abasSeats = Array(abas.seatCount).fill("");
    names.forEach((n, i) => {
      abasSeats[i] = n;
    });
    assignments[abas.slotId] = abasSeats;

    const peopleByName = Object.fromEntries(names.map((n) => [n, person(n)]));
    const warnings = collectRosterWarnings({
      missions: [{ ...mission, assignments }],
      peopleByName,
    });

    const overlapWarnings = warnings.filter((w) => w.includes("חפיפה"));
    expect(overlapWarnings).toEqual([]);
  });

  it("no overlap warning when ABAS is duty+guards but uses standard shift times", () => {
    const startsAt = "2026-08-26T20:00:00+03:00";
    const endsAt = "2026-08-27T20:00:00+03:00";
    const carmelSlot = {
      id: "carmel-b",
      start_time: "20:00",
      end_time: "20:00",
      seat_count: 3,
      starts_at: startsAt,
      ends_at: endsAt,
    };
    const abasSlot = {
      id: "abas-1",
      start_time: "08:30",
      end_time: "11:30",
      seat_count: 14,
    };
    const mission: MissionDay = {
      id: "g-legacy",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "p-carmel",
          name: "כרמל ב׳ (כוננות)",
          kind: "standby_carmel_b",
          same_room: true,
          same_gender: true,
          slots: [carmelSlot],
        },
        {
          id: "p-abas",
          name: "משמרת בוקר",
          kind: "duty",
          slots: [abasSlot],
        },
      ],
      assignments: {
        "carmel-b": ["Alex", "Bob", "Cal"],
        "abas-1": Array.from({ length: 14 }, (_, i) => (i < 3 ? ["Alex", "Bob", "Cal"][i] : "")),
      },
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const abasFlat = flattenMissionSlots(mission).find((s) => s.slotId === "abas-1")!;
    expect(abasFlat.missionType).toBe("base_work");

    const peopleByName = Object.fromEntries(
      ["Alex", "Bob", "Cal"].map((n) => [n, person(n)]),
    );
    const warnings = collectRosterWarnings({ missions: [mission], peopleByName });
    expect(warnings.filter((w) => w.includes("חפיפה"))).toEqual([]);
  });
});
