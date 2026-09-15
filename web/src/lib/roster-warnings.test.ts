import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { collectRosterWarnings, auditAssignedRoster } from "@/lib/scheduling-engine";
import type { Issue, MissionDay, Person } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(name: string): Person {
  return {
    id: name,
    name,
    email: null,
    room: "101",
    gender: "m",
    squad: 1,
    active: true,
    no_guard: false,
    prior_score: 0,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
  };
}

function guardMission(assignments: Record<string, string[]> = {}): MissionDay {
  const startsAt = "2026-03-01T07:00:00.000Z";
  const endsAt = "2026-03-02T07:00:00.000Z";
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "09:00",
    shiftHours: 4,
  });
  return {
    id: "m1",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments,
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, rest_hours: 8 },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("collectRosterWarnings", () => {
  it("reports approved constraint conflicts", () => {
    const mission = guardMission({});
    const slot = flattenMissionSlots(mission).find((s) => s.positionKind === "guard")!;
    const blocked = person("חסום");
    const issues: Issue[] = [
      {
        id: "i1",
        person_id: blocked.id,
        person_name: blocked.name,
        constraint_date: "2026-03-01",
        start_time: slot.startTime,
        end_time: slot.endTime,
        issue_type: "trial",
        note: "מבחן",
        status: "approved",
        created_at: "",
      },
    ];

    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          assignments: { [slot.slotId]: [blocked.name] },
        },
      ],
      peopleByName: { [blocked.name]: blocked },
      issues,
    });

    expect(warnings.some((w) => w.includes("התנגשות עם חסימה מאושרת"))).toBe(true);
  });

  it("ignores approved constraints on other dates", () => {
    const mission = guardMission({});
    const slot = flattenMissionSlots(mission).find((s) => s.positionKind === "guard")!;
    const blocked = person("חסום");
    const issues: Issue[] = [
      {
        id: "i1",
        person_id: blocked.id,
        person_name: blocked.name,
        constraint_date: "2026-04-01",
        start_time: slot.startTime,
        end_time: slot.endTime,
        issue_type: "trial",
        note: "מבחן",
        status: "approved",
        created_at: "",
      },
    ];

    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          assignments: { [slot.slotId]: [blocked.name] },
        },
      ],
      peopleByName: { [blocked.name]: blocked },
      issues,
    });

    expect(warnings.some((w) => w.includes("התנגשות עם חסימה מאושרת"))).toBe(false);
  });

  it("warns when rest between two guards is under rest_hours", () => {
    const startsAt = "2026-03-01T07:00:00+03:00";
    const endsAt = "2026-03-02T07:00:00+03:00";
    const mission: MissionDay = {
      id: "m-rest",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [
            { id: "g1", start_time: "09:00", end_time: "13:00", seat_count: 1 },
            { id: "g2", start_time: "17:00", end_time: "21:00", seat_count: 1 },
          ],
        },
      ],
      assignments: { g1: ["Alex"], g2: ["Alex"] },
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        rest_hours: 8,
        guard_ratio: 2,
        duty_guard_gap_minutes: 60,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = collectRosterWarnings({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(warnings.some((w) => w.includes("מנוחה") && w.includes("נדרש 8"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("יחס שמירות"))).toBe(true);
  });

  it("does not warn rest_hours when guards are 8 hours apart", () => {
    const startsAt = "2026-03-01T07:00:00+03:00";
    const endsAt = "2026-03-02T07:00:00+03:00";
    const mission: MissionDay = {
      id: "m-ok",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [
            { id: "g1", start_time: "09:00", end_time: "13:00", seat_count: 1 },
            { id: "g2", start_time: "21:00", end_time: "01:00", seat_count: 1 },
          ],
        },
      ],
      assignments: { g1: ["Alex"], g2: ["Alex"] },
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        rest_hours: 8,
        guard_ratio: 2,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = collectRosterWarnings({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(warnings.some((w) => w.includes("מנוחה") && w.includes("בין שמירות"))).toBe(
      false,
    );
  });

  it("warns when ABAS-to-guard gap is under duty_guard_gap_minutes", () => {
    const startsAt = "2026-03-01T07:00:00+03:00";
    const endsAt = "2026-03-02T07:00:00+03:00";
    const mission: MissionDay = {
      id: "m-abas",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "abas",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [
            { id: "b1", start_time: "13:30", end_time: "17:30", seat_count: 1 },
          ],
        },
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "g1", start_time: "18:00", end_time: "21:00", seat_count: 1 }],
        },
      ],
      assignments: { b1: ["Alex"], g1: ["Alex"] },
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        rest_hours: 8,
        duty_guard_gap_minutes: 60,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = collectRosterWarnings({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(
      warnings.some(
        (w) => w.includes("עב״ס") && w.includes("נדרש 60") && w.includes("30 דק"),
      ),
    ).toBe(true);
  });

  it("does not warn daily rest for a full-day officer duty shift", () => {
    const mission = guardMission();
    const officerSlot = flattenMissionSlots(mission).find(
      (s) => s.positionKind === "officer_duty",
    )!;
    const rani = person("רני פלג");
    rani.is_officer = true;
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          assignments: { [officerSlot.slotId]: [rani.name, ""] },
        },
      ],
      peopleByName: { [rani.name]: rani },
    });
    expect(warnings.some((w) => w.includes("מנוחה"))).toBe(false);
  });

  it("does not warn rest between consecutive full-day officer duty shifts", () => {
    const day1 = guardMission();
    const day2: MissionDay = {
      ...guardMission(),
      id: "m2",
      mission_date: "2026-03-02",
      starts_at: "2026-03-02T07:00:00.000Z",
      ends_at: "2026-03-03T07:00:00.000Z",
    };
    const slot1 = flattenMissionSlots(day1).find((s) => s.positionKind === "officer_duty")!;
    const slot2 = flattenMissionSlots(day2).find((s) => s.positionKind === "officer_duty")!;
    const rani = person("רני פלג");
    rani.is_officer = true;
    const warnings = collectRosterWarnings({
      missions: [
        { ...day1, assignments: { [slot1.slotId]: [rani.name, ""] } },
        { ...day2, assignments: { [slot2.slotId]: [rani.name, ""] } },
      ],
      peopleByName: { [rani.name]: rani },
    });
    expect(warnings.some((w) => w.includes("מנוחה"))).toBe(false);
    expect(warnings.some((w) => w.includes("יחס שמירות"))).toBe(false);
  });

  it("always warns when the same person is on overlapping ABAS and a guard post", () => {
    const mission = guardMission();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const guard = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < abas.endAtMs &&
        abas.startAtMs < s.endAtMs,
    )!;
    const alex = person("אלכס");
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          assignments: {
            [abas.slotId]: [alex.name, ...Array(Math.max(0, abas.seatCount - 1)).fill("")],
            [guard.slotId]: [alex.name],
          },
        },
      ],
      peopleByName: { [alex.name]: alex },
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("אלכס"))).toBe(true);
    expect(warnings.some((w) => w.includes("עב״ס") && w.includes("אלכס"))).toBe(true);
  });

  it("warns even when ABAS and a guard share a slot id but have different times", () => {
    const mission = guardMission();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const guard = slots.find((s) => s.positionKind === "guard" && s.startTime === "09:00")!;
    const sharedId = abas.slotId;
    const positions = mission.positions.map((pos) => ({
      ...pos,
      slots: pos.slots.map((slot) =>
        slot.id === guard.slotId ? { ...slot, id: sharedId } : slot,
      ),
    }));
    const alex = person("אלכס");
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          positions,
          assignments: {
            [sharedId]: [alex.name],
          },
        },
      ],
      peopleByName: { [alex.name]: alex },
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("אלכס"))).toBe(true);
  });

  it("warns a one-minute ABAS∩guard overlap", () => {
    const mission: MissionDay = {
      id: "m-1min",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T07:00:00+03:00",
      ends_at: "2026-03-02T07:00:00+03:00",
      status: "draft",
      positions: [
        {
          id: "abas",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [{ id: "b1", start_time: "08:30", end_time: "11:30", seat_count: 1 }],
        },
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "g1", start_time: "11:29", end_time: "15:29", seat_count: 1 }],
        },
      ],
      assignments: { b1: ["Alex"], g1: ["Alex"] },
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, rest_hours: 8 },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = auditAssignedRoster({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("Alex"))).toBe(true);
  });

  it("warns when rest is one minute under rest_hours", () => {
    const mission: MissionDay = {
      id: "m-rest-1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T07:00:00+03:00",
      ends_at: "2026-03-02T07:00:00+03:00",
      status: "draft",
      positions: [
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [
            { id: "g1", start_time: "09:00", end_time: "13:00", seat_count: 1 },
            { id: "g2", start_time: "20:59", end_time: "00:59", seat_count: 1 },
          ],
        },
      ],
      assignments: { g1: ["Alex"], g2: ["Alex"] },
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        rest_hours: 8,
        guard_ratio: 0,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = auditAssignedRoster({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(warnings.some((w) => w.includes("מנוחה") && w.includes("נדרש 8"))).toBe(true);
  });

  it("warns short rest between ABAS and a later guard even when the minute-gap is ok", () => {
    const mission: MissionDay = {
      id: "m-abas-rest",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T07:00:00+03:00",
      ends_at: "2026-03-02T07:00:00+03:00",
      status: "draft",
      positions: [
        {
          id: "abas",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [{ id: "b1", start_time: "08:30", end_time: "11:30", seat_count: 1 }],
        },
        {
          id: "pg",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "g1", start_time: "16:00", end_time: "20:00", seat_count: 1 }],
        },
      ],
      assignments: { b1: ["Alex"], g1: ["Alex"] },
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        rest_hours: 8,
        duty_guard_gap_minutes: 60,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const warnings = auditAssignedRoster({
      missions: [mission],
      peopleByName: { Alex: person("Alex") },
    });
    expect(warnings.some((w) => w.includes("חפיפה"))).toBe(false);
    expect(
      warnings.some((w) => w.includes("מנוחה") && w.includes("עב״ס") && w.includes("נדרש 8")),
    ).toBe(true);
  });

  it("warns leftover linked ABAS overlapping a 09:00 guard when focus is only the guards mission", () => {
    const guards = guardMission();
    const guard0900 = flattenMissionSlots(guards).find(
      (s) => s.positionKind === "guard" && s.startTime === "09:00",
    )!;
    const leftover: MissionDay = {
      id: "linked-abas",
      title: "עב״ס",
      mission_type: "base_work",
      mission_date: guards.mission_date,
      starts_at: "2026-03-01T08:30:00+03:00",
      ends_at: "2026-03-01T20:00:00+03:00",
      status: "published",
      positions: defaultBaseWorkPositions({ seatsPerShift: 1 }),
      assignments: {},
      scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES },
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const abasSlot = leftover.positions[0].slots.find((s) => s.start_time === "08:30")!;
    leftover.assignments = { [abasSlot.id]: ["אלכס"] };
    const alex = person("אלכס");
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...guards,
          scheduling_rules: {
            ...guards.scheduling_rules,
            linked_mission_id: leftover.id,
          },
          assignments: { [guard0900.slotId]: [alex.name] },
        },
        leftover,
      ],
      peopleByName: { [alex.name]: alex },
      focusMissionIds: [guards.id],
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("אלכס"))).toBe(true);
  });

  it("warns ABAS∩guard even when assignment names have surrounding spaces", () => {
    const mission = guardMission();
    const slots = flattenMissionSlots(mission);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const guard = slots.find((s) => s.positionKind === "guard" && s.startTime === "09:00")!;
    const alex = person("אלכס");
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...mission,
          assignments: {
            [abas.slotId]: ["  אלכס  ", ...Array(Math.max(0, abas.seatCount - 1)).fill("")],
            [guard.slotId]: ["אלכס "],
          },
        },
      ],
      peopleByName: { [alex.name]: alex },
      focusMissionIds: [mission.id],
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("אלכס"))).toBe(true);
  });

  it("warns yesterday's overnight guard overlapping today's morning ABAS", () => {
    const today = guardMission();
    const yesterdayStartsAt = "2026-02-28T07:00:00.000Z";
    const yesterdayEndsAt = "2026-03-01T07:00:00.000Z";
    const yesterday: MissionDay = {
      ...guardMission(),
      id: "m0",
      mission_date: "2026-02-28",
      starts_at: yesterdayStartsAt,
      ends_at: yesterdayEndsAt,
      positions: buildGuardDayPositions({
        missionStartsAt: yesterdayStartsAt,
        missionEndsAt: yesterdayEndsAt,
        boardStart: "09:00",
        shiftHours: 4,
      }),
    };
    const overnight = flattenMissionSlots(yesterday).find(
      (s) => s.positionKind === "guard" && s.startTime === "05:00",
    )!;
    const abas = flattenMissionSlots(today).find(
      (s) => s.missionType === "base_work" && s.startTime === "08:30",
    )!;
    const alex = person("אלכס");
    const warnings = collectRosterWarnings({
      missions: [
        {
          ...yesterday,
          assignments: { [overnight.slotId]: [alex.name] },
        },
        {
          ...today,
          assignments: {
            [abas.slotId]: [alex.name, ...Array(Math.max(0, abas.seatCount - 1)).fill("")],
          },
        },
      ],
      peopleByName: { [alex.name]: alex },
      focusMissionIds: [today.id],
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes("אלכס"))).toBe(true);
  });
});
