import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  computeMissionEditorFairness,
  splitMissionsForEditorFairness,
} from "@/lib/mission-editor-fairness";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardDay(
  id: string,
  date: string,
  assignments: Record<string, string[]> = {},
  status: MissionDay["status"] = "published",
): MissionDay {
  const positions = buildGuardDayPositions({
    missionStartsAt: `${date}T09:00:00`,
    missionEndsAt: `${date}T09:00:00`,
    boardStart: "09:00",
    missionDate: date,
  });
  return {
    id,
    title: "שמירות",
    mission_type: "guards",
    mission_date: date,
    starts_at: `${date}T09:00:00`,
    ends_at: new Date(
      new Date(`${date}T09:00:00`).getTime() + 86_400_000,
    )
      .toISOString()
      .slice(0, 19),
    status,
    positions,
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("mission-editor-fairness", () => {
  it("splits history from current mission date", () => {
    const current = guardDay("current", "2026-08-26");
    const older = guardDay("old", "2026-08-20");
    const split = splitMissionsForEditorFairness([older, current], current);
    expect(split.historyMissions.map((m) => m.id)).toEqual(["old"]);
    expect(split.currentDayMissions.map((m) => m.id)).toEqual(["current"]);
  });

  it("computes separate history, current, and balanced columns", () => {
    const older = guardDay("old", "2026-08-20");
    const slots = flattenMissionSlots(older);
    const guardSlot = slots.find((s) => s.positionKind === "guard" && s.seatCount === 1);
    expect(guardSlot).toBeDefined();
    if (!guardSlot) return;
    older.assignments = { [guardSlot.slotId]: ["Alice"] };

    const current = guardDay("current", "2026-08-26", {}, "draft");
    const currentSlots = flattenMissionSlots(current);
    const patrol = currentSlots.find((s) => s.positionKind === "patrol");
    expect(patrol).toBeDefined();
    if (!patrol) return;
    current.assignments = { [patrol.slotId]: ["Alice"] };

    const result = computeMissionEditorFairness(
      [{ name: "Alice", prior_score: 0 }],
      [older],
      current,
      DEFAULT_FAIRNESS_RULES,
    );

    const row = result.rows[0];
    expect(row.historyGuardPoints).toBeGreaterThan(0);
    expect(row.currentPoints).toBeGreaterThan(0);
    expect(row.balancedTotal).toBeGreaterThanOrEqual(row.currentPoints);
  });
});
