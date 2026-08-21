import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { runGlobalAssign } from "@/lib/global-assign";
import {
  assertMissionStructureUnchanged,
  applyAssignmentsOnly,
  snapshotMissionStructure,
  validateMissionStructureForAssignment,
} from "@/lib/mission-slot-structure";
import { syncAssignmentSeats } from "@/lib/mission-utils";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };

function missionStartVariants(): string[] {
  return ["00:00", "05:00", "08:00", "13:30", "17:30", "20:00", "23:15"];
}

function buildGuardMissionAtBoardStart(boardTime: string): MissionDay {
  const [h, m] = boardTime.split(":").map(Number);
  const date = "2026-08-21";
  const startLocal = new Date(`${date}T12:00:00`);
  startLocal.setHours(h, m, 0, 0);
  const endLocal = new Date(startLocal.getTime() + 86_400_000);

  const startsAt = startLocal.toISOString();
  const endsAt = endLocal.toISOString();
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: boardTime,
    shiftHours: 4,
    season: "summer",
  });
  const assignments = syncAssignmentSeats(positions, {});
  return {
    id: `guard-${boardTime.replace(":", "")}`,
    title: `guards ${boardTime}`,
    mission_type: "guards",
    mission_date: date,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments,
    scheduling_rules: {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      board_start: boardTime,
    },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function dummyPeople(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Cadet ${i + 1}`,
    email: null,
    room: `${100 + (i % 10)}`,
    gender: "m" as const,
    squad: (i % 4) + 1,
    active: true,
    km: false,
    exam: false,
    no_weapon: false,
    no_guard: false,
    no_mag: false,
    prior_score: 0,
    created_at: "",
  }));
}

function buildMinimalGuardMission(boardTime: string): MissionDay {
  const [h, m] = boardTime.split(":").map(Number);
  const date = "2026-08-21";
  const startLocal = new Date(`${date}T12:00:00`);
  startLocal.setHours(h, m, 0, 0);
  const endLocal = new Date(startLocal.getTime() + 86_400_000);
  const startsAt = startLocal.toISOString();
  const endsAt = endLocal.toISOString();

  const positions = [
    {
      id: "patrol",
      name: "פטל",
      kind: "guard" as const,
      slots: [
        {
          id: `slot-a-${boardTime}`,
          start_time: boardTime,
          end_time: `${String((h + 4) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          seat_count: 1,
        },
        {
          id: `slot-b-${boardTime}`,
          start_time: `${String((h + 4) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          end_time: `${String((h + 8) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          seat_count: 1,
        },
      ],
    },
  ];
  const assignments = syncAssignmentSeats(positions, {});
  return {
    id: `guard-${boardTime.replace(":", "")}`,
    title: `guards ${boardTime}`,
    mission_type: "guards",
    mission_date: date,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments,
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: boardTime },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("Smart Assignment preserves slot structure", () => {
  it("full guard mission at 17:30 has valid structure and assign-only payload preserves it", () => {
    const mission = buildGuardMissionAtBoardStart("17:30");
    const structureBefore = snapshotMissionStructure(mission);
    expect(validateMissionStructureForAssignment(mission)).toEqual([]);

    const afterAssign = applyAssignmentsOnly(mission, mission.assignments);
    assertMissionStructureUnchanged(structureBefore, snapshotMissionStructure(afterAssign));
    expect(afterAssign.positions).toEqual(mission.positions);
  });

  it("throws if slot structure is mutated during assignment", () => {
    const mission = buildMinimalGuardMission("17:30");
    const before = snapshotMissionStructure(mission);
    const mutated = snapshotMissionStructure({
      ...mission,
      positions: mission.positions.map((p) =>
        p.id === "patrol"
          ? {
              ...p,
              slots: p.slots.map((s) => ({ ...s, start_time: "18:00" })),
            }
          : p,
      ),
    });
    expect(() => assertMissionStructureUnchanged(before, mutated)).toThrow(
      /BUG: Smart Assignment modified mission slot structure/,
    );
  });

  for (const boardTime of missionStartVariants()) {
    it(`structure fingerprint unchanged for mission start ${boardTime}`, () => {
      const mission = buildMinimalGuardMission(boardTime);
      const structureBefore = snapshotMissionStructure(mission);
      if (validateMissionStructureForAssignment(mission).length) return;

      runGlobalAssign({
        missions: [mission],
        people: dummyPeople(40),
        issues: [],
        rules,
        meanPrior: 0,
        keepExisting: false,
        maxNodes: 5_000,
        maxAttempts: 1,
      });

      assertMissionStructureUnchanged(structureBefore, snapshotMissionStructure(mission));
    });
  }
});

describe("resolveMissionPositions without regenerateStructure", () => {
  it("does not rewrite persisted slot times on read path", async () => {
    const { resolveMissionPositions } = await import("@/lib/mission-templates");
    const mission = buildGuardMissionAtBoardStart("17:30");
    const customPositions = mission.positions.map((pos) => {
      if (pos.name !== "פטל") return pos;
      return {
        ...pos,
        slots: [{ id: "custom-patrol", start_time: "17:30", end_time: "18:00", seat_count: 1 }],
      };
    });

    const resolved = resolveMissionPositions({
      missionType: "guards",
      startsAt: mission.starts_at,
      endsAt: mission.ends_at,
      scheduling: mission.scheduling_rules,
      clientPositions: customPositions,
      regenerateStructure: false,
    });

    const patrol = resolved.find((p) => p.name === "פטל");
    expect(patrol?.slots[0]).toMatchObject({
      id: "custom-patrol",
      start_time: "17:30",
      end_time: "18:00",
      seat_count: 1,
    });
  });
});
