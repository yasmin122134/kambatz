import { describe, expect, it } from "vitest";
import { filterPublishedMissionDays } from "@/lib/missions";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function mission(id: string, status: MissionDay["status"]): MissionDay {
  return {
    id,
    title: id,
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T09:00:00",
    ends_at: "2026-08-27T09:00:00",
    status,
    positions: [],
    assignments: {},
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("mission visibility helpers", () => {
  it("filterPublishedMissionDays keeps published only", () => {
    const rows = filterPublishedMissionDays([
      mission("pub", "published"),
      mission("draft", "draft"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["pub"]);
  });
});
