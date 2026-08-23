import { describe, expect, it } from "vitest";
import { flattenMissionSlots, slotEatsRest } from "@/lib/mission-utils";
import {
  buildTrackerFromMissions,
  fitsPerson,
  placePerson,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = {
  ...DEFAULT_MISSION_SCHEDULING_RULES,
  rest_hours: 8,
  guard_ratio: 0,
};

function person(
  name: string,
  room: string,
  overrides: Partial<Person> = {},
): Person {
  return {
    id: name,
    name,
    email: null,
    room,
    gender: "m",
    squad: 1,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
    ...overrides,
  };
}

function missionWithSlots(
  slots: Array<{ id: string; name: string; kind: MissionDay["positions"][0]["kind"]; start: string; end: string; seats: number }>,
): MissionDay {
  const positions = slots.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    same_room: false,
    same_gender: false,
    slots: [
      {
        id: `${s.id}-slot`,
        start_time: s.start,
        end_time: s.end,
        seat_count: s.seats,
      },
    ],
  }));
  const assignments = Object.fromEntries(
    positions.flatMap((p) =>
      p.slots.map((slot) => [slot.id, Array.from({ length: slot.seat_count }, () => "")]),
    ),
  );
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T08:00:00",
    ends_at: "2026-08-22T08:00:00",
    status: "draft",
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function slotByName(mission: MissionDay, name: string) {
  return flattenMissionSlots(mission).find((s) => s.positionName.includes(name))!;
}

function trackerWith(
  blocks: Array<{ slot: ReturnType<typeof flattenMissionSlots>[number]; missionId: string }>,
) {
  const tracker = buildTrackerFromMissions([], rules);
  for (const block of blocks) {
    placePerson(
      "Alex",
      block.slot,
      block.missionId,
      tracker,
      rules,
      scheduling,
      block.slot.seatCount,
      "guards",
    );
  }
  return tracker;
}

describe("Reserve Force rest semantics", () => {
  const p = person("Alex", "101");

  it("Case A — guard 00–04 then reserve 04–08 is allowed (reserve does not eat rest)", () => {
    const mission = missionWithSlots([
      { id: "g", name: "פטל", kind: "guard", start: "00:00", end: "04:00", seats: 1 },
      { id: "r", name: "כוח עתודה", kind: "duty", start: "04:00", end: "08:00", seats: 1 },
    ]);
    const guardSlot = slotByName(mission, "פטל");
    const reserveSlot = slotByName(mission, "עתודה");
    expect(slotEatsRest(guardSlot)).toBe(true);
    expect(slotEatsRest(reserveSlot)).toBe(false);

    const tracker = trackerWith([{ slot: guardSlot, missionId: "g1" }]);
    expect(
      fitsPerson(p, reserveSlot, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(true);
  });

  it("Case B — reserve 08–12 then guard 12–16 is allowed", () => {
    const mission = missionWithSlots([
      { id: "r", name: "כוח עתודה", kind: "duty", start: "08:00", end: "12:00", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "12:00", end: "16:00", seats: 1 },
    ]);
    const reserveSlot = slotByName(mission, "עתודה");
    const guardSlot = slotByName(mission, "פטל");
    const tracker = trackerWith([{ slot: reserveSlot, missionId: "g1" }]);
    expect(
      fitsPerson(p, guardSlot, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(true);
  });

  it("Case C — reserve between guards does not reset rest accounting", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "פטל", kind: "guard", start: "00:00", end: "04:00", seats: 1 },
      { id: "r", name: "כוח עתודה", kind: "duty", start: "08:00", end: "12:00", seats: 1 },
      { id: "g2", name: "בונקר", kind: "guard", start: "16:00", end: "20:00", seats: 1 },
    ]);
    mission.starts_at = "2026-08-21T00:00:00";
    mission.ends_at = "2026-08-22T00:00:00";
    const first = slotByName(mission, "פטל");
    const reserve = slotByName(mission, "עתודה");
    const third = slotByName(mission, "בונקר");
    const tracker = trackerWith([
      { slot: first, missionId: "g1" },
      { slot: reserve, missionId: "g1" },
    ]);
    expect(
      fitsPerson(p, third, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(true);
    const reserveBlock = tracker.busy.Alex!.find((b) => b.slotId === reserve.slotId);
    expect(reserveBlock?.eatsRest).toBe(false);
  });

  it("Case D — overlapping reserve and guard is invalid", () => {
    const mission = missionWithSlots([
      { id: "r", name: "כוח עתודה", kind: "duty", start: "08:00", end: "12:00", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "10:00", end: "14:00", seats: 1 },
    ]);
    const reserveSlot = slotByName(mission, "עתודה");
    const guardSlot = slotByName(mission, "פטל");
    const tracker = trackerWith([{ slot: reserveSlot, missionId: "g1" }]);
    expect(
      fitsPerson(p, guardSlot, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(false);
  });

  it("Case E — guard, reserve, guard with short wall gap is allowed (ratio 2:1)", () => {
    const ratio2 = { ...scheduling, guard_ratio: 2 };
    const mission = missionWithSlots([
      { id: "g1", name: "פטל", kind: "guard", start: "08:00", end: "12:00", seats: 1 },
      { id: "r", name: "כוח עתודה", kind: "duty", start: "12:00", end: "16:00", seats: 1 },
      { id: "g2", name: "בונקר", kind: "guard", start: "16:00", end: "20:00", seats: 1 },
    ]);
    const first = slotByName(mission, "פטל");
    const reserve = slotByName(mission, "עתודה");
    const third = slotByName(mission, "בונקר");
    const tracker = trackerWith([
      { slot: first, missionId: "g1" },
      { slot: reserve, missionId: "g1" },
    ]);
    expect(
      fitsPerson(p, third, tracker, [], ratio2, [], { [p.name]: p }),
    ).toBe(true);
  });

  it("Case F — two guards back-to-back without reserve still blocked at ratio 2:1", () => {
    const ratio2 = { ...scheduling, guard_ratio: 2 };
    const mission = missionWithSlots([
      { id: "g1", name: "פטל", kind: "guard", start: "08:00", end: "12:00", seats: 1 },
      { id: "g2", name: "בונקר", kind: "guard", start: "12:00", end: "16:00", seats: 1 },
    ]);
    const first = slotByName(mission, "פטל");
    const second = slotByName(mission, "בונקר");
    const tracker = trackerWith([{ slot: first, missionId: "g1" }]);
    expect(
      fitsPerson(p, second, tracker, [], ratio2, [], { [p.name]: p }),
    ).toBe(false);
  });
});
