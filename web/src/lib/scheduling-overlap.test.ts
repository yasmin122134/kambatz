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
  findAssignmentConflicts,
  validateGeneratedRoster,
  validateNoPersonOverlaps,
  explainFitsPersonFailure,
  assignmentNeedsSpacingGap,
  allowsParallelAssignmentOverlap,
  collectRosterWarnings,
  isBaseWorkAssignment,
  stripAbasTimeViolations,
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

  it("Test B2 — Reserve Force vs Base Work overlap is invalid", () => {
    const guardMission = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const reserveId = reserveForceSlot(guardMission).slotId;
    const guard = withCustomSlotTimes(guardMission, reserveId, "08:00", "12:00");
    const reserveSlot = flattenMissionSlots(guard).find((s) => s.slotId === reserveId)!;
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

    expect(
      allowsParallelAssignmentOverlap(
        "duty",
        "guards",
        "duty",
        "base_work",
        { positionName: "כוח עתודה" },
        { positionName: "עבודות בסיס", startTime: "09:00", endTime: "13:00" },
      ),
    ).toBe(false);

    const tracker = trackerWith([{ slot: reserveSlot, missionId: "g1", missionType: "guards" }]);
    expect(fitsPerson(p, target, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
  });

  it("guard bundle — Reserve Force + embedded ABAS overlap warns", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const slots = flattenMissionSlots(guard);
    const reserve = slots.find((s) => s.positionName.includes("עתודה"))!;
    const abas = slots.find((s) => s.missionType === "base_work")!;
    const assignments = { ...guard.assignments };
    assignments[reserve.slotId] = ["Alex", "", "", "", ""];
    const abasSeats = Array(abas.seatCount).fill("");
    abasSeats[0] = "Alex";
    assignments[abas.slotId] = abasSeats;
    const mission = { ...guard, assignments };
    const people = { Alex: person("Alex", 1) };

    const overlapWarnings = findAssignmentConflicts(mission, people).filter((m) =>
      /חפיפה/.test(m),
    );
    expect(overlapWarnings.length).toBeGreaterThan(0);
    expect(validateNoPersonOverlaps([mission]).length).toBeGreaterThan(0);
  });

  it("Test B — Carmel B vs Base Work overlap is allowed (parallel)", () => {
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
    expect(fitsPerson(p, target, tracker, [], scheduling, [], { [p.name]: p })).toBe(true);
  });

  it("guard bundle — Carmel B + embedded ABAS parallel does not warn", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const slots = flattenMissionSlots(guard);
    const carmel = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const abas = slots.find((s) => s.missionType === "base_work")!;
    const assignments = { ...guard.assignments };
    assignments[carmel.slotId] = ["Alex", "Bob", "Cal"];
    const abasSeats = Array(abas.seatCount).fill("");
    abasSeats[0] = "Alex";
    abasSeats[1] = "Bob";
    abasSeats[2] = "Cal";
    assignments[abas.slotId] = abasSeats;
    const mission = { ...guard, assignments };
    const people = {
      Alex: person("Alex", 1),
      Bob: person("Bob", 1),
      Cal: person("Cal", 1),
    };

    const overlapWarnings = findAssignmentConflicts(mission, people).filter((m) =>
      /חפיפה/.test(m),
    );
    expect(overlapWarnings).toHaveLength(0);

    const rosterWarnings = collectRosterWarnings({
      missions: [mission],
      peopleByName: people,
    }).filter((m) => /חפיפה/.test(m));
    expect(rosterWarnings).toHaveLength(0);
    expect(validateNoPersonOverlaps([mission])).toHaveLength(0);
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
  it("allows Carmel B parallel with base work", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const carmel = carmelBSlot(guard);
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const timed = withCustomSlotTimes(
      withCustomSlotTimes(guard, carmel.slotId, "08:00", "12:00"),
      base.positions[0].slots[0].id,
      "09:00",
      "13:00",
    );
    const baseSlotId = base.positions[0].slots[0].id;
    const assignments = { ...timed.assignments };
    assignments[carmel.slotId] = ["Alex", "", ""];
    assignments[baseSlotId] = Array(15).fill("");
    assignments[baseSlotId][0] = "Alex";

    const guardMission = { ...timed, assignments };
    const baseMission = {
      ...withCustomSlotTimes(base, baseSlotId, "09:00", "13:00"),
      assignments: { [baseSlotId]: assignments[baseSlotId] },
    };

    expect(
      allowsParallelAssignmentOverlap(
        "standby_carmel_b",
        "guards",
        "duty",
        "base_work",
      ),
    ).toBe(true);
    expect(validateNoPersonOverlaps([guardMission, baseMission])).toHaveLength(0);
  });

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
    expect(messages[0]).toContain("חפיפה");
    expect(messages[0]).toContain("Alex");

    const rosterErrors = validateGeneratedRoster({
      missions: [broken],
      peopleByName: { Alex: person("Alex", 1) },
    });
    expect(rosterErrors.length).toBeGreaterThan(0);
  });

  it("ABAS ∩ overlapping guard always appears first in roster warnings", () => {
    const guard = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const slots = flattenMissionSlots(guard);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const post = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    const assignments = { ...guard.assignments };
    const abasSeats = Array(abas.seatCount).fill("");
    abasSeats[0] = "Alex";
    assignments[abas.slotId] = abasSeats;
    assignments[post.slotId] = ["Alex"];
    const mission = { ...guard, assignments };
    const warnings = collectRosterWarnings({
      missions: [mission],
      peopleByName: { Alex: person("Alex", 1) },
    });
    expect(warnings[0]).toContain("חפיפה");
    expect(warnings.some((w) => w.includes("חפיפה עב״ס") && w.includes("Alex"))).toBe(true);
  });

  it("warns when wall labels overlap even if stored ISO is ~24h later", () => {
    const startsAt = "2026-03-01T07:00:00.000Z";
    const endsAt = "2026-03-03T07:00:00.000Z";
    const abasId = "abas-stale";
    const guardId = "guard-stale";
    const mission = missionDay(
      "g-stale",
      "guards",
      [
        {
          id: "p-abas",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [{ id: abasId, start_time: "08:30", end_time: "11:30", seat_count: 1 }],
        },
        {
          id: "p-guard",
          name: "פטל",
          kind: "guard",
          slots: [
            {
              id: guardId,
              start_time: "09:00",
              end_time: "13:00",
              seat_count: 1,
              starts_at: "2026-03-02T07:00:00.000Z",
              ends_at: "2026-03-02T11:00:00.000Z",
            },
          ],
        },
      ],
      { [abasId]: ["Alex"], [guardId]: ["Alex"] },
      startsAt,
      endsAt,
    );
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.slotId === abasId)!;
    const post = slots.find((s) => s.slotId === guardId)!;
    expect(assignmentIntervalsOverlap(
      { startMs: abas.startAtMs, endMs: abas.endAtMs },
      { startMs: post.startAtMs, endMs: post.endAtMs },
    )).toBe(false);
    const messages = validateNoPersonOverlaps([mission]);
    expect(messages.some((m) => m.includes("חפיפה") && m.includes("Alex"))).toBe(true);
  });

  it("does not warn identical wall times on consecutive days", () => {
    const day1 = guardBundleMission("2026-08-21T08:00:00", "2026-08-22T08:00:00");
    const day2 = {
      ...guardBundleMission("2026-08-22T08:00:00", "2026-08-23T08:00:00"),
      id: "guard-2",
      mission_date: "2026-08-22",
    };
    const slot1 = flattenMissionSlots(day1).find((s) => s.positionKind === "guard")!;
    const slot2 = flattenMissionSlots(day2).find(
      (s) =>
        s.positionKind === "guard" &&
        s.startTime === slot1.startTime &&
        s.positionName === slot1.positionName,
    )!;
    const warnings = validateNoPersonOverlaps([
      { ...day1, assignments: { ...day1.assignments, [slot1.slotId]: ["Alex"] } },
      { ...day2, assignments: { ...day2.assignments, [slot2.slotId]: ["Alex"] } },
    ]);
    expect(warnings.filter((w) => w.includes("חפיפה"))).toEqual([]);
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

  it("Test F — fills full base work shift (20 seats)", () => {
    const people = Array.from({ length: 14 }, (_, i) => person(`S1-${i + 1}`, 1)).concat(
      Array.from({ length: 15 }, (_, i) => person(`S2-${i + 1}`, 2)),
    );
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
    expect(names).toHaveLength(20);
    expect(diagnostics.required).toBe(20);
    expect(diagnostics.assigned).toBe(20);
    expect(new Set(names).size).toBe(20);
  });

  it("Test G — skips people blocked by kitchen overlap", () => {
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
    expect(diagnostics.rejectedOverlap).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(people.slice(0, 14).map((p) => p.name)).not.toContain(name);
    }
  });

  it("fills shift when some people are blocked by guard overlap", () => {
    const people = Array.from({ length: 14 }, (_, i) => person(`S1-${i + 1}`, 1)).concat(
      Array.from({ length: 14 }, (_, i) => person(`S2-${i + 1}`, 2)),
    );
    const base = missionDay(
      "base-1",
      "base_work",
      defaultBaseWorkPositions(),
      {},
      "2026-08-21T08:00:00",
      "2026-08-21T20:00:00",
    );
    const slot = flattenMissionSlots(base)[0];
    const guardMission = missionDay(
      "g-1",
      "guards",
      [
        {
          id: "pg",
          name: "Gate",
          kind: "guard",
          slots: [
            { id: "gs1", start_time: "06:00", end_time: "08:00", seat_count: 1 },
            { id: "gs2", start_time: "06:00", end_time: "08:00", seat_count: 1 },
          ],
        },
      ],
      { gs1: ["S1-1"], gs2: ["S2-1"] },
      "2026-08-21T06:00:00",
      "2026-08-21T22:00:00",
    );
    const guardSlots = flattenMissionSlots(guardMission);
    const tracker = buildTrackerFromMissions([guardMission], rules);
    placePerson(
      "S1-1",
      guardSlots[0],
      guardMission.id,
      tracker,
      rules,
      scheduling,
      1,
      "guards",
    );
    placePerson(
      "S2-1",
      guardSlots[1],
      guardMission.id,
      tracker,
      rules,
      scheduling,
      1,
      "guards",
    );

    const { names } = assignBaseWorkShift({
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

    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names).not.toContain("S1-1");
    expect(names.some((n) => n.startsWith("S1-"))).toBe(true);
    expect(names.some((n) => n.startsWith("S2-"))).toBe(true);
  });
});

