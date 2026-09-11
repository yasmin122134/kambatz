import { describe, expect, it } from "vitest";
import { countDistinctMissionDates, missionDayScopeLabel } from "@/lib/mission-scope";
import type { MissionDay } from "@/lib/types";

function mission(date: string): MissionDay {
  return {
    id: date,
    mission_date: date,
    mission_type: "guards",
    title: "",
    starts_at: "",
    ends_at: "",
    status: "published",
    positions: [],
    assignments: {},
  } as unknown as MissionDay;
}

describe("countDistinctMissionDates", () => {
  it("counts unique dates across multiple mission records", () => {
    expect(
      countDistinctMissionDates([
        mission("2026-09-01"),
        mission("2026-09-01"),
        mission("2026-09-02"),
      ]),
    ).toBe(2);
  });

  it("labels singular and plural", () => {
    expect(missionDayScopeLabel(0)).toContain("אין");
    expect(missionDayScopeLabel(1)).toContain("אחד");
    expect(missionDayScopeLabel(5)).toBe("מבוסס על 5 ימי משימה");
  });
});
