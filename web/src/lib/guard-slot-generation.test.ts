import { describe, expect, it } from "vitest";
import { generatePositionSlots, partitionInterval } from "@/lib/guard-slot-generation";
import {
  buildGuardDayPositions,
  footPatrolSlotsValid,
  rearVehicleSlotsValid,
} from "@/lib/guard-day-template";
import {
  FOOT_PATROL_STAFFING_SUMMER,
  getRequiredSeatsAtWallMinute,
  REAR_GATE_STAFFING_SUMMER,
} from "@/lib/staffing-profile";
import {
  fmtTimeLabel,
  intervalsOverlap,
  missionInterval,
  parseIsoMs,
} from "@/lib/time-interval";
import {
  buildTrackerFromMissions,
  fitsPerson,
  validateGeneratedRoster,
} from "@/lib/scheduling-engine";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function missionWindow(
  date: string,
  startHour: number,
  startMin = 0,
  durationHours = 24,
): { startsAt: string; endsAt: string } {
  const startsAt = `${date}T${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}:00`;
  const startMs = parseIsoMs(startsAt)!;
  const endsAt = new Date(startMs + durationHours * 3_600_000).toISOString();
  return { startsAt, endsAt };
}

const MISSION_STARTS = [
  { label: "20:00", ...missionWindow("2026-08-21", 20) },
  { label: "08:00", ...missionWindow("2026-08-21", 8) },
  { label: "13:00", ...missionWindow("2026-08-21", 13) },
  { label: "05:00", ...missionWindow("2026-08-21", 5) },
  { label: "17:30", ...missionWindow("2026-08-21", 17, 30) },
] as const;

function slotSeatsAtMid(
  slots: ReturnType<typeof generatePositionSlots>,
  profile: typeof REAR_GATE_STAFFING_SUMMER,
) {
  return slots.map((s) => {
    const mid = s.startMs + (s.endMs - s.startMs) / 2;
    const d = new Date(mid);
    const wall = d.getHours() * 60 + d.getMinutes();
    return {
      start: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      seats: s.requiredSeats,
      expected: getRequiredSeatsAtWallMinute(profile, wall),
    };
  });
}

describe("getRequiredSeatsAtWallMinute — rear gate boundaries", () => {
  it("returns correct seats at 06:00 and 18:00 boundaries", () => {
    expect(getRequiredSeatsAtWallMinute(REAR_GATE_STAFFING_SUMMER, 5 * 60 + 59)).toBe(2);
    expect(getRequiredSeatsAtWallMinute(REAR_GATE_STAFFING_SUMMER, 6 * 60)).toBe(1);
    expect(getRequiredSeatsAtWallMinute(REAR_GATE_STAFFING_SUMMER, 17 * 60 + 59)).toBe(1);
    expect(getRequiredSeatsAtWallMinute(REAR_GATE_STAFFING_SUMMER, 18 * 60)).toBe(2);
    expect(getRequiredSeatsAtWallMinute(REAR_GATE_STAFFING_SUMMER, 23 * 60)).toBe(2);
  });
});

describe("getRequiredSeatsAtWallMinute — foot patrol boundaries", () => {
  it("returns correct seats at 06:00 and 19:00 boundaries", () => {
    expect(getRequiredSeatsAtWallMinute(FOOT_PATROL_STAFFING_SUMMER, 5 * 60 + 59)).toBe(0);
    expect(getRequiredSeatsAtWallMinute(FOOT_PATROL_STAFFING_SUMMER, 6 * 60)).toBe(1);
    expect(getRequiredSeatsAtWallMinute(FOOT_PATROL_STAFFING_SUMMER, 18 * 60 + 59)).toBe(1);
    expect(getRequiredSeatsAtWallMinute(FOOT_PATROL_STAFFING_SUMMER, 19 * 60)).toBe(0);
    expect(getRequiredSeatsAtWallMinute(FOOT_PATROL_STAFFING_SUMMER, 2 * 60)).toBe(0);
  });
});

