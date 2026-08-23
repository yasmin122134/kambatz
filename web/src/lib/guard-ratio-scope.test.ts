import { describe, expect, it } from "vitest";
import { defaultBaseWorkPositions } from "@/lib/base-work-template";
import { runGlobalAssign } from "@/lib/global-assign";
import { flattenMissionSlots, isGuardKind } from "@/lib/mission-utils";
import { standardMissionPositions } from "@/lib/mission-templates";
import {
  buildTrackerFromMissions,
  explainFitsPersonFailure,
  fitsPerson,
  placePerson,
} from "@/lib/scheduling-engine";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import type { MissionDay, Person } from "@/lib/types";

function person(name: string): Person {
  return {
    id: name,
    name,
    email: null,
    squad: 1,
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

describe("guard ratio scoped to current mission", () => {
  it("allows morning guard on next day after previous night shift (7h gap)", () => {
    const prevPositions = standardMissionPositions({
      missionType: "guards",
      startsAt: "2026-08-25T20:00:00+03:00",
      endsAt: "2026-08-26T20:00:00+03:00",
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
    });
    const prev: MissionDay = {
      id: "prev",
      title: "שמירות",
      status: "draft",
      notes: "",
      mission_type: "guards",
      mission_date: "2026-08-25",
      starts_at: "2026-08-25T20:00:00+03:00",
      ends_at: "2026-08-26T20:00:00+03:00",
      positions: prevPositions,
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    };

    const nightSlot =
      flattenMissionSlots(prev).find(
        (s) => s.positionKind === "guard" && s.startTime === "21:00",
      ) ??
      flattenMissionSlots(prev).find((s) => s.positionKind === "guard");
    expect(nightSlot).toBeDefined();
    if (!nightSlot) return;

    prev.assignments[nightSlot.slotId] = ["Alex"];

    const nextPositions = standardMissionPositions({
      missionType: "guards",
      startsAt: "2026-08-26T20:00:00+03:00",
      endsAt: "2026-08-27T20:00:00+03:00",
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
    });
    const next: MissionDay = {
      id: "next",
      title: "שמירות",
      status: "draft",
      notes: "",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: "2026-08-26T20:00:00+03:00",
      ends_at: "2026-08-27T20:00:00+03:00",
      positions: nextPositions,
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    };

    const morningSlot =
      flattenMissionSlots(next).find(
        (s) => s.positionKind === "guard" && s.startTime === "09:00",
      ) ?? flattenMissionSlots(next).find((s) => s.positionKind === "guard");
    expect(morningSlot).toBeDefined();
    if (!morningSlot) return;

    const tracker = buildTrackerFromMissions([prev], DEFAULT_FAIRNESS_RULES);
    const p = person("Alex");
    const peopleByName = { [p.name]: p };
    const scheduling = DEFAULT_MISSION_SCHEDULING_RULES;

    expect(
      explainFitsPersonFailure(
        p,
        morningSlot,
        tracker,
        [],
        scheduling,
        [],
        peopleByName,
        undefined,
        "next",
      ),
    ).toBeNull();
    expect(
      fitsPerson(p, morningSlot, tracker, [], scheduling, [], peopleByName, undefined, "next"),
    ).toBe(true);
  });

  it("still blocks overlapping guard shifts within the same mission", () => {
    const positions = standardMissionPositions({
      missionType: "guards",
      startsAt: "2026-08-26T20:00:00+03:00",
      endsAt: "2026-08-27T20:00:00+03:00",
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
    });
    const mission: MissionDay = {
      id: "same",
      title: "שמירות",
      status: "draft",
      notes: "",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: "2026-08-26T20:00:00+03:00",
      ends_at: "2026-08-27T20:00:00+03:00",
      positions,
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    };

    const slots = flattenMissionSlots(mission).filter((s) => s.positionKind === "guard");
    expect(slots.length).toBeGreaterThan(1);
    const first = slots[0];
    const overlapping = slots.find(
      (s) => s.slotId !== first.slotId && s.startAtMs < first.endAtMs && first.startAtMs < s.endAtMs,
    );
    if (!overlapping) return;

    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson("Alex", first, mission.id, tracker, DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES, first.seatCount);

    const p = person("Alex");
    expect(
      fitsPerson(
        p,
        overlapping,
        tracker,
        [],
        DEFAULT_MISSION_SCHEDULING_RULES,
        [],
        { Alex: p },
        undefined,
        mission.id,
      ),
    ).toBe(false);
  });

  it("morning base work does not block afternoon guard (directional 90min gap)", () => {
    const positions = [
      ...standardMissionPositions({
        missionType: "guards",
        startsAt: "2026-08-25T20:00:00+03:00",
        endsAt: "2026-08-26T20:00:00+03:00",
        scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
      }),
    ];
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      status: "draft",
      notes: "",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: "2026-08-25T20:00:00+03:00",
      ends_at: "2026-08-26T20:00:00+03:00",
      positions,
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    };

    const slots = flattenMissionSlots(mission);
    const baseSlot = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30");
    expect(baseSlot).toBeDefined();
    if (!baseSlot) return;

    const afternoonGuard = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs >= baseSlot.endAtMs + 90 * 60_000,
    );
    expect(afternoonGuard).toBeDefined();
    if (!afternoonGuard) return;

    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(
      "Alex",
      baseSlot,
      mission.id,
      tracker,
      DEFAULT_FAIRNESS_RULES,
      DEFAULT_MISSION_SCHEDULING_RULES,
      baseSlot.seatCount,
    );

    const p = person("Alex");
    expect(
      explainFitsPersonFailure(
        p,
        afternoonGuard,
        tracker,
        [],
        DEFAULT_MISSION_SCHEDULING_RULES,
        [],
        { Alex: p },
        undefined,
        mission.id,
      ),
    ).toBeNull();
  });

  it("fills all guard seats in a full guard day (kitchen + cross-day context)", () => {
    const people = Array.from({ length: 56 }, (_, i) =>
      person(`צוער ${i + 1}`),
    );
    const guards = {
      id: "g26",
      title: "שמירות",
      status: "draft" as const,
      notes: "",
      mission_type: "guards" as const,
      mission_date: "2026-08-26",
      starts_at: "2026-08-25T20:00:00+03:00",
      ends_at: "2026-08-26T20:00:00+03:00",
      positions: standardMissionPositions({
        missionType: "guards",
        startsAt: "2026-08-25T20:00:00+03:00",
        endsAt: "2026-08-26T20:00:00+03:00",
        scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
      }),
      assignments: {} as Record<string, string[]>,
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    };
    for (const pos of guards.positions) {
      for (const slot of pos.slots) {
        guards.assignments[slot.id] = Array(slot.seat_count).fill("");
      }
    }

    const prev = { ...guards, id: "g25", mission_date: "2026-08-25" };
    const prevOut = runGlobalAssign({
      missions: [prev],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });
    const prevFilled = {
      ...prev,
      assignments: prevOut.assignmentsByMission.get(prev.id)!,
    };

    const output = runGlobalAssign({
      missions: [guards],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
      crossDayMissions: [prevFilled],
    });

    let guardReq = 0;
    let guardFill = 0;
    for (const s of flattenMissionSlots(guards)) {
      if (s.positionKind !== "guard") continue;
      guardReq += s.seatCount;
      const row = output.assignmentsByMission.get(guards.id)?.[s.slotId] || [];
      guardFill += row.filter(Boolean).length;
    }
    expect(guardFill).toBe(guardReq);
  }, 30_000);
});
