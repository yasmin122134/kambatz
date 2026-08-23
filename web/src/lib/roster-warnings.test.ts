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
});
