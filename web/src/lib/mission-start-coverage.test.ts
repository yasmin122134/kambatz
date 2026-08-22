import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { fmtTimeLabel, missionInterval } from "@/lib/time-interval";
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
  it("debug 9:00 mission slot times", () => {
    const mission = missionAt9();
    const interval = missionInterval(mission.starts_at, mission.ends_at)!;
    const foot = mission.positions.find((p) => p.name.includes("רגלי"))!;
    const patrol = mission.positions.find((p) => p.name === "פטל")!;
    const flat = flattenMissionSlots(mission);

    console.log("mission start", fmtTimeLabel(interval.startMs));
    console.log("foot slots", foot.slots.map((s) => `${s.start_time}–${s.end_time}`));
    console.log("patrol slots", patrol.slots.slice(0, 5).map((s) => `${s.start_time}–${s.end_time}`));
    console.log(
      "first flat guard slots",
      flat
        .filter((s) => s.positionKind === "guard")
        .slice(0, 8)
        .map((s) => `${s.positionName} ${s.timeLabel}`),
    );

    expect(foot.slots[0]?.start_time).toBe("09:00");
    expect(foot.slots.some((s) => s.start_time === "09:15")).toBe(false);

    const guardAtMissionStart = flat.filter(
      (s) =>
        s.positionKind === "guard" &&
        s.startTime <= "09:00" &&
        s.endTime > "09:00",
    );
    expect(guardAtMissionStart.length).toBeGreaterThan(0);
  });
});
