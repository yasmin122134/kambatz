import { describe, expect, it } from "vitest";
import { validateMissionStructureForAssignment } from "@/lib/mission-slot-structure";
import { carmelSlotFromMission } from "@/lib/guard-day-template";
import { resolveCanonicalSlotInterval, resolveSlotAbsoluteInterval } from "@/lib/time-interval";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

describe("resolveSlotAbsoluteInterval — 09:00 mission day", () => {
  const startsAt = "2026-08-21T09:00:00+03:00";
  const endsAt = "2026-08-22T09:00:00+03:00";
  /** As stored in DB after MissionEditor save (UTC Z). */
  const startsAtUtc = "2026-08-21T06:00:00.000Z";
  const endsAtUtc = "2026-08-22T06:00:00.000Z";

  it("Carmel 09:00–09:00 spans full mission window", () => {
    const iv = resolveSlotAbsoluteInterval(startsAt, endsAt, "09:00", "09:00");
    expect(iv).not.toBeNull();
    expect(iv!.startMs).toBe(Date.parse(startsAt));
    expect(iv!.endMs).toBe(Date.parse(endsAt));
  });

  it("works when mission ISO is UTC Z (Vercel server path)", () => {
    expect(resolveSlotAbsoluteInterval(startsAtUtc, endsAtUtc, "09:00", "09:00")).toEqual({
      startMs: Date.parse(startsAtUtc),
      endMs: Date.parse(endsAtUtc),
    });
    const officer = resolveSlotAbsoluteInterval(startsAtUtc, endsAtUtc, "21:00", "09:00");
    expect(officer).not.toBeNull();
    expect(officer!.endMs).toBe(Date.parse(endsAtUtc));
    expect(officer!.endMs - officer!.startMs).toBe(12 * 3_600_000);
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
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    expect(validateMissionStructureForAssignment(mission)).toEqual([]);
  });

  it("passes validation with UTC mission bounds and stale slot ISO", () => {
    const mission: MissionDay = {
      id: "g2",
      title: "utc",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAtUtc,
      ends_at: endsAtUtc,
      status: "draft",
      positions: [
        {
          id: "ca",
          name: "כרמל א׳ (כוננות)",
          kind: "standby_carmel_a",
          same_room: true,
          same_gender: true,
          slots: [
            {
              id: "ca1",
              start_time: "09:00",
              end_time: "09:00",
              seat_count: 3,
              // Stale bounds from an old 20:00 mission — should fall back to wall resolution.
              starts_at: "2026-08-20T17:00:00.000Z",
              ends_at: "2026-08-21T17:00:00.000Z",
            },
          ],
        },
        {
          id: "off",
          name: "קצין תורן",
          kind: "officer_duty",
          slots: [{ id: "o1", start_time: "21:00", end_time: "09:00", seat_count: 1 }],
        },
      ],
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    expect(validateMissionStructureForAssignment(mission)).toEqual([]);
  });
});
