import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { DEFAULT_HAMAGSHIYOT_SHIFTS, DEFAULT_HAMAGSHIYOT_SEATS } from "@/lib/hamagshiyot-template";
import { DEFAULT_PATROL_TOURS, patrolAssigneeRole, patrolAssigneeRoleLabel } from "@/lib/patrol-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  allowsParallelAssignmentOverlap,
  buildTrackerFromMissions,
  dutyOfficerAtPatrolTime,
  fitsPerson,
  placePerson,
  pointsForSlot,
  resolvePatrolAssigneeName,
  validateGeneratedRoster,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import { calculatePersonBurden } from "@/lib/guard-burden";

const rules = { ...DEFAULT_FAIRNESS_RULES };

function cadet(name: string): Person {
  return {
    id: name,
    name,
    email: null,
    room: "1",
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
  };
}

describe("patrol and hamagshiyot guard day positions", () => {
  it("includes patrol and hamagshiyot in standard guard day", () => {
    const positions = buildGuardDayPositions({
      missionStartsAt: "2026-01-01T20:00:00",
      missionEndsAt: "2026-01-02T20:00:00",
      missionDate: "2026-01-02",
    });

    const patrol = positions.find((p) => p.name === "פטרולים");
    const hamagshiyot = positions.find((p) => p.name === "חמגשיות");

    expect(patrol?.kind).toBe("patrol");
    expect(patrol?.slots).toHaveLength(DEFAULT_PATROL_TOURS.length);
    expect(hamagshiyot?.kind).toBe("kitchen");
    expect(hamagshiyot?.slots).toHaveLength(DEFAULT_HAMAGSHIYOT_SHIFTS.length);
    expect(hamagshiyot?.slots.every((s) => s.seat_count === DEFAULT_HAMAGSHIYOT_SEATS)).toBe(
      true,
    );
  });

  it("maps patrol tour roles from wall-clock windows", () => {
    expect(patrolAssigneeRole("09:30", "10:00")).toBe("company_commander");
    expect(patrolAssigneeRole("13:00", "13:30")).toBe("duty_officer");
    expect(patrolAssigneeRole("18:30", "19:30")).toBe("company_commander");
    expect(patrolAssigneeRole("23:00", "23:30")).toBe("duty_officer");
    expect(patrolAssigneeRole("02:00", "02:30")).toBe("duty_officer");
    expect(patrolAssigneeRole("05:00", "06:00")).toBe("company_commander");
  });

  it("flattens patrol slots with labels on mission timeline", () => {
    const positions = buildGuardDayPositions({
      missionStartsAt: "2026-01-01T20:00:00",
      missionEndsAt: "2026-01-02T20:00:00",
      missionDate: "2026-01-02",
    });
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-01-02",
      starts_at: "2026-01-01T20:00:00",
      ends_at: "2026-01-02T20:00:00",
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: {
        rest_hours: 7,
        guard_ratio: 2,
        board_start: "20:00",
        shift_hours: 4,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const flat = flattenMissionSlots(mission);
    const patrolSlots = flat.filter((s) => s.positionKind === "patrol");
    const hamSlots = flat.filter((s) => s.positionName === "חמגשיות");

    expect(patrolSlots).toHaveLength(6);
    expect(patrolSlots.every((s) => s.slotLabel)).toBe(true);
    expect(hamSlots).toHaveLength(3);
    expect(hamSlots[0].startTime).toBe("07:00");
  });

  it("does not flag wall-clock slots as outside the guard mission interval", () => {
    const positions = buildGuardDayPositions({
      missionStartsAt: "2026-01-01T08:00:00+03:00",
      missionEndsAt: "2026-01-02T08:00:00+03:00",
      missionDate: "2026-01-01",
    });
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-01-01",
      starts_at: "2026-01-01T08:00:00+03:00",
      ends_at: "2026-01-02T08:00:00+03:00",
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: {
        rest_hours: 7,
        guard_ratio: 2,
        board_start: "08:00",
        shift_hours: 4,
      },
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const errors = validateGeneratedRoster({ missions: [mission] });
    expect(errors.some((e) => e.includes("outside mission interval"))).toBe(false);
  });

  it("awards one guard point per patrol", () => {
    const slot = {
      slotId: "p1",
      positionId: "pos",
      positionName: "פטרולים",
      positionKind: "patrol" as const,
      sameRoom: false,
      sameGender: false,
      missionType: "guards" as const,
      startTime: "09:30",
      endTime: "10:00",
      timeLabel: "09:30–10:00",
      seatCount: 1,
      assignees: [],
      sortKey: 0,
      durationMinutes: 30,
      cyclicStart: 570,
      wallStartMin: 570,
      calendarDayOffset: 0,
      startAtMs: 0,
      endAtMs: 1_800_000,
      slotLabel: "סיור פנים גדר",
    };
    expect(pointsForSlot(slot, 1, rules)).toBe(1);
    const breakdown = calculatePersonBurden(
      [
        {
          wallStartMin: 570,
          calendarDayOffset: 0,
          durationMinutes: 30,
          eatsRest: false,
          positionKind: "patrol",
          missionType: "guards",
          seatCount: 1,
          startTime: "09:30",
          endTime: "10:00",
          slotId: "p1",
          positionName: "פטרולים",
        },
      ],
      rules,
    );
    expect(breakdown.guardBaseBurden).toBe(1);
    expect(breakdown.guardPoints).toBe(1);
  });

  it("awards one toranut point per hamagshiyot shift", () => {
    const breakdown = calculatePersonBurden(
      [
        {
          wallStartMin: 7 * 60,
          calendarDayOffset: 0,
          durationMinutes: 60,
          eatsRest: false,
          positionKind: "kitchen",
          missionType: "guards",
          seatCount: 5,
          startTime: "07:00",
          endTime: "08:00",
          slotId: "h1",
          positionName: "חמגשיות",
        },
      ],
      rules,
    );
    expect(breakdown.toranutPoints).toBe(1);
    expect(breakdown.guardPoints).toBe(0);
    expect(breakdown.fairnessPoints).toBe(1);
    expect(pointsForSlot(
      {
        slotId: "h1",
        positionId: "hp",
        positionName: "חמגשיות",
        positionKind: "kitchen",
        sameRoom: false,
        sameGender: false,
        missionType: "guards",
        startTime: "07:00",
        endTime: "08:00",
        timeLabel: "07:00–08:00",
        seatCount: 5,
        assignees: [],
        sortKey: 0,
        durationMinutes: 60,
        cyclicStart: 420,
        wallStartMin: 420,
        calendarDayOffset: 0,
        startAtMs: 0,
        endAtMs: 3_600_000,
      },
      5,
      rules,
      { missionType: "guards" },
    )).toBe(1);
  });

  it("blocks guard assignment overlapping an existing patrol", () => {
    const scheduling = { rest_hours: 7, guard_ratio: 2, board_start: "08:00", shift_hours: 4 };
    const patrol = {
      slotId: "patrol-1",
      positionId: "pp",
      positionName: "פטרולים",
      positionKind: "patrol" as const,
      sameRoom: false,
      sameGender: false,
      missionType: "guards" as const,
      startTime: "13:00",
      endTime: "13:30",
      timeLabel: "13:00–13:30",
      seatCount: 1,
      assignees: [],
      sortKey: 0,
      durationMinutes: 30,
      cyclicStart: 780,
      wallStartMin: 780,
      calendarDayOffset: 0,
      startAtMs: Date.parse("2026-01-01T13:00:00+03:00"),
      endAtMs: Date.parse("2026-01-01T13:30:00+03:00"),
      slotLabel: "סיור",
    };
    const guard = {
      ...patrol,
      slotId: "guard-1",
      positionName: "פטל",
      positionKind: "guard" as const,
      startTime: "12:00",
      endTime: "16:00",
      timeLabel: "12:00–16:00",
      durationMinutes: 240,
      startAtMs: Date.parse("2026-01-01T12:00:00+03:00"),
      endAtMs: Date.parse("2026-01-01T16:00:00+03:00"),
    };
    const p = cadet("Alex");
    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, patrol, "g1", tracker, rules, scheduling, 1, "guards");
    expect(
      fitsPerson(p, guard, tracker, [], scheduling, [], { [p.name]: p }),
    ).toBe(false);
  });

  it("allows duty officer patrol parallel with officer duty shift", () => {
    expect(
      allowsParallelAssignmentOverlap(
        "patrol",
        "guards",
        "officer_duty",
        "guards",
      ),
    ).toBe(true);
    expect(
      allowsParallelAssignmentOverlap(
        "officer_duty",
        "guards",
        "patrol",
        "guards",
      ),
    ).toBe(true);
  });

  it("labels patrol assignee roles in Hebrew", () => {
    expect(patrolAssigneeRoleLabel("company_commander")).toBe("ככ״א");
    expect(patrolAssigneeRoleLabel("duty_officer")).toBe("קצין תורן");
  });

  it("resolves duty officer name for patrol from overlapping officer duty shift", () => {
    const positions = buildGuardDayPositions({
      missionDate: "2026-03-01",
      startsAt: "2026-03-01T08:00:00+03:00",
      endsAt: "2026-03-02T08:00:00+03:00",
    });
    const patrolPos = positions.find((p) => p.name === "פטרולים")!;
    const officerPos = positions.find((p) => p.kind === "officer_duty")!;
    const dutyPatrolSlot = patrolPos.slots.find((s) => s.start_time === "13:00")!;
    const missionDraft: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T08:00:00+03:00",
      ends_at: "2026-03-02T08:00:00+03:00",
      status: "published",
      positions,
      assignments: {},
      scheduling_rules: {},
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const patrolFlat = flattenMissionSlots(missionDraft).find(
      (s) => s.slotId === dutyPatrolSlot.id,
    )!;
    const officerFlat = flattenMissionSlots(missionDraft).find(
      (s) =>
        s.positionKind === "officer_duty" &&
        s.startAtMs <= patrolFlat.startAtMs &&
        s.endAtMs > patrolFlat.startAtMs,
    )!;
    const mission: MissionDay = {
      ...missionDraft,
      assignments: {
        [officerFlat.slotId]: ["רני פלג"],
        [dutyPatrolSlot.id]: [],
      },
    };
    expect(dutyOfficerAtPatrolTime(mission, patrolFlat, mission.assignments)).toBe(
      "רני פלג",
    );
    expect(resolvePatrolAssigneeName(mission, patrolFlat)).toBe("רני פלג");
  });

  it("uses assigned name on company commander patrol", () => {
    const positions = buildGuardDayPositions({
      missionDate: "2026-03-01",
      startsAt: "2026-03-01T08:00:00+03:00",
      endsAt: "2026-03-02T08:00:00+03:00",
    });
    const patrolPos = positions.find((p) => p.name === "פטרולים")!;
    const ccPatrolSlot = patrolPos.slots.find((s) => s.start_time === "09:30")!;
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-03-01",
      starts_at: "2026-03-01T08:00:00+03:00",
      ends_at: "2026-03-02T08:00:00+03:00",
      status: "published",
      positions,
      assignments: {
        [ccPatrolSlot.id]: ["דני כהן"],
      },
      scheduling_rules: {},
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const patrolFlat = flattenMissionSlots(mission).find(
      (s) => s.slotId === ccPatrolSlot.id,
    )!;
    expect(patrolAssigneeRole(patrolFlat.startTime, patrolFlat.endTime)).toBe(
      "company_commander",
    );
    expect(resolvePatrolAssigneeName(mission, patrolFlat)).toBe("דני כהן");
  });
});
