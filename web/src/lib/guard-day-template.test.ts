import { describe, expect, it } from "vitest";
import {
  buildGuardDayPositions,
  buildPureFourHourShiftWindows,
  syncGuardShiftSlots,
} from "@/lib/guard-day-template";

describe("pure 4-hour guard grid", () => {
  it("does not split 16:00–20:00 into 1-hour segments", () => {
    const windows = buildPureFourHourShiftWindows("08:00", 1440, 4);
    const evening = windows.find(
      (w) => {
        const s = ((w.startMin % 1440) + 1440) % 1440;
        const e = ((w.endMin % 1440) + 1440) % 1440;
        return s === 16 * 60 && e === 20 * 60;
      },
    );
    expect(evening).toBeDefined();
    expect(evening!.endMin - evening!.startMin).toBe(240);
  });

  it("fixed positions share 4-hour slots (no 18/19 micro-splits)", () => {
    const positions = buildGuardDayPositions({
      boardStart: "08:00",
      shiftHours: 4,
      season: "summer",
    });
    const synced = syncGuardShiftSlots(positions, {
      boardStart: "08:00",
      shiftHours: 4,
      season: "summer",
    });
    const patrol = synced.find((p) => p.name === "פטל");
    const observer = synced.find((p) => p.name === "תצפיתן");
    expect(patrol).toBeDefined();
    expect(observer).toBeDefined();

    const patrolKeys = patrol!.slots.map((s) => `${s.start_time}-${s.end_time}`);
    expect(patrolKeys).toContain("16:00-20:00");
    expect(patrolKeys).not.toContain("18:00-19:00");
    expect(patrolKeys).not.toContain("19:00-20:00");
    expect(patrolKeys).not.toContain("20:00-22:00");

    const observerKeys = observer!.slots.map((s) => `${s.start_time}-${s.end_time}`);
    expect(observerKeys).toEqual(patrolKeys);
  });
});