describe("hamagshiyot must not overlap other duties", () => {
  const p = person("Alex", 1);

  function eveningGuardBundle(startsAt: string, endsAt: string): MissionDay {
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      missionDate: startsAt.slice(0, 10),
      boardStart: startsAt.includes("T20:") ? "20:00" : startsAt.slice(11, 16),
    });
    return missionDay("guard-1", "guards", positions, {}, startsAt, endsAt);
  }

  it("does not allow hamagshiyot in parallel with ABAS", () => {
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "duty",
        "base_work",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        { positionName: "עבודות בסיס", startTime: "18:30", endTime: "20:00" },
      ),
    ).toBe(false);
  });

  it("rejects the same person on evening hamagshiyot and evening ABAS (20:00 board)", () => {
    const guard = eveningGuardBundle(
      "2026-08-21T20:00:00+03:00",
      "2026-08-22T20:00:00+03:00",
    );
    const slots = flattenMissionSlots(guard);
    const ham = slots.find((s) => s.positionName === "חמגשיות" && s.startTime === "18:00")!;
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "18:30")!;

    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, ham, guard.id, tracker, rules, scheduling, ham.seatCount, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);

    const assigned = {
      ...guard,
      assignments: {
        ...guard.assignments,
        [ham.slotId]: [p.name, "", "", "", ""],
        [abas.slotId]: [p.name, ...Array(Math.max(0, abas.seatCount - 1)).fill("")],
      },
    };
    expect(validateNoPersonOverlaps([assigned]).length).toBeGreaterThan(0);
    expect(
      collectRosterWarnings({ missions: [assigned], peopleByName: { Alex: p } }).some((m) =>
        /Overlap|חפיפ/.test(m),
      ),
    ).toBe(true);
  });

  it("allows morning hamagshiyot before morning ABAS (no time overlap)", () => {
    const guard = eveningGuardBundle(
      "2026-08-21T20:00:00+03:00",
      "2026-08-22T20:00:00+03:00",
    );
    const slots = flattenMissionSlots(guard);
    const ham = slots.find((s) => s.positionName === "חמגשיות" && s.startTime === "07:00")!;
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;

    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, ham, guard.id, tracker, rules, scheduling, ham.seatCount, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling, [], { [p.name]: p })).toBe(true);
  });

  it("rejects hamagshiyot overlapping a guard post", () => {
    const guard = eveningGuardBundle(
      "2026-08-21T09:00:00+03:00",
      "2026-08-22T09:00:00+03:00",
    );
    const slots = flattenMissionSlots(guard);
    const ham = slots.find((s) => s.positionName === "חמגשיות" && s.startTime === "18:00")!;
    const post = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < ham.endAtMs &&
        s.endAtMs > ham.startAtMs,
    );
    expect(post).toBeTruthy();
    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, ham, guard.id, tracker, rules, scheduling, ham.seatCount, "guards");
    expect(fitsPerson(p, post!, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
  });

  it("rejects evening hamagshiyot overlapping the 18:30 patrol", () => {
    const guard = eveningGuardBundle(
      "2026-08-21T09:00:00+03:00",
      "2026-08-22T09:00:00+03:00",
    );
    const slots = flattenMissionSlots(guard);
    const ham = slots.find((s) => s.positionName === "חמגשיות" && s.startTime === "18:00")!;
    const patrol = slots.find(
      (s) => s.positionKind === "patrol" && s.startTime === "18:30",
    )!;
    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, ham, guard.id, tracker, rules, scheduling, ham.seatCount, "guards");
    expect(fitsPerson(p, patrol, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
  });

  it("allows hamagshiyot in parallel with Carmel B and reserve force", () => {
    const guard = eveningGuardBundle(
      "2026-08-21T09:00:00+03:00",
      "2026-08-22T09:00:00+03:00",
    );
    const slots = flattenMissionSlots(guard);
    const ham = slots.find((s) => s.positionName === "חמגשיות" && s.startTime === "18:00")!;
    const carmel = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const reserve = slots.find(
      (s) =>
        s.positionName.includes("עתודה") &&
        s.startAtMs < ham.endAtMs &&
        ham.startAtMs < s.endAtMs,
    )!;
    expect(carmel.startAtMs < ham.endAtMs && ham.startAtMs < carmel.endAtMs).toBe(true);

    const people = { [p.name]: p };
    const withCarmel = buildTrackerFromMissions([], rules);
    placePerson(p.name, carmel, guard.id, withCarmel, rules, scheduling, carmel.seatCount, "guards");
    expect(fitsPerson(p, ham, withCarmel, [], scheduling, [], people)).toBe(true);

    const withReserve = buildTrackerFromMissions([], rules);
    placePerson(p.name, reserve, guard.id, withReserve, rules, scheduling, reserve.seatCount, "guards");
    expect(fitsPerson(p, ham, withReserve, [], scheduling, [], people)).toBe(true);

    const hamSeats = Array(ham.seatCount).fill("");
    hamSeats[0] = p.name;
    const carmelSeats = Array(carmel.seatCount).fill("");
    carmelSeats[0] = p.name;
    const reserveSeats = Array(reserve.seatCount).fill("");
    reserveSeats[0] = p.name;

    expect(
      validateNoPersonOverlaps([
        {
          ...guard,
          assignments: {
            ...guard.assignments,
            [ham.slotId]: hamSeats,
            [carmel.slotId]: carmelSeats,
          },
        },
      ]).filter((m) => m.includes("חפיפה")),
    ).toEqual([]);
    expect(
      validateNoPersonOverlaps([
        {
          ...guard,
          assignments: {
            ...guard.assignments,
            [ham.slotId]: hamSeats,
            [reserve.slotId]: reserveSeats,
          },
        },
      ]).filter((m) => m.includes("חפיפה")),
    ).toEqual([]);
  });
});

