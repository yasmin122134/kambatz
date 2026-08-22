import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function missionAt9(): MissionDay {
  const startsAt = "2026-03-01T09:00:00";
  const endsAt = "2026-03-02T09:00:00";
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "09:00",
    shiftHours: 4,
  });
  return {
    id: "m",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments: {},
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "09:00" },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("mission start coverage", () => {
  it("first slots anchor to mission start when board matches", () => {
    const mission = missionAt9();
    const foot = mission.positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots[0]?.start_time).toBe("09:00");
    expect(foot.slots.some((s) => s.start_time === "09:15")).toBe(false);

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
    const startsAt = "2026-03-01T09:00:00";
    const endsAt = "2026-03-02T09:00:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "20:00",
      shiftHours: 4,
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time === "09:00")).toBe(true);
    expect(foot.slots.some((s) => s.start_time === "09:15")).toBe(false);

    const mission: MissionDay = {
      id: "m",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "20:00" },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const covering = flattenMissionSlots(mission).filter(
      (s) => s.positionKind === "guard" && s.startTime === "09:00",
    );
    expect(covering.length).toBeGreaterThan(0);
  });

  it("uses Israel wall labels when mission ISO is UTC (9:00 Israel = 07:00Z)", () => {
    const startsAt = "2026-03-01T07:00:00.000Z";
    const endsAt = "2026-03-02T07:00:00.000Z";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "09:00",
      shiftHours: 4,
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots[0]?.start_time).toBe("09:00");
    expect(foot.slots.some((s) => s.start_time.endsWith(":15"))).toBe(false);
  });
});
