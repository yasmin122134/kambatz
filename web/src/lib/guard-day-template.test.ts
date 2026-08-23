import { describe, expect, it } from "vitest";
import {
  buildGuardDayPositions,
  buildPureFourHourShiftWindows,
  mergeAdjacentGuardSlots,
  officerDutySlotsValid,
  syncGuardShiftSlots,
} from "@/lib/guard-day-template";
import { resolveMissionPositions } from "@/lib/mission-templates";

describe("officer duty half-mission shifts", () => {
  const startsAt = "2026-08-21T09:00:00+03:00";
  const endsAt = "2026-08-22T09:00:00+03:00";

  it("splits 09:00→09:00 mission into 09:00–21:00 and 21:00–09:00", () => {
    const positions = buildGuardDayPositions({
      boardStart: "09:00",
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
    });
    const officer = positions.find((p) => p.kind === "officer_duty")!;
    expect(officer.slots).toHaveLength(2);
    expect(officer.slots[0].start_time).toBe("09:00");
    expect(officer.slots[0].end_time).toBe("21:00");
    expect(officer.slots[1].start_time).toBe("21:00");
    expect(officer.slots[1].end_time).toBe("09:00");
    expect(officerDutySlotsValid(officer.slots, startsAt, endsAt)).toBe(true);
  });

  it("resync fixes stale officer windows to match mission span", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      missionStartsAt: "2026-08-21T20:00:00+03:00",
      missionEndsAt: "2026-08-22T20:00:00+03:00",
    });
    const officer = positions.find((p) => p.kind === "officer_duty")!;
    officer.slots = [
      { id: "old-a", start_time: "09:00", end_time: "21:00", seat_count: 1 },
      { id: "old-b", start_time: "21:00", end_time: "09:00", seat_count: 1 },
    ];
    const synced = syncGuardShiftSlots(positions, {
      boardStart: "20:00",
      missionStartsAt: "2026-08-21T20:00:00+03:00",
      missionEndsAt: "2026-08-22T20:00:00+03:00",
    });
    const next = synced.find((p) => p.kind === "officer_duty")!.slots;
    expect(next[0].start_time).toBe("20:00");
    expect(next[0].end_time).toBe("08:00");
    expect(next[1].start_time).toBe("08:00");
    expect(next[1].end_time).toBe("20:00");
    expect(next[0].id).toBe("old-a");
    expect(next[1].id).toBe("old-b");
  });
});

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
  });
});

describe("mission-relative guard grid", () => {
  it("orders patrol slots from mission start, not midnight", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-15T20:00:00+02:00",
      missionEndsAt: "2026-01-16T20:00:00+02:00",
    });
    const patrol = positions.find((p) => p.name === "פטל");
    expect(patrol?.slots.some((s) => s.start_time === "20:00")).toBe(true);
  });

  it("buildPureFourHourShiftWindows anchors to board start", () => {
    const windows = buildPureFourHourShiftWindows("13:30", 1440, 4);
    const first = windows[0];
    expect(first.startMin).toBe(13 * 60 + 30);
    expect(first.endMin - first.startMin).toBe(240);
  });

  it("foot patrol and front gate may have different slot boundaries", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-08-21T20:00:00",
      missionEndsAt: "2026-08-22T20:00:00",
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    const front = positions.find((p) => p.name.includes("קדמי"))!;
    const footKeys = foot.slots.map((s) => `${s.start_time}-${s.end_time}`);
    const frontKeys = front.slots.map((s) => `${s.start_time}-${s.end_time}`);
    expect(footKeys).not.toEqual(frontKeys);
    expect(foot.slots.every((s) => s.seat_count === 1)).toBe(true);
  });

  it("sync preserves slot ids when windows match", () => {
    const positions = buildGuardDayPositions({
      boardStart: "06:00",
      shiftHours: 4,
      season: "summer",
      missionStartsAt: "2026-01-01T06:00:00+02:00",
      missionEndsAt: "2026-01-01T09:00:00+02:00",
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    foot.slots = [
      { id: "legacy-a", start_time: "06:00", end_time: "09:00", seat_count: 1 },
    ];
    const synced = syncGuardShiftSlots(positions, {
      boardStart: "06:00",
      shiftHours: 4,
      missionStartsAt: "2026-01-01T06:00:00+02:00",
      missionEndsAt: "2026-01-01T09:00:00+02:00",
    });
    const slots = synced.find((p) => p.name.includes("רגלי"))!.slots;
    expect(slots).toHaveLength(1);
    expect(slots[0].id).toBe("legacy-a");
  });

  it("resolve keeps custom positions", () => {
    const positions = buildGuardDayPositions({
      boardStart: "06:00",
      shiftHours: 4,
      missionStartsAt: "2026-01-01T06:00:00",
      missionEndsAt: "2026-01-01T09:00:00",
    });
    positions.push({
      id: "radley",
      name: "ש״ג רדלי",
      kind: "guard",
      slots: [{ id: "legacy-a", start_time: "06:00", end_time: "09:00", seat_count: 1 }],
    });
    const resolved = resolveMissionPositions({
      missionType: "guards",
      startsAt: "2026-01-01T06:00:00",
      endsAt: "2026-01-01T09:00:00",
      scheduling: { board_start: "06:00", shift_hours: 4, rest_hours: 7, guard_ratio: 2 },
      clientPositions: positions,
      regenerateStructure: true,
    });
    expect(resolved.find((p) => p.name === "ש״ג רדלי")).toBeDefined();
  });
});
