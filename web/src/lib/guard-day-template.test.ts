import { describe, expect, it } from "vitest";
import {
  buildGuardDayPositions,
  buildPureFourHourShiftWindows,
  mergeAdjacentGuardSlots,
  syncGuardShiftSlots,
} from "@/lib/guard-day-template";
import { resolveMissionPositions } from "@/lib/mission-templates";

describe("merge adjacent guard slots", () => {
  it("merges 06:00–08:00 + 08:00–09:00 when same seats and total ≤ 4h", () => {
    const merged = mergeAdjacentGuardSlots(
      [
        { id: "a", start_time: "06:00", end_time: "08:00", seat_count: 1 },
        { id: "b", start_time: "08:00", end_time: "09:00", seat_count: 1 },
      ],
      240,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].start_time).toBe("06:00");
    expect(merged[0].end_time).toBe("09:00");
    expect(merged[0].seat_count).toBe(1);
  });

  it("does not merge when seat counts differ", () => {
    const merged = mergeAdjacentGuardSlots(
      [
        { id: "a", start_time: "16:00", end_time: "18:00", seat_count: 1 },
        { id: "b", start_time: "18:00", end_time: "20:00", seat_count: 2 },
      ],
      240,
    );
    expect(merged).toHaveLength(2);
  });

  it("merges 18:00–19:00 + 19:00–22:00 when both have 2 seats", () => {
    const merged = mergeAdjacentGuardSlots(
      [
        { id: "a", start_time: "18:00", end_time: "19:00", seat_count: 2 },
        { id: "b", start_time: "19:00", end_time: "22:00", seat_count: 2 },
      ],
      240,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].start_time).toBe("18:00");
    expect(merged[0].end_time).toBe("22:00");
    expect(merged[0].seat_count).toBe(2);
  });
});

describe("pure 4-hour guard grid", () => {
  it("orders patrol slots from board_start, not midnight", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-15T20:00:00",
      missionEndsAt: "2026-01-16T20:00:00",
    });
    const patrol = positions.find((p) => p.name === "פטל");
    expect(patrol?.slots[0]?.start_time).toBe("20:00");
    expect(patrol?.slots[0]?.end_time).toBe("00:00");
  });

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

  it("merges short morning segments at grid boundary", () => {
    const windows = buildPureFourHourShiftWindows("06:00", 180, 4);
    const positions = buildGuardDayPositions({
      boardStart: "06:00",
      shiftHours: 4,
      missionStartsAt: "2026-01-01T06:00:00",
      missionEndsAt: "2026-01-01T09:00:00",
    });
    const patrol = positions.find((p) => p.name === "פטל");
    expect(patrol?.slots.some((s) => s.start_time === "06:00" && s.end_time === "09:00")).toBe(
      true,
    );
    expect(windows.map((w) => `${w.startMin}-${w.endMin}`)).toContain(`${6 * 60}-${8 * 60}`);
  });

  it("sync merges legacy 06–08 + 08–09 on foot patrol into one slot", () => {
    const positions = buildGuardDayPositions({
      boardStart: "06:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-01T06:00:00",
      missionEndsAt: "2026-01-01T09:00:00",
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    foot.slots = [
      { id: "legacy-a", start_time: "06:00", end_time: "08:00", seat_count: 1 },
      { id: "legacy-b", start_time: "08:00", end_time: "09:00", seat_count: 1 },
    ];
    const synced = syncGuardShiftSlots(positions, {
      boardStart: "06:00",
      shiftHours: 4,
      missionStartsAt: "2026-01-01T06:00:00",
      missionEndsAt: "2026-01-01T09:00:00",
    });
    const slots = synced.find((p) => p.name.includes("רגלי"))!.slots;
    expect(slots).toHaveLength(1);
    expect(slots[0].start_time).toBe("06:00");
    expect(slots[0].end_time).toBe("09:00");
    expect(slots[0].id).toBe("legacy-a");
  });

  it("resolve keeps custom positions and merges their slots", () => {
    const positions = buildGuardDayPositions({
      boardStart: "06:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-01T06:00:00",
      missionEndsAt: "2026-01-01T09:00:00",
    });
    positions.push({
      id: "radley",
      name: "ש״ג רדלי",
      kind: "guard",
      slots: [
        { id: "legacy-a", start_time: "06:00", end_time: "08:00", seat_count: 1 },
        { id: "legacy-b", start_time: "08:00", end_time: "09:00", seat_count: 1 },
      ],
    });
    const resolved = resolveMissionPositions({
      missionType: "guards",
      startsAt: "2026-01-01T06:00:00",
      endsAt: "2026-01-01T09:00:00",
      scheduling: { board_start: "06:00", shift_hours: 4, rest_hours: 7, guard_ratio: 2 },
      clientPositions: positions,
    });
    const radley = resolved.find((p) => p.name === "ש״ג רדלי");
    expect(radley).toBeDefined();
    expect(radley!.slots).toHaveLength(1);
    expect(radley!.slots[0].start_time).toBe("06:00");
    expect(radley!.slots[0].end_time).toBe("09:00");
  });

  it("sync merges legacy 18–19 + 19–22 splits into one 4h slot", () => {
    const positions = buildGuardDayPositions({
      boardStart: "18:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-01T18:00:00",
      missionEndsAt: "2026-01-01T22:00:00",
    });
    const front = positions.find((p) => p.name.includes("קדמי"))!;
    front.slots = [
      { id: "legacy-a", start_time: "18:00", end_time: "19:00", seat_count: 2 },
      { id: "legacy-b", start_time: "19:00", end_time: "22:00", seat_count: 2 },
    ];
    const synced = syncGuardShiftSlots(positions, {
      boardStart: "18:00",
      shiftHours: 4,
      missionStartsAt: "2026-01-01T18:00:00",
      missionEndsAt: "2026-01-01T22:00:00",
    });
    const slots = synced.find((p) => p.name.includes("קדמי"))!.slots;
    expect(slots).toHaveLength(1);
    expect(slots[0].start_time).toBe("18:00");
    expect(slots[0].end_time).toBe("22:00");
    expect(slots[0].id).toBe("legacy-a");
  });
});
