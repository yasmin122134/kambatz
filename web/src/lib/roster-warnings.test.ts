import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { collectRosterWarnings } from "@/lib/scheduling-engine";
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
});
