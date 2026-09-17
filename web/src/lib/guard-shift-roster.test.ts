import { describe, expect, it } from "vitest";
import { guardShiftRosterViews, removeGuardSlotsForWindow, resizeGuardSlotsForWindow } from "@/lib/guard-shift-roster";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardMission(
  slots: { id: string; start: string; end: string; seats?: number }[],
  assignments: Record<string, string[]>,
): MissionDay {
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T20:00:00+03:00",
    ends_at: "2026-08-27T20:00:00+03:00",
    status: "draft",
    positions: [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: s.id,
          start_time: s.start,
          end_time: s.end,
          seat_count: s.seats ?? 1,
        })),
      },
      {
        id: "p2",
        name: "תצפיתן",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: `t-${s.id}`,
          start_time: s.start,
          end_time: s.end,
          seat_count: 1,
        })),
      },
    ],
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("guardShiftRosterViews", () => {
  it("groups assignees by shift window sorted by time", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "20:00", end: "00:00" },
        { id: "s2", start: "00:00", end: "04:00" },
      ],
      {
        s1: ["Alice"],
        "t-s1": ["Bob"],
        s2: ["Carl"],
        "t-s2": ["Dana"],
      },
    );
    const views = guardShiftRosterViews(mission);
    expect(views).toHaveLength(2);
    expect(views[0]?.timeLabel).toBe("20:00–00:00");
    expect(views[0]?.allNames).toEqual(["Alice", "Bob"]);
    expect(views[0]?.positions.map((p) => p.positionName)).toEqual(["פטל", "תצפיתן"]);
    expect(views[1]?.allNames).toEqual(["Carl", "Dana"]);
  });

  it("includes reserve force in the same window", () => {
    const mission = guardMission([{ id: "s1", start: "08:00", end: "12:00" }], {
      s1: ["Alice"],
      "t-s1": ["Bob"],
    });
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const views = guardShiftRosterViews(mission);
    expect(views).toHaveLength(1);
    expect(views[0]?.allNames).toEqual(["Alice", "Bob", "Reserve"]);
    expect(views[0]?.reserveOnly).toBe(false);
    expect(views[0]?.positions.map((p) => p.positionName)).toEqual([
      "פטל",
      "תצפיתן",
      "כוח עתודה",
    ]);
  });

  it("lists a reserve-only window separately", () => {
    const mission = guardMission([{ id: "s1", start: "08:00", end: "12:00" }], {
      s1: ["Alice"],
      "t-s1": ["Bob"],
    });
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "12:00", end_time: "16:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const views = guardShiftRosterViews(mission);
    expect(views.map((v) => v.windowKey)).toEqual(["08:00-12:00", "12:00-16:00"]);
    expect(views[1]?.reserveOnly).toBe(true);
    expect(views[1]?.allNames).toEqual(["Reserve"]);
  });

  it("removeGuardSlotsForWindow drops that rotation and its assignments", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "20:00", end: "00:00" },
        { id: "s2", start: "00:00", end: "04:00" },
      ],
      {
        s1: ["Alice"],
        "t-s1": ["Bob"],
        s2: ["Carl"],
        "t-s2": ["Dana"],
      },
    );
    mission.locked_seats = { s1: [true], "t-s1": [false], s2: [true], "t-s2": [false] };
    const result = removeGuardSlotsForWindow(mission, "20:00-00:00");
    expect(result.removedSlotIds.sort()).toEqual(["s1", "t-s1"]);
    expect(result.removedNames).toEqual(["Alice", "Bob"]);
    expect(result.mission.assignments.s1).toBeUndefined();
    expect(result.mission.assignments.s2).toEqual(["Carl"]);
    expect(result.mission.positions[0]?.slots.map((s) => s.id)).toEqual(["s2"]);
    expect(guardShiftRosterViews(result.mission).map((v) => v.windowKey)).toEqual([
      "00:00-04:00",
    ]);
  });

  it("removeGuardSlotsForWindow also drops reserve in that window", () => {
    const mission = guardMission(
      [{ id: "s1", start: "08:00", end: "12:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const result = removeGuardSlotsForWindow(mission, "08:00-12:00");
    expect(result.removedSlotIds.sort()).toEqual(["r1", "s1", "t-s1"]);
    expect(result.removedNames).toEqual(["Alice", "Bob", "Reserve"]);
    expect(result.mission.assignments.r1).toBeUndefined();
    expect(
      result.mission.positions.find((p) => p.id === "reserve")?.slots,
    ).toEqual([]);
  });

  it("removeGuardSlotsForWindow can delete a reserve-only window", () => {
    const mission = guardMission(
      [{ id: "s1", start: "08:00", end: "12:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "12:00", end_time: "16:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const result = removeGuardSlotsForWindow(mission, "12:00-16:00");
    expect(result.removedSlotIds).toEqual(["r1"]);
    expect(result.removedNames).toEqual(["Reserve"]);
    expect(result.mission.assignments.s1).toEqual(["Alice"]);
    expect(
      result.mission.positions.find((p) => p.id === "reserve")?.slots,
    ).toEqual([]);
  });

  it("removeGuardSlotsForWindow leaves officer duty", () => {
    const mission = guardMission(
      [{ id: "s1", start: "08:00", end: "12:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    mission.positions.push({
      id: "od",
      name: "קצין תורן",
      kind: "officer_duty",
      slots: [{ id: "od1", start_time: "08:00", end_time: "12:00", seat_count: 2 }],
    });
    mission.assignments.od1 = ["Officer"];
    const result = removeGuardSlotsForWindow(mission, "08:00-12:00");
    expect(result.removedNames).toEqual(["Alice", "Bob"]);
    expect(result.mission.assignments.od1).toEqual(["Officer"]);
    expect(result.mission.positions.some((p) => p.id === "od")).toBe(true);
  });

  it("resizeGuardSlotsForWindow shortens the window and keeps assignments", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "21:00", end: "01:00" },
        { id: "s2", start: "01:00", end: "05:00" },
      ],
      {
        s1: ["Alice"],
        "t-s1": ["Bob"],
        s2: ["Carl"],
        "t-s2": ["Dana"],
      },
    );
    mission.locked_seats = { s1: [true], "t-s1": [false] };
    const result = resizeGuardSlotsForWindow(mission, "21:00-01:00", "21:00", "22:30");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startTime).toBe("21:00");
    expect(result.endTime).toBe("22:30");
    expect(result.resizedSlotIds.sort()).toEqual(["s1", "t-s1"]);
    expect(result.mission.assignments.s1).toEqual(["Alice"]);
    expect(result.mission.locked_seats?.s1).toEqual([true]);
    expect(result.mission.positions[0]?.slots.find((s) => s.id === "s1")).toMatchObject({
      start_time: "21:00",
      end_time: "22:30",
    });
    expect(result.mission.positions[0]?.slots.find((s) => s.id === "s2")).toMatchObject({
      start_time: "01:00",
      end_time: "05:00",
    });
    expect(guardShiftRosterViews(result.mission).map((v) => v.windowKey)).toEqual([
      "21:00-22:30",
      "01:00-05:00",
    ]);
  });

  it("resizeGuardSlotsForWindow also moves reserve in that window", () => {
    const mission = guardMission(
      [{ id: "s1", start: "21:00", end: "01:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "21:00", end_time: "01:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Reserve"];
    const result = resizeGuardSlotsForWindow(mission, "21:00-01:00", "21:00", "22:30");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.mission.positions.find((p) => p.id === "reserve")?.slots[0],
    ).toMatchObject({ start_time: "21:00", end_time: "22:30" });
    expect(result.mission.assignments.r1).toEqual(["Reserve"]);
  });

  it("resizeGuardSlotsForWindow leaves officer duty", () => {
    const mission = guardMission(
      [{ id: "s1", start: "21:00", end: "01:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    mission.positions.push({
      id: "od",
      name: "קצין תורן",
      kind: "officer_duty",
      slots: [{ id: "od1", start_time: "21:00", end_time: "01:00", seat_count: 2 }],
    });
    const result = resizeGuardSlotsForWindow(mission, "21:00-01:00", "21:00", "22:30");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.positions.find((p) => p.id === "od")?.slots[0]).toMatchObject({
      start_time: "21:00",
      end_time: "01:00",
    });
  });

  it("resizeGuardSlotsForWindow rejects a window that already exists", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "21:00", end: "01:00" },
        { id: "s2", start: "01:00", end: "05:00" },
      ],
      {},
    );
    const result = resizeGuardSlotsForWindow(mission, "21:00-01:00", "01:00", "05:00");
    expect(result).toEqual({
      ok: false,
      error: "כבר קיים גלגול שמירה או עתודה באותן שעות",
    });
  });

  it("resizeGuardSlotsForWindow rejects identical start and end", () => {
    const mission = guardMission(
      [{ id: "s1", start: "21:00", end: "01:00" }],
      {},
    );
    const result = resizeGuardSlotsForWindow(mission, "21:00-01:00", "21:00", "21:00");
    expect(result.ok).toBe(false);
  });

  it("resizeGuardSlotsForWindow accepts HH:MM:SS from time inputs", () => {
    const mission = guardMission(
      [{ id: "s1", start: "21:00", end: "01:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    const result = resizeGuardSlotsForWindow(
      mission,
      "21:00-01:00",
      "21:00:00",
      "22:30:00",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.endTime).toBe("22:30");
  });
});
