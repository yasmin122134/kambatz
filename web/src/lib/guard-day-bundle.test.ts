import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import {
  missionsForDateAssignScope,
  omitLegacyLinkedBaseWorkMissions,
  planLinkedBaseWorkConsolidation,
} from "@/lib/guard-day-bundle";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardsMission(
  overrides: Partial<MissionDay> & Pick<MissionDay, "assignments">,
): MissionDay {
  const [baseWork] = defaultBaseWorkPositions({ seatsPerShift: 20 });
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

describe("missionsForDateAssignScope", () => {
  it("includes draft missions that the board is focusing", () => {
    const draft = guardsMission({
      id: "draft-1",
      status: "draft",
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
    });
    const publishedKitchen: MissionDay = {
      id: "k1",
      title: "מטבח",
      mission_type: "kitchen",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T06:00:00+03:00",
      ends_at: "2026-08-21T18:00:00+03:00",
      status: "published",
      positions: [],
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const otherDay = guardsMission({
      id: "g-other",
      mission_date: "2026-08-22",
      status: "published",
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
    });

    const scope = missionsForDateAssignScope(
      [draft, publishedKitchen, otherDay],
      "2026-08-21",
    );
    expect(scope.map((m) => m.id).sort()).toEqual(["draft-1", "k1"]);
  });

  it("omits leftover linked base_work once ABAS is embedded in guards", () => {
    const guards = guardsMission({ assignments: {} });
    const linked: MissionDay = {
      id: "linked-abas",
      title: "עב״ס",
      mission_type: "base_work",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:30:00+03:00",
      ends_at: "2026-08-21T20:00:00+03:00",
      status: "published",
      positions: defaultBaseWorkPositions(),
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    expect(omitLegacyLinkedBaseWorkMissions([guards, linked]).map((m) => m.id)).toEqual([
      "guard-1",
    ]);
    expect(missionsForDateAssignScope([guards, linked], "2026-08-21").map((m) => m.id)).toEqual([
      "guard-1",
    ]);
  });

  it("keeps a standalone base_work mission when guards has no embedded ABAS", () => {
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
      status: "published",
      positions: defaultBaseWorkPositions(),
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    expect(missionsForDateAssignScope([guards, linked], "2026-08-21").map((m) => m.id)).toEqual([
      "guard-1",
      "linked-abas",
    ]);
  });
});
