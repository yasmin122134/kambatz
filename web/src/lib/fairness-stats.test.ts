import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots, slotEatsRest } from "@/lib/mission-utils";
import { calculatePersonBurden } from "@/lib/guard-burden";
import {
  aggregateHistoryBurden,
  buildPersonFairnessStatsFromMissions,
  collectPersonBlocks,
  statsFromStoredHistory,
} from "@/lib/fairness-stats";
import { PATROL_GUARD_POINTS } from "@/lib/guard-burden";
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

  it("kitchen shift points scale by hours not flat per shift", () => {
    const slotId = "k1";
    const mission: MissionDay = {
      id: "kitchen-day",
      title: "מטבch",
      mission_type: "kitchen",
      mission_date: "2026-03-02",
      starts_at: "2026-03-02T06:00:00",
      ends_at: "2026-03-02T22:00:00",
      status: "published",
      positions: [
        {
          id: "pos1",
          name: "מטבch",
          kind: "kitchen",
          slots: [{ id: slotId, start_time: "06:00", end_time: "10:00", seat_count: 35 }],
        },
      ],
      assignments: { [slotId]: ["Alice"] },
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const stats = buildPersonFairnessStatsFromMissions(
      "Alice",
      [mission],
      DEFAULT_FAIRNESS_RULES,
    );
    const row = stats.history[0];
    expect(row.hours).toBe(4);
    expect(row.points).toBe(0.4);
    expect(stats.burden?.toranutPoints).toBe(0.4);
    expect(stats.burden?.guardPoints).toBe(0);
    expect(stats.periodPoints).toBe(0.4);
  });

  it("history sum always equals periodPoints (guard + patrol + rest)", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const guardSlot = slots.find((s) => s.positionKind === "guard" && s.seatCount === 1);
    const patrolSlot = slots.find((s) => s.positionKind === "patrol");
    expect(guardSlot).toBeDefined();
    expect(patrolSlot).toBeDefined();
    if (!guardSlot || !patrolSlot) return;

    const stats = buildPersonFairnessStatsFromMissions(
      "Dana",
      [
        {
          ...mission,
          assignments: {
            [guardSlot.slotId]: ["Dana"],
            [patrolSlot.slotId]: ["Dana"],
          },
        },
      ],
      DEFAULT_FAIRNESS_RULES,
    );

    const historySum = stats.history.reduce((sum, row) => sum + row.points, 0);
    expect(stats.periodPoints).toBe(Math.round(historySum * 100) / 100);
    expect(stats.burden?.fairnessPoints).toBe(stats.periodPoints);

    const patrolRow = stats.history.find((row) => row.slotId === patrolSlot.slotId);
    expect(patrolRow?.points).toBe(PATROL_GUARD_POINTS);

    const fromStored = statsFromStoredHistory(stats.history, DEFAULT_FAIRNESS_RULES, 0);
    expect(fromStored.periodPoints).toBe(stats.periodPoints);
    expect(fromStored.burden?.guardPoints).toBe(stats.burden?.guardPoints);
  });

  it("aggregateHistoryBurden splits kitchen from guard using bucket", () => {
    const burden = aggregateHistoryBurden([
      {
        id: "m1:g1:Bob",
        missionId: "m1",
        missionTitle: "שמירות",
        missionDate: "2026-03-01",
        missionType: "guards",
        positionName: "שער",
        timeLabel: "08:00–12:00",
        hours: 4,
        bucket: "solo",
        points: 4,
        burdenBase: 4,
      },
      {
        id: "m2:k1:Bob",
        missionId: "m2",
        missionTitle: "מטבch",
        missionDate: "2026-03-02",
        missionType: "kitchen",
        positionName: "מטבch",
        timeLabel: "06:00–10:00",
        hours: 4,
        bucket: "kitchen",
        points: 0.4,
      },
    ]);
    expect(burden.totalBurden).toBe(4.4);
    expect(burden.toranutPoints).toBe(0.4);
    expect(burden.guardPoints).toBe(4);
  });

  it("stored history totals match profile burden breakdown", () => {
    const history = [
      {
        id: "m1:s1:Alice",
        missionId: "m1",
        missionTitle: "מטבch",
        missionDate: "2026-03-02",
        missionType: "kitchen" as const,
        positionName: "מטבch",
        timeLabel: "06:00–10:00",
        hours: 4,
        bucket: "kitchen" as const,
        points: 0.4,
      },
    ];
    const stats = statsFromStoredHistory(history, DEFAULT_FAIRNESS_RULES, 0);
    expect(stats.periodPoints).toBe(0.4);
    expect(stats.burden?.toranutPoints).toBe(0.4);
    expect(stats.burden?.fairnessPoints).toBe(0.4);
  });

  it("history totals match calculatePersonBurden for pair guard and rest penalty", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const soloSlot = slots.find((s) => s.positionKind === "guard" && s.seatCount === 1);
    const pairSlot = slots.find((s) => s.positionKind === "guard" && s.seatCount === 2);
    expect(soloSlot).toBeDefined();
    expect(pairSlot).toBeDefined();
    if (!soloSlot || !pairSlot) return;

    const person = "Eli";
    const assigned = {
      ...mission,
      assignments: {
        [soloSlot.slotId]: [person],
        [pairSlot.slotId]: [person, "Other"],
      },
    };
    const stats = buildPersonFairnessStatsFromMissions(
      person,
      [assigned],
      DEFAULT_FAIRNESS_RULES,
    );
    const blocks = collectPersonBlocks(person, [assigned]);
    const live = calculatePersonBurden(blocks, DEFAULT_FAIRNESS_RULES);

    const historySum = stats.history.reduce((sum, row) => sum + row.points, 0);
    expect(Math.round(historySum * 100) / 100).toBe(live.totalBurden);
    expect(stats.periodPoints).toBe(live.totalBurden);
  });

  it("observation morning after same-day evening guard uses visible previous shift", () => {
    const mission = guardMission({});
    const slots = flattenMissionSlots(mission);
    const obs = slots.find(
      (s) => s.positionName.includes("תצפיתן") && s.timeLabel === "06:00–09:00",
    );
    const pat = slots.find(
      (s) => s.positionName.includes("פטל") && s.timeLabel === "17:00–21:00",
    );
    expect(obs).toBeDefined();
    expect(pat).toBeDefined();
    if (!obs || !pat) return;

    const stats = buildPersonFairnessStatsFromMissions(
      "Noam",
      [
        {
          ...mission,
          assignments: {
            [obs.slotId]: ["Noam"],
            [pat.slotId]: ["Noam"],
          },
        },
      ],
      DEFAULT_FAIRNESS_RULES,
    );

    const obsRow = stats.history.find((h) => h.slotId === obs.slotId);
    expect(obsRow?.burdenBase).toBe(1.8);
    expect(obsRow?.burdenRest).toBe(0.7);
    expect(obsRow?.points).toBe(2.5);
    expect(obsRow?.previousGuardLabel).toContain("פטל");
    expect(obsRow?.previousGuardLabel).toContain("17:00–21:00");
    expect(obsRow?.restHoursBefore).toBeCloseTo(9, 1);
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
