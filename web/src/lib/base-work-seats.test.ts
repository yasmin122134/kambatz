import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions, syncBaseWorkSeatCounts } from "@/lib/base-work-template";
import { resolveMissionPositions } from "@/lib/mission-templates";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

describe("syncBaseWorkSeatCounts", () => {
  it("updates all ABAS slot seat_count from rules", () => {
    const positions = defaultBaseWorkPositions({ seatsPerShift: 14 });
    const synced = syncBaseWorkSeatCounts(positions, 20);
    expect(synced[0].slots.every((s) => s.seat_count === 20)).toBe(true);
  });

  it("resolveMissionPositions syncs seats without full regenerate", () => {
    const abas = defaultBaseWorkPositions({ seatsPerShift: 14 });
    const resolved = resolveMissionPositions({
      missionType: "guards",
      startsAt: "2026-01-01T20:00",
      endsAt: "2026-01-02T20:00",
      scheduling: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        base_work: { seats_per_shift: 20 },
      },
      clientPositions: abas,
      regenerateStructure: false,
    });
    expect(resolved[0].slots.every((s) => s.seat_count === 20)).toBe(true);
  });
});
