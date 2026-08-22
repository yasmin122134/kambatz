import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots, slotEatsRest } from "@/lib/mission-utils";
import {
  buildPersonFairnessStatsFromMissions,
  collectPersonBlocks,
} from "@/lib/fairness-stats";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardMission(assignments: Record<string, string[]>): MissionDay {
  const positions = buildGuardDayPositions({
    missionStartsAt: "2026-03-01T09:00:00",
    missionEndsAt: "2026-03-02T09:00:00",
    boardStart: "09:00",
  });
  return {
    id: "m1",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: "2026-03-01T09:00:00",
    ends_at: "2026-03-02T09:00:00",
    status: "published",
    positions,
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("fairness-stats", () => {
  it("uses guard time-band points (not solo/pair bucket rates) for guard slots", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find(
      (s) => s.positionKind === "guard" && s.seatCount === 1,
    );
    expect(guardSlot).toBeDefined();
    if (!guardSlot) return;

    const person = "אלice";
    const stats = buildPersonFairnessStatsFromMissions(
      person,
      [
        {
          ...mission,
          assignments: { [guardSlot.slotId]: [person] },
        },
      ],
      DEFAULT_FAIRNESS_RULES,
    );

    expect(stats.history).toHaveLength(1);
    expect(stats.history[0].burdenBase).toBeGreaterThan(0);
    expect(stats.history[0].points).toBe(stats.history[0].burdenBase);
    expect(stats.periodPoints).toBe(stats.history[0].points);
  });

  it("collectPersonBlocks respects reserve force not eating rest", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const reserveSlot = slots.find((s) => s.positionName.includes("עתודה"));
    expect(reserveSlot).toBeDefined();
    if (!reserveSlot) return;

    expect(slotEatsRest(reserveSlot)).toBe(false);
    const blocks = collectPersonBlocks("Bob", [
      { ...mission, assignments: { [reserveSlot.slotId]: ["Bob"] } },
    ]);
    expect(blocks[0].eatsRest).toBe(false);
  });
});
