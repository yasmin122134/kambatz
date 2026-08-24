import { describe, expect, it } from "vitest";
import {
  buildKitchenOutNamesFromSquads,
  normalizeKitchenOutNamesByShift,
  resolveKitchenOutNames,
} from "@/lib/kitchen-out-lists";
import { assignKitchenShift, createEmptyScheduleTracker } from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_KITCHEN_SCHEDULING_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
  type Person,
} from "@/lib/types";

function person(name: string, squad?: number): Person {
  return {
    id: name,
    name,
    email: null,
    squad: squad ?? null,
    room: null,
    gender: null,
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

function kitchenSlot(start: string, end: string): FlatSlot {
  return {
    slotId: "s1",
    positionId: "p1",
    positionName: "משמרות מטבח",
    positionKind: "kitchen",
    sameRoom: false,
    sameGender: false,
    missionType: "kitchen",
    startTime: start,
    endTime: end,
    timeLabel: `${start}–${end}`,
    seatCount: 3,
    assignees: [],
    sortKey: 0,
    durationMinutes: 240,
    cyclicStart: 0,
    wallStartMin: 360,
    calendarDayOffset: 0,
    startAtMs: 0,
    endAtMs: 0,
    kitchenShiftIndex: 0,
  };
}

describe("kitchen out lists", () => {
  it("normalizes four shift rows", () => {
    const rows = normalizeKitchenOutNamesByShift([
      [" ב ", "א"],
      null,
      ["ג"],
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(["א", "ב"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["ג"]);
  });

  it("uses explicit out names when provided", () => {
    const people = [person("א", 1), person("ב", 2), person("ג", 3)];
    const out = resolveKitchenOutNames(
      {
        ...DEFAULT_KITCHEN_SCHEDULING_RULES,
        out_names_by_shift: [["א", "ב"], [], [], []],
      },
      0,
      people,
    );
    expect(out).toEqual(new Set(["א", "ב"]));
  });

  it("falls back to resting squad when lists are empty", () => {
    const people = [
      person("א1", 1),
      person("א2", 1),
      person("ב1", 2),
      person("ג1", 3),
    ];
    const out = resolveKitchenOutNames(
      {
        ...DEFAULT_KITCHEN_SCHEDULING_RULES,
        squad_rest_by_shift: [1, 2, 3, 4],
      },
      0,
      people,
    );
    expect(out).toEqual(new Set(["א1", "א2"]));
  });

  it("builds out lists from squad rest settings", () => {
    const people = [
      person("א1", 1),
      person("א2", 1),
      person("ב1", 2),
      person("ג1", 3),
      person("ד1", 4),
    ];
    const lists = buildKitchenOutNamesFromSquads(
      { ...DEFAULT_KITCHEN_SCHEDULING_RULES, squad_rest_by_shift: [1, 2, 3, 4] },
      people,
    );
    expect(lists[0]).toEqual(["א1", "א2"]);
    expect(lists[1]).toEqual(["ב1"]);
    expect(lists[2]).toEqual(["ג1"]);
    expect(lists[3]).toEqual(["ד1"]);
  });

  it("assignKitchenShift never assigns people on the out list", () => {
    const people = [
      person("א", 1),
      person("ב", 1),
      person("ג", 2),
      person("ד", 2),
      person("ה", 3),
    ];
    const scheduling = {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      kitchen: {
        ...DEFAULT_KITCHEN_SCHEDULING_RULES,
        seats_per_shift: 3,
        out_names_by_shift: [["א", "ב"], [], [], []],
      },
    };
    const tracker = createEmptyScheduleTracker();
    const slot = kitchenSlot("06:00", "10:00");
    const { names } = assignKitchenShift({
      people,
      slot,
      shiftIndex: 0,
      need: 3,
      taken: [],
      tracker,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      missionId: "m1",
      missionType: "kitchen",
    });
    expect(names).toHaveLength(3);
    expect(names).not.toContain("א");
    expect(names).not.toContain("ב");
    expect(names.every((n) => ["ג", "ד", "ה"].includes(n))).toBe(true);
  });
});