describe("ABAS may overlap only Carmel B", () => {
  const p = person("Alex", 1);
  const abasMeta = { positionName: "עבודות בסיס", startTime: "08:30", endTime: "11:30" };

  function nineAmBundle(): MissionDay {
    return guardBundleMission("2026-08-21T09:00:00+03:00", "2026-08-22T09:00:00+03:00");
  }

  function assignPair(mission: MissionDay, a: ReturnType<typeof flattenMissionSlots>[number], b: ReturnType<typeof flattenMissionSlots>[number]) {
    const assignments = { ...mission.assignments };
    const aSeats = Array(a.seatCount).fill("");
    aSeats[0] = p.name;
    const bSeats = Array(b.seatCount).fill("");
    bSeats[0] = p.name;
    assignments[a.slotId] = aSeats;
    assignments[b.slotId] = bSeats;
    return { ...mission, assignments };
  }

  function expectHardOverlap(
    mission: MissionDay,
    other: ReturnType<typeof flattenMissionSlots>[number],
    abas: ReturnType<typeof flattenMissionSlots>[number],
  ) {
    expect(other).toBeTruthy();
    expect(abas).toBeTruthy();
    expect(other.startAtMs < abas.endAtMs && abas.startAtMs < other.endAtMs).toBe(true);

    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, other, mission.id, tracker, rules, scheduling, other.seatCount, other.missionType);
    expect(fitsPerson(p, abas, tracker, [], scheduling, [], { [p.name]: p })).toBe(false);
    expect(
      explainFitsPersonFailure(p, abas, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe("overlapsSlot");

    const assigned = assignPair(mission, other, abas);
    expect(validateNoPersonOverlaps([assigned]).length).toBeGreaterThan(0);
    expect(findAssignmentConflicts(assigned, { [p.name]: p }).some((m) => /חפיפה/.test(m))).toBe(
      true,
    );

    const stripped = stripAbasTimeViolations({
      mission: assigned,
      assignments: assigned.assignments,
      scheduling,
      rules,
    });
    expect(stripped.removed).toBeGreaterThan(0);
    expect((stripped.assignments[abas.slotId] || []).includes(p.name)).toBe(false);
  }

  it("allows parallel only for Carmel B + ABAS", () => {
    expect(
      allowsParallelAssignmentOverlap(
        "standby_carmel_b",
        "guards",
        "duty",
        "base_work",
        { positionName: "כרמל ב׳ (כוננות)" },
        abasMeta,
      ),
    ).toBe(true);
    expect(
      allowsParallelAssignmentOverlap(
        "standby_carmel_a",
        "guards",
        "duty",
        "base_work",
        { positionName: "כרמל א׳ (כוננות)" },
        abasMeta,
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap("guard", "guards", "duty", "base_work", { positionName: "פטל" }, abasMeta),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "duty",
        "guards",
        "duty",
        "base_work",
        { positionName: "כוח עתודה", startTime: "09:00", endTime: "13:00" },
        abasMeta,
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "duty",
        "base_work",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        abasMeta,
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "patrol",
        "guards",
        "duty",
        "base_work",
        { positionName: "פטרול", startTime: "18:30", endTime: "19:00" },
        abasMeta,
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "officer_duty",
        "guards",
        "duty",
        "base_work",
        { positionName: "קצין תורן" },
        abasMeta,
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "standby_carmel_b",
        "guards",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        { positionName: "כרמל ב׳ (כוננות)" },
      ),
    ).toBe(true);
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "duty",
        "guards",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        { positionName: "כוח עתודה", startTime: "18:00", endTime: "21:00" },
      ),
    ).toBe(true);
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "standby_carmel_a",
        "guards",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        { positionName: "כרמל א׳ (כוננות)" },
      ),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "kitchen",
        "guards",
        "guard",
        "guards",
        { positionName: "חמגשיות", startTime: "18:00", endTime: "19:00" },
        { positionName: "פטל", startTime: "18:00", endTime: "21:00" },
      ),
    ).toBe(false);
  });

  it("does not classify reserve with ABAS hours as ABAS", () => {
    expect(
      isBaseWorkAssignment("duty", "guards", {
        positionName: "כוח עתודה",
        startTime: "13:30",
        endTime: "17:30",
      }),
    ).toBe(false);

    const guard = nineAmBundle();
    const reserve = reserveForceSlot(guard);
    const timed = withCustomSlotTimes(guard, reserve.slotId, "13:30", "17:30");
    const slot = flattenMissionSlots(timed).find((s) => s.slotId === reserve.slotId)!;
    expect(slot.missionType).toBe("guards");
    expect(slot.positionKind).toBe("duty");
    expect(
      isBaseWorkAssignment(slot.positionKind, slot.missionType, {
        positionName: slot.positionName,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }),
    ).toBe(false);
    expect(
      allowsParallelAssignmentOverlap(
        "standby_carmel_b",
        "guards",
        slot.positionKind,
        slot.missionType,
        { positionName: "כרמל ב׳ (כוננות)" },
        { positionName: slot.positionName, startTime: slot.startTime, endTime: slot.endTime },
      ),
    ).toBe(false);
  });

  it("rejects overlapping reserve force", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const reserve = slots.find(
      (s) =>
        s.positionName.includes("עתודה") &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    expectHardOverlap(mission, reserve, abas);
  });

  it("rejects overlapping guard post", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const post = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    expectHardOverlap(mission, post, abas);
  });

  it("rejects overlapping evening hamagshiyot", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "18:30")!;
    const ham = slots.find(
      (s) =>
        s.positionName === "חמגשיות" &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    expectHardOverlap(mission, ham, abas);
  });

  it("rejects overlapping patrol", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "18:30")!;
    const patrol = slots.find(
      (s) =>
        s.positionKind === "patrol" &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    expectHardOverlap(mission, patrol, abas);
  });

  it("rejects overlapping officer duty", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "13:30")!;
    const officer = slots.find((s) => s.positionKind === "officer_duty")!;
    expectHardOverlap(mission, officer, abas);
  });

  it("still allows Carmel B on the same ABAS window", () => {
    const mission = nineAmBundle();
    const slots = flattenMissionSlots(mission);
    const carmel = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, carmel, mission.id, tracker, rules, scheduling, carmel.seatCount, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling, [], { [p.name]: p })).toBe(true);
    expect(validateNoPersonOverlaps([assignPair(mission, carmel, abas)])).toHaveLength(0);
  });
});
