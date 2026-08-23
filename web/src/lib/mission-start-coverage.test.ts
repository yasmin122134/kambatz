import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const STARTS_AT = "2026-03-01T07:00:00.000Z";
const ENDS_AT = "2026-03-02T07:00:00.000Z";

function missionAt9(boardStart = "09:00"): MissionDay {
  const positions = buildGuardDayPositions({
    missionStartsAt: STARTS_AT,
    missionEndsAt: ENDS_AT,
    boardStart,
    shiftHours: 4,
  });
  return {
    id: "m",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: STARTS_AT,
    ends_at: ENDS_AT,
    status: "draft",
    positions,
    assignments: {},
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: boardStart },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("mission start coverage", () => {
  it("first slots anchor to mission start when board matches", () => {
    const mission = missionAt9();
    const foot = mission.positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time === "09:00")).toBe(true);
    expect(foot.slots.some((s) => s.start_time.endsWith(":15"))).toBe(false);

    const flat = flattenMissionSlots(mission);
    const guardAtMissionStart = flat.filter(
      (s) =>
        s.positionKind === "guard" &&
        s.startTime <= "09:00" &&
        s.endTime > "09:00",
    );
    expect(guardAtMissionStart.length).toBeGreaterThan(0);
  });

  it("covers mission start when board_start differs from mission start", () => {
    const mission = missionAt9("20:00");
    const foot = mission.positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time === "09:00")).toBe(true);
    expect(foot.slots.some((s) => s.start_time.endsWith(":15"))).toBe(false);

    const covering = flattenMissionSlots(mission).filter(
      (s) => s.positionKind === "guard" && s.startTime === "09:00",
    );
    expect(covering.length).toBeGreaterThan(0);
  });

  it("uses Israel wall labels when mission ISO is UTC", () => {
    const foot = missionAt9().positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time === "09:00")).toBe(true);
    expect(foot.slots.some((s) => s.start_time.endsWith(":15"))).toBe(false);
  });

  it("avoids :15 boundaries when mission starts at 06:00 foot-patrol window", () => {
    const positions = buildGuardDayPositions({
      missionStartsAt: "2026-08-21T06:00:00+03:00",
      missionEndsAt: "2026-08-22T06:00:00+03:00",
      boardStart: "06:00",
      shiftHours: 4,
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time.endsWith(":15"))).toBe(false);
    expect(foot.slots[0].start_time).toBe("06:00");
    expect(foot.slots.map((s) => `${s.start_time}-${s.end_time}`)).toEqual([
      "06:00-10:00",
      "10:00-14:00",
      "14:00-19:00",
    ]);
  });
});
