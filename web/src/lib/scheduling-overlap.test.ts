import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  assignBaseWorkShift,
  assignmentIntervalsOverlap,
  buildTrackerFromMissions,
  fitsPerson,
  placePerson,
  validateGeneratedRoster,
  validateNoPersonOverlaps,
  explainFitsPersonFailure,
  assignmentNeedsSpacingGap,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES };

function person(name: string, squad: number): Person {
  return {
    id: name,
    name,
    email: null,
    room: `${squad}`,
    gender: "m",
    squad,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
  };
}

function makePeople(count: number): Person[] {
  return Array.from({ length: count }, (_, i) => person(`Cadet ${i + 1}`, (i % 4) + 1));
}

function missionDay(
  id: string,
  mission_type: MissionDay["mission_type"],
  positions: MissionDay["positions"],
  assignments: Record<string, string[]>,
  starts_at: string,
  ends_at: string,
): MissionDay {
  return {
    id,
    title: id,
    mission_type,
    mission_date: starts_at.slice(0, 10),
    starts_at,
    ends_at,
    status: "draft",
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function slotByLabel(mission: MissionDay, label: string) {
  const slot = flattenMissionSlots(mission).find((s) => s.timeLabel === label);
  if (!slot) throw new Error(`Missing slot ${label}`);
  return slot;
}

function guardBundleMission(startsAt: string, endsAt: string): MissionDay {
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: startsAt.slice(11, 16),
  });
  const assignments: Record<string, string[]> = {};
  for (const pos of positions) {
    for (const slot of pos.slots) {
      assignments[slot.id] = Array.from({ length: slot.seat_count }, () => "");
    }
  }
  return missionDay("guard-1", "guards", positions, assignments, startsAt, endsAt);
}

function carmelBSlot(mission: MissionDay) {
  return flattenMissionSlots(mission).find((s) => s.positionKind === "standby_carmel_b")!;
}

function reserveForceSlot(mission: MissionDay) {
  return flattenMissionSlots(mission).find((s) => s.positionName.includes("עתודה"))!;
}

function withCustomSlotTimes(
  mission: MissionDay,
  slotId: string,
  start: string,
  end: string,
): MissionDay {
  const positions = mission.positions.map((pos) => ({
    ...pos,
    slots: pos.slots.map((slot) =>
      slot.id === slotId
        ? { ...slot, start_time: start, end_time: end, starts_at: undefined, ends_at: undefined }
        : slot,
    ),
  }));
  return { ...mission, positions };
}

describe("assignmentIntervalsOverlap", () => {
  const ms = (t: string) => new Date(`2026-08-21T${t}:00`).getTime();

  it("allows consecutive half-open intervals", () => {
    expect(
      assignmentIntervalsOverlap(
        { startMs: ms("08:00"), endMs: ms("12:00") },
        { startMs: ms("12:00"), endMs: ms("16:00") },
      ),
    ).toBe(false);
  });

  it("rejects true overlap", () => {
    expect(
      assignmentIntervalsOverlap(
        { startMs: ms("08:00"), endMs: ms("12:00") },
        { startMs: ms("11:30"), endMs: ms("16:00") },
      ),
    ).toBe(true);
  });
});

