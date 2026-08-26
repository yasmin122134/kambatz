import { describe, expect, it } from "vitest";
import { guardShiftRosterViews } from "@/lib/guard-shift-roster";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardMission(
  slots: { id: string; start: string; end: string; seats?: number }[],
  assignments: Record<string, string[]>,
): MissionDay {
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T20:00:00+03:00",
    ends_at: "2026-08-27T20:00:00+03:00",
    status: "draft",
    positions: [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: s.id,
          start_time: s.start,
          end_time: s.end,
          seat_count: s.seats ?? 1,
        })),
      },
      {
        id: "p2",
        name: "תצפיתן",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: `t-${s.id}`,
          start_time: s.start,
          end_time: s.end,
          seat_count: 1,
        })),
      },
    ],
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("guardShiftRosterViews", () => {
  it("groups assignees by shift window sorted by time", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "20:00", end: "00:00" },
        { id: "s2", start: "00:00", end: "04:00" },
      ],
      {
        s1: ["Alice"],
        "t-s1": ["Bob"],
        s2: ["Carl"],
        "t-s2": ["Dana"],
      },
    );
    const views = guardShiftRosterViews(mission);
    expect(views).toHaveLength(2);
    expect(views[0]?.timeLabel).toBe("20:00–00:00");
    expect(views[0]?.allNames).toEqual(["Alice", "Bob"]);
    expect(views[0]?.positions.map((p) => p.positionName)).toEqual(["פטל", "תצפיתן"]);
    expect(views[1]?.allNames).toEqual(["Carl", "Dana"]);
  });

  it("ignores non-guard positions", () => {
    const mission = guardMission([{ id: "s1", start: "08:00", end: "12:00" }], {
      s1: ["Alice"],
      "t-s1": ["Bob"],
    });
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const views = guardShiftRosterViews(mission);
    expect(views).toHaveLength(1);
    expect(views[0]?.allNames).toEqual(["Alice", "Bob"]);
    expect(views[0]?.allNames).not.toContain("Reserve");
  });
});
