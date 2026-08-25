import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import { planLinkedBaseWorkConsolidation } from "@/lib/guard-day-bundle";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardsMission(
  overrides: Partial<MissionDay> & Pick<MissionDay, "assignments">,
): MissionDay {
  const [baseWork] = defaultBaseWorkPositions({ seatsPerShift: 15 });
  return {
    id: "guard-1",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T20:00:00+03:00",
    ends_at: "2026-08-22T20:00:00+03:00",
    status: "draft",
    positions: [
      { id: "reserve", name: "כוח עתודה", kind: "duty", slots: [] },
      baseWork,
    ],
    scheduling_rules: {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      linked_mission_id: "linked-abas",
    },
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("planLinkedBaseWorkConsolidation", () => {
  it("returns null when there is no linked mission", () => {
    const guards = guardsMission({
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
    });
    expect(planLinkedBaseWorkConsolidation(guards, null)).toBeNull();
  });

  it("does not backfill assignments from linked when embedded ABAS exists", () => {
    const guards = guardsMission({
      assignments: {},
    });
    const slotId = guards.positions.find((p) => p.name.includes("עבודות בסיס"))!.slots[0].id;
    guards.assignments[slotId] = [""];
    const linked: MissionDay = {
      id: "linked-abas",
      title: "עב״ס",
      mission_type: "base_work",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:30:00+03:00",
      ends_at: "2026-08-21T20:00:00+03:00",
      status: "draft",
      positions: defaultBaseWorkPositions(),
      assignments: { [slotId]: ["ישן", "ישן2", "ישן3"] },
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const plan = planLinkedBaseWorkConsolidation(guards, linked);
    expect(plan).not.toBeNull();
    expect(plan!.assignments[slotId]?.every((name) => !name)).toBe(true);
    expect(plan!.assignments[slotId]).not.toContain("ישן");
    expect(plan!.scheduling_rules.linked_mission_id).toBeUndefined();
    expect(plan!.deleteLinkedId).toBe("linked-abas");
  });

  it("merges linked positions when guards has no embedded ABAS yet", () => {
    const guards = guardsMission({
      positions: [{ id: "reserve", name: "כוח עתודה", kind: "duty", slots: [] }],
      assignments: {},
    });
    const linked: MissionDay = {
      id: "linked-abas",
      title: "עב״ס",
      mission_type: "base_work",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:30:00+03:00",
      ends_at: "2026-08-21T20:00:00+03:00",
      status: "draft",
      positions: defaultBaseWorkPositions(),
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const plan = planLinkedBaseWorkConsolidation(guards, linked);
    expect(plan!.positions.some((p) => p.name.includes("עבודות בסיס"))).toBe(true);
  });
});
