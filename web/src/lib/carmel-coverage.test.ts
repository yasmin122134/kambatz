import { describe, expect, it } from "vitest";
import { punchCarmelCoverageHole } from "@/lib/carmel-coverage";
import { carmelSlotFromMission } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { fmtMissionTimeLabel } from "@/lib/time-interval";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function carmelMission(): MissionDay {
  const startsAt = "2026-08-26T20:00:00+03:00";
  const endsAt = "2026-08-27T20:00:00+03:00";
  const carmelA = carmelSlotFromMission(startsAt, endsAt, "20:00", 3);
  carmelA.id = "ca1";
  const carmelB = carmelSlotFromMission(startsAt, endsAt, "20:00", 3);
  carmelB.id = "cb1";
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions: [
      {
        id: "pa",
        name: "כרמל א׳ (כוננות)",
        kind: "standby_carmel_a",
        same_room: true,
        same_gender: true,
        slots: [carmelA],
      },
      {
        id: "pb",
        name: "כרמל ב׳ (כוננות)",
        kind: "standby_carmel_b",
        same_room: true,
        same_gender: true,
        slots: [carmelB],
      },
      {
        id: "pg",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: [{ id: "g1s", start_time: "20:00", end_time: "00:00", seat_count: 1 }],
      },
    ],
    assignments: {
      ca1: ["Ada", "Ben", "Cal"],
      cb1: ["Dana", "Eve", "Fay"],
      g1s: ["Gil"],
    },
    locked_seats: { ca1: [true, false, false] },
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("punchCarmelCoverageHole", () => {
  it("splits Carmel A and B around the hole and copies assignees", () => {
    const result = punchCarmelCoverageHole(carmelMission(), "08:00", "12:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const aSlots = result.mission.positions.find((p) => p.id === "pa")?.slots ?? [];
    const bSlots = result.mission.positions.find((p) => p.id === "pb")?.slots ?? [];
    expect(aSlots).toHaveLength(2);
    expect(bSlots).toHaveLength(2);
    expect(aSlots.map((s) => `${s.start_time}–${s.end_time}`)).toEqual([
      "20:00–08:00",
      "12:00–20:00",
    ]);
    expect(aSlots[0]?.id).toBe("ca1");
    expect(aSlots[1]?.id).not.toBe("ca1");
    expect(result.mission.assignments.ca1).toEqual(["Ada", "Ben", "Cal"]);
    expect(result.mission.assignments[aSlots[1]!.id]).toEqual(["Ada", "Ben", "Cal"]);
    expect(result.mission.assignments[bSlots[1]!.id]).toEqual(["Dana", "Eve", "Fay"]);
    expect(result.mission.locked_seats?.[aSlots[1]!.id]).toEqual([true, false, false]);
    expect(result.mission.assignments.g1s).toEqual(["Gil"]);

    const flat = flattenMissionSlots(result.mission);
    const holeStart = Date.parse("2026-08-27T08:00:00+03:00");
    const holeEnd = Date.parse("2026-08-27T12:00:00+03:00");
    const carmel = flat.filter((s) => s.positionKind === "standby_carmel_a");
    expect(carmel.every((s) => s.endAtMs <= holeStart || s.startAtMs >= holeEnd)).toBe(true);
    expect(fmtMissionTimeLabel(carmel[0]!.endAtMs)).toBe("08:00");
    expect(fmtMissionTimeLabel(carmel[1]!.startAtMs)).toBe("12:00");
  });

  it("clips a hole at the start of coverage", () => {
    const result = punchCarmelCoverageHole(carmelMission(), "20:00", "22:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const aSlots = result.mission.positions.find((p) => p.id === "pa")?.slots ?? [];
    expect(aSlots).toHaveLength(1);
    expect(aSlots[0]?.id).toBe("ca1");
    expect(`${aSlots[0]?.start_time}–${aSlots[0]?.end_time}`).toBe("22:00–20:00");
    expect(result.mission.assignments.ca1).toEqual(["Ada", "Ben", "Cal"]);
  });

  it("rejects a hole that removes all Carmel coverage", () => {
    const mission = carmelMission();
    mission.starts_at = "2026-08-26T08:00:00+03:00";
    mission.ends_at = "2026-08-26T12:00:00+03:00";
    const slotA = mission.positions[0]!.slots[0]!;
    slotA.start_time = "08:00";
    slotA.end_time = "12:00";
    delete slotA.starts_at;
    delete slotA.ends_at;
    const slotB = mission.positions[1]!.slots[0]!;
    slotB.start_time = "08:00";
    slotB.end_time = "12:00";
    delete slotB.starts_at;
    delete slotB.ends_at;
    const result = punchCarmelCoverageHole(mission, "08:00", "12:00");
    expect(result).toEqual({
      ok: false,
      error: "הטווח מכסה את כל כוננות כרמל — השאירו לפחות מקטע אחד",
    });
  });

  it("rejects a range that does not overlap Carmel", () => {
    const mission = carmelMission();
    const first = punchCarmelCoverageHole(mission, "08:00", "12:00");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = punchCarmelCoverageHole(first.mission, "08:30", "11:30");
    expect(second).toEqual({ ok: false, error: "אין כיסוי כרמל בטווח השעות הזה" });
  });

  it("leaves guard slots untouched", () => {
    const result = punchCarmelCoverageHole(carmelMission(), "21:00", "01:00");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const guard = result.mission.positions.find((p) => p.id === "pg")?.slots[0];
    expect(guard).toMatchObject({ id: "g1s", start_time: "20:00", end_time: "00:00" });
  });
});
