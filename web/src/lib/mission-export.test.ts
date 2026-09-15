import { describe, expect, it } from "vitest";
import {
  buildMissionExportTables,
  buildMissionExportXlsx,
  formatMissionDateHe,
  missionExportFilename,
  missionsForDayExcelExport,
  missionsForExcelExport,
} from "@/lib/mission-export";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function guardMission(
  slots: { id: string; start: string; end: string; seats?: number }[],
  assignments: Record<string, string[]>,
  extras?: Partial<MissionDay>,
): MissionDay {
  return {
    id: "g1",
    title: "שמירות+עב״ס",
    mission_type: "guards",
    mission_date: "2026-09-14",
    starts_at: "2026-09-14T20:00:00+03:00",
    ends_at: "2026-09-15T20:00:00+03:00",
    status: "published",
    positions: [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: s.id,
          start_time: s.start,
          end_time: s.end,
          seat_count: s.seats ?? 1,
        })),
      },
      {
        id: "p2",
        name: "תצפיתן",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: `t-${s.id}`,
          start_time: s.start,
          end_time: s.end,
          seat_count: 1,
        })),
      },
    ],
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
    ...extras,
  };
}

describe("mission excel export", () => {
  it("formats Hebrew dates from ISO without depending on host locale", () => {
    expect(formatMissionDateHe("2026-09-14")).toBe("יום שני, 14 בספטמבר 2026");
  });

  it("builds a shift matrix with positions as columns", () => {
    const mission = guardMission(
      [
        { id: "s1", start: "20:00", end: "00:00" },
        { id: "s2", start: "00:00", end: "04:00" },
      ],
      {
        s1: ["Alice"],
        "t-s1": ["Bob"],
        s2: ["Carl"],
      },
    );
    const tables = buildMissionExportTables([mission]);
    const roster = tables.find((t) => t.name === "גלגולי שמירה");
    expect(roster).toBeTruthy();
    const header = roster!.rows.find((r) => r.kind === "header");
    expect(header?.cells).toEqual(["שעות", "פטל", "תצפיתן", "עולים לשמירה"]);
    const data = roster!.rows.filter((r) => r.kind === "data");
    expect(data[0]?.cells).toEqual([
      "20:00–00:00",
      "Alice",
      "Bob",
      "Alice · Bob",
    ]);
    expect(data[1]?.cells[1]).toBe("Carl");
    expect(data[1]?.cells[2]).toBe("—");
  });

  it("lists every assigned person on the per-cadet sheet", () => {
    const mission = guardMission(
      [{ id: "s1", start: "20:00", end: "00:00" }],
      { s1: ["Alice"], "t-s1": ["Bob"] },
    );
    const byPerson = buildMissionExportTables([mission]).find(
      (t) => t.name === "לפי צוער",
    );
    const names = byPerson!.rows
      .filter((r) => r.kind === "data")
      .map((r) => r.cells[0]);
    expect(names).toEqual(["Alice", "Bob"]);
  });

  it("skips a linked standalone base-work mission that is already embedded", () => {
    const guards = guardMission([{ id: "s1", start: "20:00", end: "00:00" }], {
      s1: ["Alice"],
    });
    guards.scheduling_rules = {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      linked_mission_id: "bw1",
    };
    const baseWork: MissionDay = {
      id: "bw1",
      title: "עב״ס",
      mission_type: "base_work",
      mission_date: "2026-09-14",
      starts_at: "2026-09-14T08:30:00+03:00",
      ends_at: "2026-09-14T20:00:00+03:00",
      status: "published",
      positions: [],
      assignments: {},
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    expect(missionsForExcelExport([guards, baseWork]).map((m) => m.id)).toEqual([
      "g1",
    ]);
  });

  it("names the file with the date range of visible missions", () => {
    const a = guardMission([{ id: "s1", start: "20:00", end: "00:00" }], {});
    const b = guardMission([{ id: "s1", start: "20:00", end: "00:00" }], {}, {
      id: "g2",
      mission_date: "2026-09-16",
    });
    expect(missionExportFilename([a])).toBe("luach-shmirot-2026-09-14.xlsx");
    expect(missionExportFilename([a, b])).toBe(
      "luach-shmirot-2026-09-14-2026-09-16.xlsx",
    );
  });

  it("keeps only the selected mission date when exporting a board day", () => {
    const selected = guardMission(
      [{ id: "s1", start: "20:00", end: "00:00" }],
      { s1: ["Alice"] },
    );
    const previous = guardMission(
      [{ id: "s1", start: "20:00", end: "00:00" }],
      { s1: ["Dana"] },
      {
        id: "g-prev",
        mission_date: "2026-09-13",
        starts_at: "2026-09-13T20:00:00+03:00",
        ends_at: "2026-09-14T20:00:00+03:00",
        title: "יום קודם",
      },
    );
    const scoped = missionsForDayExcelExport([previous, selected], "2026-09-14");
    expect(scoped.map((m) => m.id)).toEqual(["g1"]);
    const tables = buildMissionExportTables(scoped);
    const text = tables
      .flatMap((t) => t.rows.flatMap((r) => r.cells))
      .join(" ");
    expect(text).toContain("Alice");
    expect(text).not.toContain("Dana");
    expect(text).toContain("14 בספטמבר");
    expect(text).not.toContain("13 בספטמבר");
    expect(missionExportFilename(scoped)).toBe("luach-shmirot-2026-09-14.xlsx");
  });

  it("writes a zip-based xlsx with a PK header", () => {
    const mission = guardMission(
      [{ id: "s1", start: "20:00", end: "00:00" }],
      { s1: ["Alice"] },
    );
    const bytes = buildMissionExportXlsx([mission]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(200);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("גלגולי שמירה");
    expect(text).toContain("פירוט שיבוצים");
    expect(text).toContain("לפי צוער");
    expect(text).toContain('rightToLeft="1"');
    expect(text).toContain("Alice");
  });
});