describe("intervalsOverlap", () => {
  const ms = (h: number, m = 0) => new Date(`2026-08-21T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();

  it("treats consecutive half-open intervals as non-overlapping", () => {
    expect(intervalsOverlap({ startMs: ms(8), endMs: ms(12) }, { startMs: ms(12), endMs: ms(16) })).toBe(false);
  });

  it("detects true overlap", () => {
    expect(intervalsOverlap({ startMs: ms(8), endMs: ms(12) }, { startMs: ms(11), endMs: ms(15) })).toBe(true);
  });

  it("handles cross-midnight intervals", () => {
    expect(intervalsOverlap({ startMs: ms(22), endMs: ms(2) + 86_400_000 }, { startMs: ms(23, 30), endMs: ms(3, 30) + 86_400_000 })).toBe(true);
  });
});

describe("rear gate slot generation", () => {
  for (const m of MISSION_STARTS) {
    it(`mission start ${m.label} — every slot has correct seat count`, () => {
      const interval = missionInterval(m.startsAt, m.endsAt)!;
      const slots = generatePositionSlots({
        missionStartMs: interval.startMs,
        missionEndMs: interval.endMs,
        nominalShiftDurationMin: 240,
        staffingProfile: REAR_GATE_STAFFING_SUMMER,
      });
      expect(slots.length).toBeGreaterThan(0);
      for (const row of slotSeatsAtMid(slots, REAR_GATE_STAFFING_SUMMER)) {
        expect(row.seats).toBe(row.expected);
      }
      expect(rearVehicleSlotsValid(
        slots.map((s) => ({
          id: "x",
          start_time: new Date(s.startMs).toTimeString().slice(0, 5),
          end_time: new Date(s.endMs).toTimeString().slice(0, 5),
          seat_count: s.requiredSeats,
        })),
        "06:00",
        "18:00",
        m.startsAt,
        m.endsAt,
      )).toBe(true);
    });
  }

  it("standard 20:00 mission produces expected rear-gate slots", () => {
    const { startsAt, endsAt } = missionWindow("2026-08-21", 20);
    const interval = missionInterval(startsAt, endsAt)!;
    const slots = generatePositionSlots({
      missionStartMs: interval.startMs,
      missionEndMs: interval.endMs,
      nominalShiftDurationMin: 240,
      staffingProfile: REAR_GATE_STAFFING_SUMMER,
    });
    const labels = slots.map(
      (s) => `${fmtTimeLabel(s.startMs)}–${fmtTimeLabel(s.endMs)}=${s.requiredSeats}`,
    );
    expect(labels[0]).toBe("20:00–00:00=2");
    expect(labels.some((l) => l.startsWith("06:00") && l.endsWith("=1"))).toBe(true);
    expect(labels.some((l) => l.startsWith("18:00") && l.endsWith("=2"))).toBe(true);
    expect(slots.length).toBeGreaterThanOrEqual(6);
  });
});

describe("foot patrol slot generation", () => {
  for (const m of MISSION_STARTS) {
    it(`mission start ${m.label} — no slots outside 06–19`, () => {
      const interval = missionInterval(m.startsAt, m.endsAt)!;
      const slots = generatePositionSlots({
        missionStartMs: interval.startMs,
        missionEndMs: interval.endMs,
        nominalShiftDurationMin: 240,
        staffingProfile: FOOT_PATROL_STAFFING_SUMMER,
      });
      expect(slots.every((s) => s.requiredSeats === 1)).toBe(true);
      for (const s of slots) {
        const mid = s.startMs + (s.endMs - s.startMs) / 2;
        const wall = new Date(mid).getHours() * 60 + new Date(mid).getMinutes();
        expect(wall).toBeGreaterThanOrEqual(6 * 60);
        expect(wall).toBeLessThan(19 * 60);
      }
    });
  }

  it("20:00 mission has no foot patrol slots between 20:00 and 06:00", () => {
    const { startsAt, endsAt } = missionWindow("2026-08-21", 20);
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      shiftHours: 4,
    });
    const foot = positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.length).toBeGreaterThan(0);
    expect(foot.slots.every((s) => s.seat_count === 1)).toBe(true);
    expect(footPatrolSlotsValid(foot.slots, "06:00", "19:00", startsAt, endsAt)).toBe(true);
  });
});

describe("multi-day mission (>24h)", () => {
  it("generates slots across 30 hours", () => {
    const startsAt = "2026-08-21T20:00:00";
    const endsAt = "2026-08-23T02:00:00";
    const interval = missionInterval(startsAt, endsAt)!;
    expect(interval.endMs - interval.startMs).toBe(30 * 3_600_000);
    const slots = generatePositionSlots({
      missionStartMs: interval.startMs,
      missionEndMs: interval.endMs,
      nominalShiftDurationMin: 240,
      staffingProfile: REAR_GATE_STAFFING_SUMMER,
    });
    expect(slots.length).toBeGreaterThan(6);
    expect(slots[0].startMs).toBe(interval.startMs);
    expect(slots[slots.length - 1].endMs).toBe(interval.endMs);
  });
});

describe("partitionInterval", () => {
  it("keeps a 5-hour block as one shift", () => {
    const start = parseIsoMs("2026-08-21T17:00:00")!;
    const end = start + 5 * 3_600_000;
    const parts = partitionInterval(start, end, 240);
    expect(parts).toHaveLength(1);
    expect(parts[0].endMs - parts[0].startMs).toBe(5 * 3_600_000);
  });
});

describe("cross-mission overlap rejection", () => {
  const person: Person = {
    id: "1",
    name: "Test Cadet",
    email: null,
    room: "1",
    gender: "m",
    active: true,
    km: false,
    exam: false,
    no_weapon: false,
    no_guard: false,
    no_mag: false,
    prior_score: 0,
    created_at: "",
  };

  function guardMission(assignments: Record<string, string[]>): MissionDay {
    const positions = buildGuardDayPositions({
      missionStartsAt: "2026-08-21T08:00:00",
      missionEndsAt: "2026-08-22T08:00:00",
      boardStart: "08:00",
    });
    const slots = flattenMissionSlots({
      id: "g1",
      title: "Guards",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:00:00",
      ends_at: "2026-08-22T08:00:00",
      status: "draft",
      positions,
      assignments,
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "08:00" },
      notes: null,
      created_at: "",
      updated_at: "",
    });
    return {
      id: "g1",
      title: "Guards",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:00:00",
      ends_at: "2026-08-22T08:00:00",
      status: "draft",
      positions,
      assignments,
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "08:00" },
      notes: null,
      created_at: "",
      updated_at: "",
    };
  }

  it("rejects base work 10–14 overlapping guard 12–16 for same person", () => {
    const baseMission: MissionDay = {
      id: "b1",
      title: "Base",
      mission_type: "base_work",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T08:00:00",
      ends_at: "2026-08-21T20:00:00",
      status: "draft",
      positions: [{
        id: "p1",
        name: "עב״ס",
        kind: "duty",
        slots: [{ id: "bs1", start_time: "10:00", end_time: "14:00", seat_count: 14 }],
      }],
      assignments: { bs1: Array(14).fill("").map((_, i) => (i === 0 ? "Test Cadet" : "")) },
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const guard = guardMission({});
    const patrol = guard.positions.find((p) => p.name === "פטל")!;
    const noonSlot = patrol.slots.find((s) => s.start_time === "12:00" && s.end_time === "16:00");
    expect(noonSlot).toBeDefined();

    const tracker = buildTrackerFromMissions([baseMission], DEFAULT_MISSION_SCHEDULING_RULES as never);
    const flatSlots = flattenMissionSlots(guard);
    const target = flatSlots.find((s) => s.slotId === noonSlot!.id)!;

    expect(
      fitsPerson(
        person,
        target,
        tracker,
        [],
        DEFAULT_MISSION_SCHEDULING_RULES,
        [],
        { [person.name]: person },
      ),
    ).toBe(false);

    const guardAssigned = { ...guard, assignments: { [noonSlot!.id]: ["Test Cadet"] } };
    const errors = validateGeneratedRoster({
      missions: [baseMission, guardAssigned],
      peopleByName: { [person.name]: person },
    });
    expect(errors.some((e) => e.includes("overlap") || e.includes("חפיפה"))).toBe(true);
  });
});
