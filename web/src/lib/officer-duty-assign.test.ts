import { describe, expect, it } from "vitest";
import { runGlobalAssign } from "@/lib/global-assign";
import { flattenMissionSlots, resolvePositionKind, slotEatsRest } from "@/lib/mission-utils";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import type { MissionDay, Person } from "@/lib/types";

describe("resolvePositionKind", () => {
  it("detects officer duty by position name when kind is missing", () => {
    expect(
      resolvePositionKind("guards", { id: "1", name: "קצין תורן", slots: [] }),
    ).toBe("officer_duty");
  });
});

describe("officer duty smart assign", () => {
  const officer = (name: string, opts?: Partial<Person>): Person => ({
    id: name,
    name,
    email: null,
    room: null,
    gender: null,
    active: true,
    is_officer: true,
    no_guard: name.includes("יסמין"),
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
    ...opts,
  });

  it("assigns both duty officers even when position kind is missing from DB", () => {
    const mission: MissionDay = {
      id: "m1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T09:00:00",
      ends_at: "2026-03-02T09:00:00",
      status: "draft",
      positions: [
        {
          id: "p-off",
          name: "קצין תורן",
          slots: [
            { id: "s1", start_time: "09:00", end_time: "09:00", seat_count: 2 },
          ],
        },
      ],
      assignments: { s1: ["", ""] },
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "09:00" },
      notes: "",
      created_at: "",
      updated_at: "",
    };

    const people: Person[] = [
      officer("רני פלג"),
      officer("יסמין חדד", { no_guard: true }),
      {
        id: "c1",
        name: "צוער א",
        email: null,
        room: "1",
        gender: "m",
        active: true,
        no_guard: false,
        no_standby: false,
        no_standing: false,
        no_base_work: false,
        no_kitchen: false,
        prior_score: 0,
        created_at: "",
      },
    ];

    const out = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });

    const seats = out.assignmentsByMission.get("m1")!;
    const assigned = (seats.s1 || []).filter(Boolean);
    expect(assigned).toHaveLength(2);
    expect(assigned).toContain("רני פלג");
    expect(assigned).toContain("יסמין חדד");
  });

  it("does not treat full-day officer duty as a rest-consuming guard", () => {
    const mission: MissionDay = {
      id: "m1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T09:00:00",
      ends_at: "2026-03-02T09:00:00",
      status: "draft",
      positions: [
        {
          id: "p-off",
          name: "קצין תורן",
          kind: "officer_duty",
          slots: [
            { id: "s1", start_time: "09:00", end_time: "09:00", seat_count: 2 },
          ],
        },
      ],
      assignments: { s1: ["רני פלג", "יסמין חדד"] },
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, rest_hours: 8 },
      notes: "",
      created_at: "",
      updated_at: "",
    };
    const slot = flattenMissionSlots(mission).find((s) => s.positionKind === "officer_duty")!;
    expect(slotEatsRest(slot)).toBe(false);
    expect(slot.durationMinutes).toBeGreaterThanOrEqual(24 * 60);
  });
});
