import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { DEFAULT_HAMAGSHIYOT_SHIFTS, DEFAULT_HAMAGSHIYOT_SEATS } from "@/lib/hamagshiyot-template";
import { DEFAULT_PATROL_TOURS, patrolAssigneeRole } from "@/lib/patrol-day-template";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";

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
});
