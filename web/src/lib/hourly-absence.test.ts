import { describe, expect, it } from "vitest";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  hourlyAbsenceViews,
  isPersonPresentInMissionAtTime,
  buildPersonSlotAssignments,
  hourSampleMs,
} from "@/lib/hourly-absence";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES };

function guardMission(
  slots: { id: string; start: string; end: string; seats?: number }[],
  assignments: Record<string, string[]>,
): MissionDay {
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T09:00:00+03:00",
    ends_at: "2026-08-27T09:00:00+03:00",
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
    ],
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("hourlyAbsenceViews", () => {
  it("lists unassigned cadets as absent during a guard shift", () => {
    const mission = guardMission(
      [{ id: "g1", start: "08:00", end: "12:00" }],
      { g1: ["Alex"] },
    );
    const views = hourlyAbsenceViews({
      missions: [mission],
      rosterNames: ["Alex", "Bob", "Carl"],
      anchorMission: mission,
      boardStartMin: 0,
    });
    const atTen = views.find((v) => v.wallTimeLabel === "10:00");
    expect(atTen?.absentNames).toEqual(["Bob", "Carl"]);
    expect(atTen?.absentNames).not.toContain("Alex");
  });

  it("treats reserve force alone as absent", () => {
    const mission = guardMission(
      [
        { id: "g1", start: "08:00", end: "12:00", seats: 1 },
      ],
      { g1: [""] },
    );
    mission.positions.push({
      id: "reserve",
      name: "כוח עתודה",
      kind: "duty",
      same_room: false,
      same_gender: false,
      slots: [{ id: "r1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
    });
    mission.assignments.r1 = ["Bob"];

    const views = hourlyAbsenceViews({
      missions: [mission],
      rosterNames: ["Alex", "Bob"],
      anchorMission: mission,
      boardStartMin: 0,
    });
    const atTen = views.find((v) => v.wallTimeLabel === "10:00");
    expect(atTen?.absentNames).toContain("Bob");
    expect(atTen?.absentNames).toContain("Alex");
  });

  it("counts reserve force with parallel base work as present", () => {
    const mission = guardMission([{ id: "g1", start: "08:00", end: "12:00" }], { g1: [""] });
    mission.positions.push(
      {
        id: "reserve",
        name: "כוח עתודה",
        kind: "duty",
        same_room: false,
        same_gender: false,
        slots: [{ id: "r1", start_time: "08:30", end_time: "11:30", seat_count: 1 }],
      },
      {
        id: "abas",
        name: 'עב"ס',
        kind: "duty",
        same_room: false,
        same_gender: false,
        slots: [{ id: "b1", start_time: "08:30", end_time: "11:30", seat_count: 2 }],
      },
    );
    mission.assignments.r1 = ["Bob"];
    mission.assignments.b1 = ["Bob", "Carl"];

    const sampleMs = hourSampleMs(mission, 0, 10);
    const assignments = buildPersonSlotAssignments([mission], 0);
    expect(isPersonPresentInMissionAtTime("Bob", assignments, sampleMs)).toBe(true);
    expect(isPersonPresentInMissionAtTime("Carl", assignments, sampleMs)).toBe(true);

    const views = hourlyAbsenceViews({
      missions: [mission],
      rosterNames: ["Alex", "Bob", "Carl"],
      anchorMission: mission,
      boardStartMin: 0,
    });
    const atTen = views.find((v) => v.wallTimeLabel === "10:00");
    expect(atTen?.absentNames).toEqual(["Alex"]);
  });

  it("counts hamagshiyot on evening guard day within mission cycle", () => {
    const mission = guardMission(
      [{ id: "g1", start: "20:00", end: "00:00" }],
      { g1: ["Alex"] },
    );
    mission.starts_at = "2026-08-26T20:00:00+03:00";
    mission.ends_at = "2026-08-27T20:00:00+03:00";
    mission.positions.push({
      id: "ham",
      name: "חמגשיות",
      kind: "kitchen",
      same_room: false,
      same_gender: false,
      slots: [{ id: "h1", start_time: "07:00", end_time: "08:00", seat_count: 5 }],
    });
    mission.assignments.h1 = ["Bob", "Carl", "", "", ""];

    const views = hourlyAbsenceViews({
      missions: [mission],
      rosterNames: ["Alex", "Bob", "Carl"],
      anchorMission: mission,
      boardStartMin: 20 * 60,
    });
    const morningHour = views.find((v) => v.wallTimeLabel === "07:00");
    expect(morningHour?.absentNames).toEqual(["Alex"]);
    expect(morningHour?.absentNames).not.toContain("Bob");
    expect(morningHour?.absentNames).not.toContain("Carl");
  });
});
