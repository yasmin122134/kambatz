import { describe, expect, it } from "vitest";
import { pickTypedDayMission, resolveBoardDate } from "@/lib/board-day-mission";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function mission(
  id: string,
  date: string,
  type: MissionDay["mission_type"],
  assignments: Record<string, string[]> = {},
): MissionDay {
  return {
    id,
    title: id,
    mission_type: type,
    mission_date: date,
    starts_at: `${date}T09:00:00`,
    ends_at: `${date}T09:00:00`,
    status: "draft",
    positions: [],
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("resolveBoardDate", () => {
  it("prefers the focused mission date over the earliest day on the board", () => {
    const missions = [
      mission("old", "2026-09-11", "guards"),
      mission("draft", "2026-09-16", "guards", { s1: ["Alex"] }),
    ];
    expect(resolveBoardDate(missions, "2026-09-11", "draft")).toBe("2026-09-16");
  });

  it("uses the URL date when there is no focus", () => {
    const missions = [
      mission("a", "2026-09-11", "guards"),
      mission("b", "2026-09-16", "guards"),
    ];
    expect(resolveBoardDate(missions, "2026-09-16")).toBe("2026-09-16");
  });
});

describe("pickTypedDayMission", () => {
  it("prefers the focused guards mission over an empty leftover on the same day", () => {
    const empty = mission("empty", "2026-09-16", "guards");
    const filled = mission("filled", "2026-09-16", "guards", { s1: ["Alex"] });
    expect(pickTypedDayMission([empty, filled], "guards", "filled")?.id).toBe("filled");
  });

  it("prefers the roster with names when there is no focus", () => {
    const empty = mission("empty", "2026-09-16", "guards");
    const filled = mission("filled", "2026-09-16", "guards", { s1: ["Alex"] });
    expect(pickTypedDayMission([empty, filled], "guards")?.id).toBe("filled");
  });
});
