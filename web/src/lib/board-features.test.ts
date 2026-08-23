import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions, isBaseWorkPosition } from "@/lib/base-work-template";
import { computeHourlyAvailability } from "@/lib/hourly-availability";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

describe("base work positions", () => {
  it("includes עבודות בסיס with three daily windows", () => {
    const positions = defaultBaseWorkPositions();
    const baseWork = positions.find((p) => isBaseWorkPosition(p));
    expect(baseWork?.name).toBe("עבודות בסיס");
    expect(baseWork?.slots).toHaveLength(3);
  });
});

describe("computeHourlyAvailability", () => {
  const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES };

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

  it("excludes people on guard during that hour", () => {
    const mission: MissionDay = {
      id: "g1",
      title: "g",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:00:00+03:00",
      ends_at: "2026-08-22T08:00:00+03:00",
      status: "draft",
      positions: [
        {
          id: "p1",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "s1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
        },
      ],
      assignments: { s1: ["Alex"] },
      scheduling_rules: scheduling,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const people = [person("Alex"), person("Bob")];
    const rows = computeHourlyAvailability({
      missions: [mission],
      people,
      missionDate: "2026-08-21",
      boardStartMin: 8 * 60,
      stepMinutes: 60,
    });
    const hour08 = rows.find((r) => r.wallLabel === "08:00");
    expect(hour08?.names).toContain("Bob");
    expect(hour08?.names).not.toContain("Alex");
  });
});
