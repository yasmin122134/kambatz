import { describe, expect, it } from "vitest";
import { linkedGuardDayAssignScope } from "@/lib/guard-day-bundle";
import { virtualBaseWorkMission } from "@/lib/mission-utils";
import { runGlobalAssign } from "@/lib/global-assign";
import { validateMissionStructureForAssignment } from "@/lib/mission-slot-structure";
import { standardMissionPositions } from "@/lib/mission-templates";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import type { MissionDay, Person } from "@/lib/types";

function person(id: string, name: string, squad = 1): Person {
  return {
    id,
    name,
    email: null,
    squad,
    room: "101",
    gender: "m",
    active: true,
    prior_score: 0,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
  };
}

describe("embedded base work in guards mission", () => {
  it("scope is single guards mission", () => {
    const guards = {
      id: "g1",
      title: "שמירות",
      status: "draft" as const,
      notes: "",
      mission_type: "guards" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T20:00:00+03:00",
      ends_at: "2026-08-22T20:00:00+03:00",
      positions: [],
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    } satisfies MissionDay;
    expect(linkedGuardDayAssignScope(guards, [guards]).map((m) => m.id)).toEqual(["g1"]);
  });

  it("validates base work slots inside guard mission window", () => {
    const positions = standardMissionPositions({
      missionType: "guards",
      startsAt: "2026-08-21T20:00:00+03:00",
      endsAt: "2026-08-22T20:00:00+03:00",
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
    });
    const mission = {
      id: "g1",
      title: "שמירות",
      status: "draft" as const,
      notes: "",
      mission_type: "guards" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T20:00:00+03:00",
      ends_at: "2026-08-22T20:00:00+03:00",
      positions,
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    } satisfies MissionDay;
    expect(validateMissionStructureForAssignment(mission)).toEqual([]);
    expect(virtualBaseWorkMission(mission)?.positions.length).toBeGreaterThan(0);
  });

  it("assigns base work shift units in guards mission", { timeout: 20_000 }, () => {
    const positions = standardMissionPositions({
      missionType: "guards",
      startsAt: "2026-08-21T20:00:00+03:00",
      endsAt: "2026-08-22T20:00:00+03:00",
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
    });
    const basePos = positions.find((p) => p.name.includes("עבודות בסיס"));
    expect(basePos).toBeTruthy();
    const assignments: Record<string, string[]> = {};
    for (const slot of basePos!.slots) {
      assignments[slot.id] = Array(slot.seat_count).fill("");
    }

    const mission = {
      id: "g1",
      title: "שמירות",
      status: "draft" as const,
      notes: "",
      mission_type: "guards" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T20:00:00+03:00",
      ends_at: "2026-08-22T20:00:00+03:00",
      positions,
      assignments,
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    } satisfies MissionDay;

    const people = Array.from({ length: 56 }, (_, i) =>
      person(`p${i}`, `צוער ${i + 1}`, (i % 4) + 1),
    );
    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });
    const baseSlotId = basePos!.slots[0].id;
    const seats = output.assignmentsByMission.get("g1")?.[baseSlotId] || [];
    expect(seats.filter(Boolean).length).toBeGreaterThanOrEqual(13);
  });
});
