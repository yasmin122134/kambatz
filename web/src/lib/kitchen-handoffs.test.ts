import { describe, expect, it } from "vitest";
import { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
import { kitchenShiftHandoffs, kitchenShiftHandoffsFromSlots, kitchenShiftRosterViews, kitchenShiftRostersFromSlots } from "@/lib/kitchen-handoffs";
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

  it("merges multiple kitchen slots in the same shift window", () => {
    const positions = defaultKitchenDayPositions({ seatsPerShift: 2 });
    const [pos] = positions;
    const extra = {
      id: crypto.randomUUID(),
      name: "משמרות מטבch נוסף",
      kind: "kitchen" as const,
      slots: pos.slots.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
        start_time: s.start_time,
        end_time: s.end_time,
        seat_count: 2,
      })),
    };
    const mission = kitchenMission([["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]);
    mission.positions = [pos, extra];
    const slot0a = pos.slots[0].id;
    const slot0b = extra.slots[0].id;
    mission.assignments[slot0a] = ["A", "B"];
    mission.assignments[slot0b] = ["C", "D"];
    mission.assignments[pos.slots[1].id] = ["B", "C", "E", "F"];

    const rosters = kitchenShiftRostersFromSlots(flattenMissionSlots(mission, 0));
    expect(rosters[0].assignees.size).toBe(4);
    expect(rosters[0].seatCapacity).toBe(4);

    const handoffs = kitchenShiftHandoffs(mission);
    expect(handoffs[0].fromAssignedCount).toBe(4);
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

  it("lists roster names absent from each kitchen shift", () => {
    const mission = kitchenMission([
      ["Alice", "Bob", "Carl", "Dana"],
      ["Bob", "Carl", "Dana", "Eve"],
      ["Carl", "Dana", "Eve", "Frank"],
      ["Dana", "Eve", "Frank", "Grace"],
    ]);
    const roster = [
      "Alice",
      "Bob",
      "Carl",
      "Dana",
      "Eve",
      "Frank",
      "Grace",
      "Henry",
      "Iris",
    ];
    const views = kitchenShiftRosterViews(flattenMissionSlots(mission, 0), roster);
    expect(views).toHaveLength(4);
    expect(views[0].assignedCount).toBe(4);
    expect(views[0].absentNames).toEqual([
      "Eve",
      "Frank",
      "Grace",
      "Henry",
      "Iris",
    ]);
    expect(views[0].rosterSize).toBe(9);
    expect(views[0].absentNames).toHaveLength(9 - 4);
  });
});
