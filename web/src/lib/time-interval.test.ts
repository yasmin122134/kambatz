import { describe, expect, it } from "vitest";
import { validateMissionStructureForAssignment } from "@/lib/mission-slot-structure";
import { carmelSlotFromMission } from "@/lib/guard-day-template";
import { resolveCanonicalSlotInterval, resolveSlotAbsoluteInterval } from "@/lib/time-interval";
import type { MissionDay } from "@/lib/types";

describe("resolveSlotAbsoluteInterval — 09:00 mission day", () => {
  const startsAt = "2026-08-21T09:00:00+03:00";
  const endsAt = "2026-08-22T09:00:00+03:00";

  it("Carmel 09:00–09:00 spans full mission window", () => {
    const iv = resolveSlotAbsoluteInterval(startsAt, endsAt, "09:00", "09:00");
    expect(iv).not.toBeNull();
    expect(iv!.startMs).toBe(Date.parse(startsAt));
    expect(iv!.endMs).toBe(Date.parse(endsAt));
  });

  it("officer duty 21:00–09:00 ends at mission end", () => {
    const iv = resolveSlotAbsoluteInterval(startsAt, endsAt, "21:00", "09:00");
    expect(iv).not.toBeNull();
    expect(iv!.endMs).toBe(Date.parse(endsAt));
    expect(iv!.endMs - iv!.startMs).toBe(12 * 3_600_000);
  });

  it("carmelSlotFromMission materializes mission bounds", () => {
    const slot = carmelSlotFromMission(startsAt, endsAt, "09:00", 3);
    const iv = resolveCanonicalSlotInterval({ starts_at: startsAt, ends_at: endsAt }, slot);
    expect(iv?.startMs).toBe(Date.parse(startsAt));
    expect(iv?.endMs).toBe(Date.parse(endsAt));
  });

  it("passes mission structure validation for carmel + officer", () => {
    const carmel = carmelSlotFromMission(startsAt, endsAt, "09:00", 3);
    const mission: MissionDay = {
      id: "g1",
      title: "test",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "ca",
          name: "כרמל א׳ (כוננות)",
          kind: "standby_carmel_a",
          same_room: true,
          same_gender: true,
          slots: [carmel],
        },
        {
          id: "cb",
          name: "כרמל ב׳ (כוננות)",
          kind: "standby_carmel_b",
          same_room: true,
          same_gender: true,
          slots: [{ ...carmel, id: "cb-slot" }],
        },
        {
          id: "off",
          name: "קצין תורן",
          kind: "officer_duty",
          slots: [
            {
              id: "o1",
              start_time: "21:00",
              end_time: "09:00",
              seat_count: 1,
            },
          ],
        },
      ],
      assignments: {},
      scheduling_rules: {},
      notes: null,
      created_at: "",
      updated_at: "",
    };
    expect(validateMissionStructureForAssignment(mission)).toEqual([]);
  });
});
