import { describe, expect, it } from "vitest";
import {
  collectPersonAssignmentRows,
  listAvailableAssignmentSlots,
} from "@/lib/person-assignments";
import type { MissionDay } from "@/lib/types";

function mission(partial: Partial<MissionDay> & Pick<MissionDay, "id">): MissionDay {
  return {
    title: "שמירות",
    status: "published",
    notes: "",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T20:00:00+03:00",
    ends_at: "2026-08-22T20:00:00+03:00",
    positions: [
      {
        id: "pos1",
        name: "שער אחורי",
        kind: "guard",
        slots: [{ id: "slot1", start_time: "20:00", end_time: "22:00", seat_count: 2 }],
      },
    ],
    assignments: { slot1: ["Alice", ""] },
    created_at: "",
    updated_at: "",
    scheduling_rules: {
      rest_hours: 7,
      guard_ratio: 2,
      board_start: "20:00",
      shift_hours: 4,
    },
    ...partial,
  };
}

describe("person-assignments", () => {
  it("collectPersonAssignmentRows finds assignee with seat index", () => {
    const rows = collectPersonAssignmentRows("Alice", [mission({ id: "m1" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].seatIndex).toBe(0);
    expect(rows[0].timeLabel).toBe("20:00–22:00");
  });

  it("listAvailableAssignmentSlots lists empty seats", () => {
    const slots = listAvailableAssignmentSlots([mission({ id: "m1" })]);
    expect(slots).toHaveLength(1);
    expect(slots[0].seatIndex).toBe(1);
  });
});
