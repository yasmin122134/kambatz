import { describe, expect, it } from "vitest";
import { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
import { kitchenShiftHandoffs, kitchenShiftHandoffsFromSlots } from "@/lib/kitchen-handoffs";
import { emptyAssignments, flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function kitchenMission(assignmentsByShift: string[][]): MissionDay {
  const positions = defaultKitchenDayPositions({ seatsPerShift: 4 });
  const slotIds = positions[0].slots.map((s) => s.id);
  const assignments = emptyAssignments(positions);
  slotIds.forEach((slotId, i) => {
    assignments[slotId] = assignmentsByShift[i] ?? [];
  });

  return {
    id: "kitchen-1",
    title: "מטבח",
    mission_type: "kitchen",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T06:00:00+03:00",
    ends_at: "2026-08-26T22:00:00+03:00",
    status: "published",
    positions,
    assignments,
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("kitchenShiftHandoffs", () => {
  it("lists leaving and entering between consecutive shifts", () => {
    const mission = kitchenMission([
      ["Alice", "Bob", "Carl", "Dana"],
      ["Bob", "Carl", "Dana", "Eve"],
      ["Carl", "Dana", "Eve", "Frank"],
      ["Dana", "Eve", "Frank", "Grace"],
    ]);

    const handoffs = kitchenShiftHandoffs(mission);
    expect(handoffs).toHaveLength(3);

    expect(handoffs[0].boundaryTime).toBe("10:00");
    expect(handoffs[0].leaving).toEqual(["Alice"]);
    expect(handoffs[0].entering).toEqual(["Eve"]);
    expect(handoffs[0].stayingCount).toBe(3);

    expect(handoffs[1].leaving).toEqual(["Bob"]);
    expect(handoffs[1].entering).toEqual(["Frank"]);
  });

  it("reports no change when roster is identical", () => {
    const roster = ["Alice", "Bob", "Carl"];
    const mission = kitchenMission([roster, roster, roster, roster]);
    const handoffs = kitchenShiftHandoffs(mission);
    expect(handoffs.every((h) => h.leaving.length === 0 && h.entering.length === 0)).toBe(
      true,
    );
  });

  it("sorts kitchen slots by time, not insertion index", () => {
    const mission = kitchenMission([
      ["A"],
      ["B"],
      ["C"],
      ["D"],
    ]);
    const slots = flattenMissionSlots(mission, 0).reverse();
    const handoffs = kitchenShiftHandoffsFromSlots(slots);
    expect(handoffs[0].leaving).toEqual(["A"]);
    expect(handoffs[0].entering).toEqual(["B"]);
  });
});
