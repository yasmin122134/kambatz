import { describe, expect, it } from "vitest";
import {
  reconcileAssignmentsOnStructureChange,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import type { MissionPosition } from "@/lib/types";

describe("reconcileAssignmentsOnStructureChange", () => {
  const prev: MissionPosition[] = [
    {
      id: "p1",
      name: "פטל",
      kind: "guard",
      slots: [
        { id: "s1", start_time: "13:00", end_time: "18:00", seat_count: 1 },
        { id: "s2", start_time: "18:00", end_time: "22:00", seat_count: 1 },
      ],
    },
  ];

  it("clears assignments when slot window changes", () => {
    const next: MissionPosition[] = [
      {
        ...prev[0],
        slots: [
          { id: "s1", start_time: "13:00", end_time: "17:00", seat_count: 1 },
          { id: "s2", start_time: "17:00", end_time: "18:00", seat_count: 1 },
          { id: "s3", start_time: "18:00", end_time: "22:00", seat_count: 1 },
        ],
      },
    ];
    const out = reconcileAssignmentsOnStructureChange(prev, next, {
      s1: ["א׳"],
      s2: ["ב׳"],
    });
    expect(out.s1).toEqual([""]);
    expect(out.s2).toEqual([""]);
    expect(out.s3).toEqual([""]);
  });

  it("keeps assignments for unchanged slot windows", () => {
    const next: MissionPosition[] = [
      {
        ...prev[0],
        slots: [
          { id: "s1", start_time: "13:00", end_time: "18:00", seat_count: 1 },
          { id: "s2", start_time: "18:00", end_time: "22:00", seat_count: 1 },
        ],
      },
    ];
    const out = reconcileAssignmentsOnStructureChange(prev, next, {
      s1: ["א׳"],
      s2: ["ב׳"],
    });
    expect(out.s1).toEqual(["א׳"]);
    expect(out.s2).toEqual(["ב׳"]);
  });

  it("syncAssignmentSeats drops orphan slot ids", () => {
    const positions: MissionPosition[] = [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        slots: [{ id: "s1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
      },
    ];
    const out = syncAssignmentSeats(positions, {
      s1: ["א׳"],
      old: ["ב׳"],
    });
    expect(Object.keys(out)).toEqual(["s1"]);
    expect(out.s1).toEqual(["א׳"]);
  });
});
