import { describe, expect, it } from "vitest";
import {
  defaultBaseWorkPositions,
  ensureBaseWorkLeaders,
  getBaseWorkSlotLeader,
  withBaseWorkSlotLeader,
} from "@/lib/base-work-template";
import { emptyAssignments } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function baseWorkMission(extra: Record<string, string[]>): MissionDay {
  const positions = defaultBaseWorkPositions({ seatsPerShift: 3 });
  return {
    id: "m1",
    title: "עב״ס",
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T08:00:00+03:00",
    ends_at: "2026-08-27T08:00:00+03:00",
    status: "draft",
    positions,
    assignments: { ...emptyAssignments(positions), ...extra },
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function firstAbasSlotId(mission: MissionDay): string {
  return mission.positions[0].slots[0].id;
}

describe("base work slot leaders", () => {
  it("auto-picks first assignee as leader when missing", () => {
    const mission = baseWorkMission({});
    const slotId = firstAbasSlotId(mission);
    mission.assignments[slotId] = ["Alice", "Bob", ""];
    const next = ensureBaseWorkLeaders(mission);
    expect(getBaseWorkSlotLeader(next, slotId)).toBe("Alice");
  });

  it("withBaseWorkSlotLeader sets and reads leader", () => {
    const mission = baseWorkMission({});
    const slotId = firstAbasSlotId(mission);
    mission.assignments[slotId] = ["Alice", "Bob", "Carl"];
    const next = withBaseWorkSlotLeader(mission, slotId, "Bob");
    expect(getBaseWorkSlotLeader(next, slotId)).toBe("Bob");
  });

  it("drops leader when person is unassigned", () => {
    const mission = baseWorkMission({});
    const slotId = firstAbasSlotId(mission);
    mission.assignments[slotId] = ["Alice", "Bob", ""];
    let next = withBaseWorkSlotLeader(mission, slotId, "Bob");
    next = {
      ...next,
      assignments: { ...next.assignments, [slotId]: ["Alice", "", ""] },
    };
    next = ensureBaseWorkLeaders(next);
    expect(getBaseWorkSlotLeader(next, slotId)).toBe("Alice");
  });
});