describe("overlap rejection across mission types", () => {
  const p = person("Alex", 1);

  function trackerWith(blocks: Array<{ slot: ReturnType<typeof flattenMissionSlots>[number]; missionId: string; missionType: MissionDay["mission_type"] }>) {
    const tracker = buildTrackerFromMissions([], rules);
    for (const block of blocks) {
      placePerson(
        p.name,
        block.slot,
        block.missionId,
        tracker,
        rules,
        scheduling,
        block.slot.seatCount,
        block.missionType,
      );
    }
    return tracker;
  }

  it("Test A — Carmel B vs Reserve Force overlap is invalid", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const carmel = carmelBSlot(guard);
    const reserve = reserveForceSlot(guard);
    const carmelTimed = withCustomSlotTimes(guard, carmel.slotId, "08:00", "12:00");
    const reserveTimed = withCustomSlotTimes(carmelTimed, reserve.slotId, "10:00", "14:00");
    const carmelSlot = slotByLabel(reserveTimed, "08:00–12:00");
    const reserveSlot = slotByLabel(reserveTimed, "10:00–14:00");

    const tracker = trackerWith([{ slot: carmelSlot, missionId: "g1", missionType: "guards" }]);
    expect(
      fitsPerson(p, reserveSlot, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(false);
  });

  it("Test B — Carmel B vs Base Work overlap is invalid", () => {
    const guardMission = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const carmelId = carmelBSlot(guardMission).slotId;
    const guard = withCustomSlotTimes(guardMission, carmelId, "08:00", "12:00");
    const carmelSlot = flattenMissionSlots(guard).find((s) => s.slotId === carmelId)!;
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const baseSlot = withCustomSlotTimes(base, base.positions[0].slots[0].id, "09:00", "13:00");
    const target = slotByLabel(baseSlot, "09:00–13:00");

    const tracker = trackerWith([{ slot: carmelSlot, missionId: "g1", missionType: "guards" }]);
    expect(fitsPerson(p, target, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
  });

  it("Test C — consecutive Carmel B and Base Work is valid", () => {
    const guardMission = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const carmelId = carmelBSlot(guardMission).slotId;
    const guard = withCustomSlotTimes(guardMission, carmelId, "08:00", "12:00");
    const carmelSlot = flattenMissionSlots(guard).find((s) => s.slotId === carmelId)!;
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const baseSlot = withCustomSlotTimes(base, base.positions[0].slots[0].id, "12:00", "16:00");
    const target = slotByLabel(baseSlot, "12:00–16:00");

    const tracker = trackerWith([{ slot: carmelSlot, missionId: "g1", missionType: "guards" }]);
    expect(carmelSlot.endAtMs - carmelSlot.startAtMs).toBe(4 * 3_600_000);
    expect(target.startAtMs).toBe(carmelSlot.endAtMs);
    const busy = tracker.busy[p.name] || [];
    expect(busy).toHaveLength(1);
    expect(carmelSlot.positionKind).toBe("standby_carmel_b");
    expect(busy[0].positionKind).toBe("standby_carmel_b");
    expect(
      assignmentNeedsSpacingGap(
        target.positionKind,
        target.missionType,
        busy[0].positionKind,
        busy[0].missionType,
      ),
    ).toBe(false);
    expect(
      explainFitsPersonFailure(p, target, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBeNull();
    expect(fitsPerson(p, target, tracker, [], scheduling, [], { [p.name]: p })).toBe(true);
  });

  it("Test D — Reserve Force vs Guard overlap is invalid", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const reserve = reserveForceSlot(guard);
    const patrol = flattenMissionSlots(guard).find((s) => s.positionName === "פטל")!;
    const timed = withCustomSlotTimes(
      withCustomSlotTimes(guard, reserve.slotId, "08:00", "12:00"),
      patrol.slotId,
      "10:00",
      "14:00",
    );
    const reserveSlot = slotByLabel(timed, "08:00–12:00");
    const guardSlot = slotByLabel(timed, "10:00–14:00");

    const tracker = trackerWith([{ slot: reserveSlot, missionId: "g1", missionType: "guards" }]);
    expect(fitsPerson(p, guardSlot, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
  });
});

describe("validateNoPersonOverlaps", () => {
  it("Test H — rejects manually constructed overlapping roster", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const carmel = carmelBSlot(guard);
    const reserve = reserveForceSlot(guard);
    const timed = withCustomSlotTimes(
      withCustomSlotTimes(guard, carmel.slotId, "08:00", "12:00"),
      reserve.slotId,
      "10:00",
      "14:00",
    );
    const assignments = { ...timed.assignments };
    assignments[carmel.slotId] = ["Alex", "", ""];
    assignments[reserve.slotId] = ["Alex", "", ""];

    const broken = { ...timed, assignments };
    const messages = validateNoPersonOverlaps([broken]);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("Overlap detected");
    expect(messages[0]).toContain("Alex");

    const rosterErrors = validateGeneratedRoster({
      missions: [broken],
      peopleByName: { Alex: person("Alex", 1) },
    });
    expect(rosterErrors.length).toBeGreaterThan(0);
  });
});

describe("base work assignment", () => {
  it("Test E — base work receives assignments", () => {
    const people = makePeople(56);
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const tracker = buildTrackerFromMissions([], rules);
    const slot = flattenMissionSlots(base)[0];
    const { names, diagnostics } = assignBaseWorkShift({
      people,
      slot,
      shiftIndex: 0,
      taken: [],
      tracker,
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      missionId: base.id,
      missionType: base.mission_type,
    });
    expect(names.length).toBeGreaterThan(0);
    expect(diagnostics.assigned).toBeGreaterThan(0);
  });

  it("Test F — prefers whole squad when available", () => {
    const people = Array.from({ length: 14 }, (_, i) => person(`S1-${i + 1}`, 1))
      .concat(Array.from({ length: 14 }, (_, i) => person(`S2-${i + 1}`, 2)));
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const tracker = buildTrackerFromMissions([], rules);
    const slot = flattenMissionSlots(base)[0];
    const { names, workSquad, usedFallback } = assignBaseWorkShift({
      people,
      slot,
      shiftIndex: 0,
      taken: [],
      tracker,
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      missionId: base.id,
      missionType: base.mission_type,
    });
    expect(usedFallback).toBe(false);
    expect(workSquad).toBe(1);
    expect(names).toHaveLength(14);
  });

  it("Test G — fills from other squads when preferred squad is blocked", () => {
    const people = makePeople(56);
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const slot = flattenMissionSlots(base)[0];
    const blocker = missionDay(
      "kitchen-1",
      "kitchen",
      [{ id: "p1", name: "Kitchen", kind: "kitchen", slots: [{ id: "k1", start_time: "08:00", end_time: "12:00", seat_count: 35 }] }],
      {},
      "2026-08-21T06:00:00",
      "2026-08-21T22:00:00",
    );
    const kitchenSlot = flattenMissionSlots(blocker)[0];
    const kitchenAssignments: Record<string, string[]> = {
      [kitchenSlot.slotId]: people.slice(0, 14).map((p) => p.name).concat(Array(21).fill("")),
    };
    const kitchenMission = { ...blocker, assignments: kitchenAssignments };
    const tracker = buildTrackerFromMissions([kitchenMission], rules);

    const { names, usedFallback, diagnostics } = assignBaseWorkShift({
      people,
      slot,
      shiftIndex: 0,
      taken: [],
      tracker,
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      missionId: base.id,
      missionType: base.mission_type,
    });

    expect(names.length).toBeGreaterThan(0);
    expect(usedFallback).toBe(true);
    expect(diagnostics.rejectedOverlap).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(people.slice(0, 14).map((p) => p.name)).not.toContain(name);
    }
  });
});
