import { describe, expect, it } from "vitest";
import { baseWorkWallClockInterval } from "@/lib/base-work-template";
import { resolveKitchenSlotInterval } from "@/lib/kitchen-day-template";
import { validateMissionStructureForAssignment } from "@/lib/mission-slot-structure";
import { buildGuardDayPositions, carmelSlotFromMission } from "@/lib/guard-day-template";
import { resolveCanonicalSlotInterval, resolveSlotAbsoluteInterval } from "@/lib/time-interval";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

describe("kitchen slot intervals", () => {
  it("uses mission_date not stale starts_at for calendar times", () => {
    const iv = resolveKitchenSlotInterval(
      "2026-08-25",
      "2026-08-23T06:00:00",
      "2026-08-23T22:00:00",
      { start_time: "10:00", end_time: "15:00" },
    );
    expect(iv).not.toBeNull();
    const start = new Date(iv!.startMs);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(start);
    const day = parts.find((p) => p.type === "day")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const year = parts.find((p) => p.type === "year")?.value;
    expect(`${year}-${month}-${day}`).toBe("2026-08-25");
  });
});

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

  it("officer duty 09:00–21:00 resolves on 09:00 guard day (naive ISO)", () => {
    const startsAt = "2026-03-01T09:00:00";
    const endsAt = "2026-03-02T09:00:00";
    const iv = resolveSlotAbsoluteInterval(startsAt, endsAt, "09:00", "21:00");
    expect(iv).not.toBeNull();
    expect(iv!.startMs).toBeGreaterThanOrEqual(Date.parse(startsAt));
    expect(iv!.endMs).toBeLessThanOrEqual(Date.parse(endsAt));
    expect(iv!.endMs - iv!.startMs).toBeGreaterThan(0);
  });

  it("officer duty 09:00–21:00 full twelve hours with +03:00 ISO", () => {
    const iv = resolveSlotAbsoluteInterval(
      "2026-03-01T09:00:00+03:00",
      "2026-03-02T09:00:00+03:00",
      "09:00",
      "21:00",
    );
    expect(iv).not.toBeNull();
    expect(iv!.endMs - iv!.startMs).toBe(12 * 3_600_000);
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
    const officer = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      boardStart: "09:00",
    }).find((p) => p.kind === "officer_duty")!;
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
          slots: officer.slots,
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
    const officer = buildGuardDayPositions({
      missionStartsAt: startsAtUtc,
      missionEndsAt: endsAtUtc,
      boardStart: "09:00",
    }).find((p) => p.kind === "officer_duty")!;
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
          slots: officer.slots,
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

describe("base work fixed wall-clock on mission_date", () => {
  it("always anchors 08:30–11:30 to mission_date regardless of guard window", () => {
    const iv = baseWorkWallClockInterval("2026-08-21", "08:30", "11:30");
    expect(iv).not.toBeNull();
    expect(new Date(iv!.startMs).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("08:30");
    expect(new Date(iv!.endMs).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("11:30");
  });

  it("validates all standard windows on a 20:00 guard day", () => {
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T20:00:00+03:00",
      ends_at: "2026-08-22T20:00:00+03:00",
      status: "draft",
      positions: [
        {
          id: "bw",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [
            { id: "b1", start_time: "08:30", end_time: "11:30", seat_count: 14 },
            { id: "b2", start_time: "13:30", end_time: "17:30", seat_count: 14 },
            { id: "b3", start_time: "18:30", end_time: "20:00", seat_count: 14 },
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
});

describe("base work on 09:00 guard day", () => {
  const startsAt = "2026-08-21T09:00:00+03:00";
  const endsAt = "2026-08-22T09:00:00+03:00";

  it("validates standard base work windows on mission_date", () => {
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "bw",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [
            { id: "b1", start_time: "08:30", end_time: "11:30", seat_count: 14 },
            { id: "b2", start_time: "13:30", end_time: "17:30", seat_count: 14 },
            { id: "b3", start_time: "18:30", end_time: "20:00", seat_count: 14 },
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
});
