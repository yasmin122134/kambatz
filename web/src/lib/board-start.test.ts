import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import {
  effectiveBoardStartMin,
  flattenMissionSlots,
} from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

describe("effectiveBoardStartMin", () => {
  it("pulls board start earlier when base work begins at 08:30 before 09:00 guards", () => {
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T09:00:00+03:00",
      ends_at: "2026-08-22T09:00:00+03:00",
      status: "draft",
      positions: [
        ...defaultBaseWorkPositions(),
        {
          id: "g",
          name: "שער קדמי",
          kind: "guard",
          slots: [{ id: "s1", start_time: "09:00", end_time: "13:00", seat_count: 1 }],
        },
      ],
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "09:00" },
      notes: "",
      created_at: "",
      updated_at: "",
    };

    expect(effectiveBoardStartMin(mission)).toBe(8 * 60 + 30);

    const baseSlots = flattenMissionSlots(mission).filter(
      (s) => s.baseWorkShiftIndex !== undefined,
    );
    expect(baseSlots.map((s) => s.startTime)).toEqual(["08:30", "13:30", "18:30"]);
    expect(baseSlots[0].cyclicStart).toBe(0);
    expect(baseSlots[1].cyclicStart).toBeGreaterThan(baseSlots[0].cyclicStart);
    expect(baseSlots[2].cyclicStart).toBeGreaterThan(baseSlots[1].cyclicStart);
  });
});
