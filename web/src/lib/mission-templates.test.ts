import { describe, expect, it } from "vitest";
import { isBaseWorkPosition } from "@/lib/base-work-template";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  defaultMissionWindow,
  defaultSchedulingForType,
  generateGuardMissionStructure,
  missionPositionsNeedTemplateFill,
  resolveMissionPositions,
  shouldRegenerateGuardStructure,
  standardMissionPositions,
} from "@/lib/mission-templates";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const scheduling = {
  ...DEFAULT_MISSION_SCHEDULING_RULES,
  board_start: "20:00",
  shift_hours: 4,
};

describe("shouldRegenerateGuardStructure", () => {
  const existing = {
    starts_at: "2026-09-14T20:00:00+03:00",
    ends_at: "2026-09-15T20:00:00+03:00",
    scheduling_rules: scheduling,
  };

  it("does not regenerate when ISO format differs but the minute is the same", () => {
    expect(
      shouldRegenerateGuardStructure(existing, {
        starts_at: "2026-09-14T17:00:00.000Z",
        ends_at: "2026-09-15T17:00:00.000Z",
        scheduling_rules: scheduling,
      }),
    ).toBe(false);
  });

  it("does not regenerate when only slot hours changed (same window and rules)", () => {
    expect(
      shouldRegenerateGuardStructure(
        existing,
        {
          starts_at: existing.starts_at,
          ends_at: existing.ends_at,
          scheduling_rules: scheduling,
        },
        false,
      ),
    ).toBe(false);
  });

  it("regenerates when the user explicitly synced structure", () => {
    expect(
      shouldRegenerateGuardStructure(existing, existing, true),
    ).toBe(true);
  });

  it("regenerates when shift length actually changed", () => {
    expect(
      shouldRegenerateGuardStructure(existing, {
        ...existing,
        scheduling_rules: { ...scheduling, shift_hours: 6 },
      }),
    ).toBe(true);
  });
});

describe("resolveMissionPositions preserves custom hours", () => {
  it("keeps edited slot times when regenerateStructure is false", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      shiftHours: 4,
      missionStartsAt: "2026-09-14T20:00:00+03:00",
      missionEndsAt: "2026-09-15T20:00:00+03:00",
    });
    const next = positions.map((pos) =>
      pos.name !== "פטל"
        ? pos
        : {
            ...pos,
            slots: pos.slots.map((s, i) =>
              i === 0 ? { ...s, start_time: "21:00", end_time: "01:00" } : s,
            ),
          },
    );

    const resolved = resolveMissionPositions({
      missionType: "guards",
      startsAt: "2026-09-14T17:00:00.000Z",
      endsAt: "2026-09-15T17:00:00.000Z",
      scheduling,
      clientPositions: next,
      regenerateStructure: false,
    });

    const petal = resolved.find((p) => p.name === "פטל");
    expect(petal?.slots[0]).toMatchObject({ start_time: "21:00", end_time: "01:00" });
  });
});

describe("missionPositionsNeedTemplateFill", () => {
  it("does not treat custom shift hours as a missing template", () => {
    const positions = buildGuardDayPositions({
      boardStart: "20:00",
      shiftHours: 4,
      missionStartsAt: "2026-09-14T20:00:00+03:00",
      missionEndsAt: "2026-09-15T20:00:00+03:00",
    });
    const customized = positions.map((pos) =>
      pos.name.includes("רכב אחורי")
        ? {
            ...pos,
            slots: [{ id: "custom", start_time: "22:00", end_time: "02:00", seat_count: 2 }],
          }
        : pos,
    );
    expect(missionPositionsNeedTemplateFill("guards", customized)).toBe(false);
  });

  it("does not treat a guard day without עב״ס as a missing template", () => {
    const positions = buildGuardDayPositions({
      boardStart: "09:00",
      shiftHours: 4,
      missionStartsAt: "2026-09-11T09:00:00+03:00",
      missionEndsAt: "2026-09-12T09:00:00+03:00",
    }).filter((p) => !isBaseWorkPosition(p));
    expect(positions.some(isBaseWorkPosition)).toBe(false);
    expect(missionPositionsNeedTemplateFill("guards", positions)).toBe(false);
  });
});

describe("generateGuardMissionStructure keeps deleted עב״ס gone", () => {
  it("does not restore default ABAS windows after they were stripped", () => {
    const startsAt = "2026-09-11T09:00:00+03:00";
    const endsAt = "2026-09-12T09:00:00+03:00";
    const positions = standardMissionPositions({
      missionType: "guards",
      startsAt,
      endsAt,
      scheduling: defaultSchedulingForType("guards", startsAt),
      missionDate: "2026-09-11",
    }).filter((p) => !isBaseWorkPosition(p));
    expect(positions.some(isBaseWorkPosition)).toBe(false);
    const regenerated = generateGuardMissionStructure(positions, {
      missionDate: "2026-09-11",
      startsAt,
      endsAt,
    });
    expect(regenerated.some(isBaseWorkPosition)).toBe(false);
  });
});

describe("default guard day window", () => {
  it("starts at 09:00 and ends at 09:00 the next calendar day", () => {
    expect(defaultMissionWindow("guards", "2026-09-11")).toEqual({
      missionDate: "2026-09-11",
      startsAt: "2026-09-11T09:00",
      endsAt: "2026-09-12T09:00",
    });
    expect(defaultMissionWindow("guards", "2026-09-30").endsAt).toBe("2026-10-01T09:00");
  });

  it("syncs front gate to six 4-hour shifts with two seats", () => {
    const startsAt = "2026-09-11T09:00:00+03:00";
    const endsAt = "2026-09-12T09:00:00+03:00";
    const positions = standardMissionPositions({
      missionType: "guards",
      startsAt,
      endsAt,
      scheduling: defaultSchedulingForType("guards", startsAt),
      missionDate: "2026-09-11",
    });
    const front = positions.find((p) => p.name.includes("רכב קדמי"));
    expect(front?.slots.map((s) => `${s.start_time}–${s.end_time}`)).toEqual([
      "09:00–13:00",
      "13:00–17:00",
      "17:00–21:00",
      "21:00–01:00",
      "01:00–05:00",
      "05:00–09:00",
    ]);
    expect(front?.slots.every((s) => s.seat_count === 2)).toBe(true);
  });
});
