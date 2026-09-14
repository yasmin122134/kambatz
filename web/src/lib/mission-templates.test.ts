import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  missionPositionsNeedTemplateFill,
  resolveMissionPositions,
  shouldRegenerateGuardStructure,
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
});
