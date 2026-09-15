import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLuachImportDraft,
  parseHebrewMissionDate,
  parseLuachXlsx,
  parseTimeRange,
  splitAssigneeNames,
} from "@/lib/luach-xlsx-import";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { writeXlsx } from "@/lib/xlsx-writer";
import { readXlsxSheets } from "@/lib/xlsx-reader";
import { guardDayHasRequiredPositions } from "@/lib/mission-templates";

const MATRIX_FILE = "C:/Users/yasmi/Downloads/luach_shmirot_11-09_validated_v2.xlsx";
const FULL_FILE = "C:/Users/yasmi/Downloads/luach_shmirot_11-09_full_valid.xlsx";

function sampleWorkbook(): Uint8Array {
  return writeXlsx([
    {
      name: "גלגולי שמירה",
      rows: [
        [{ v: "יום שישי, 11 בספטמבר 2026 · שיבוץ תקין" }],
        [{ v: "" }],
        [
          { v: "שעות" },
          { v: "ש״ג רכב אחורי" },
          { v: "פטל" },
          { v: "קצין תורן" },
        ],
        [{ v: "09:00–13:00" }, { v: "אדר קדוש" }, { v: "מאיה אפשטיין" }, { v: "" }],
        [{ v: "09:00–21:00" }, { v: "" }, { v: "" }, { v: "רני פלג" }],
        [{ v: "13:00–17:00" }, { v: "אמיר בסון" }, { v: "יאיר קצוביץ'" }, { v: "" }],
        [{ v: "21:00–09:00" }, { v: "" }, { v: "" }, { v: "יסמין חדד" }],
      ],
    },
    {
      name: "עב״ס",
      rows: [
        [{ v: "עבודות בסיס" }],
        [{ v: "" }],
        [{ v: "שעות" }, { v: "כמות" }, { v: "משובצים" }],
        [{ v: "08:30–11:30" }, { v: "2" }, { v: "אביב פרידמן · אוהד בר-און" }],
      ],
    },
  ]);
}

function fullBoardWorkbook(): Uint8Array {
  return writeXlsx([
    {
      name: "לוח מלא 11.9",
      rows: [
        [{ v: "לוח תורנויות מלא — יום שישי 11.9.2026" }],
        [{ v: "" }],
        [
          { v: "שעות" },
          { v: "סוג" },
          { v: "עמדה" },
          { v: "משובצים" },
          { v: "כמות" },
        ],
        [
          { v: "08:30–11:30" },
          { v: "עב״ס" },
          { v: "עבודות בסיס" },
          { v: "אביב פרידמן · אוהד בר-און" },
          { v: "2" },
        ],
        [
          { v: "09:00–13:00" },
          { v: "שמירה" },
          { v: "ש״ג רכב אחורי" },
          { v: "אורי מרקוביץ" },
          { v: "1" },
        ],
        [
          { v: "09:00–09:00" },
          { v: "כרמל א׳ (כוננות)" },
          { v: "כרמל א׳ (כוננות)" },
          { v: "אדר קדוש · גפן פרומקס · עמית בן סימון" },
          { v: "3" },
        ],
        [
          { v: "09:00–09:00" },
          { v: "קצין תורן" },
          { v: "קצין תורן" },
          { v: "רני פלג · יסמין חדד" },
          { v: "2" },
        ],
        [
          { v: "09:30–10:00" },
          { v: "פטרולים" },
          { v: "פטרולים (סיור פנים גדר)" },
          { v: "רני פלג" },
          { v: "1" },
        ],
      ],
    },
  ]);
}

describe("luach xlsx import", () => {
  it("parses Hebrew dates and time ranges", () => {
    expect(parseHebrewMissionDate("יום שישי, 11 בספטמבר 2026 · שיבוץ תקין")).toBe(
      "2026-09-11",
    );
    expect(parseHebrewMissionDate("בדיקת אילוצים — 11.9")).toBe("2026-09-11");
    expect(parseTimeRange("09:00–13:00")).toEqual({ start: "09:00", end: "13:00" });
    expect(parseTimeRange("21:00-00:00")).toEqual({ start: "21:00", end: "00:00" });
    expect(splitAssigneeNames("מעיין משה · עומר חתם")).toEqual(["מעיין משה", "עומר חתם"]);
  });

  it("reads store-compressed xlsx sheets written by the app", () => {
    const sheets = readXlsxSheets(sampleWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(["גלגולי שמירה", "עב״ס"]);
    expect(sheets[0].rows[3][1]).toBe("אדר קדוש");
  });

  it("builds a 09:00 guard day with excel slots and names", () => {
    const draft = parseLuachXlsx(sampleWorkbook(), ["אדר קדוש", "רני פלג", "יסמין חדד"]);
    expect(draft.mission_date).toBe("2026-09-11");
    expect(draft.scheduling_rules.board_start).toBe("09:00");
    expect(new Date(draft.starts_at).getUTCHours()).toBe(6);
    expect(guardDayHasRequiredPositions(draft.positions)).toBe(true);

    const rear = draft.positions.find((p) => p.name.includes("רכב אחורי"));
    expect(rear?.slots.map((s) => `${s.start_time}-${s.end_time}`)).toEqual([
      "09:00-13:00",
      "13:00-17:00",
    ]);
    expect(draft.assignments[rear!.slots[0].id]).toEqual(["אדר קדוש"]);

    const officer = draft.positions.find((p) => p.kind === "officer_duty");
    expect(officer?.slots).toHaveLength(1);
    expect(draft.assignments[officer!.slots[0].id]).toEqual(["רני פלג", "יסמין חדד"]);

    const abas = draft.positions.find((p) => p.name.includes("עבודות בסיס"));
    const morning = abas?.slots.find((s) => s.start_time === "08:30");
    expect((draft.assignments[morning!.id] || []).filter(Boolean)).toEqual([
      "אביב פרידמן",
      "אוהד בר-און",
    ]);
    expect(draft.assignedSeatCount).toBeGreaterThanOrEqual(6);
  });

  it("imports a long-form full board without treating 08:30 ABAS as board start", () => {
    const draft = parseLuachXlsx(fullBoardWorkbook());
    expect(draft.mission_date).toBe("2026-09-11");
    expect(draft.scheduling_rules.board_start).toBe("09:00");

    const rear = draft.positions.find((p) => p.name.includes("רכב אחורי"))!;
    expect(draft.assignments[rear.slots[0].id]).toEqual(["אורי מרקוביץ"]);

    const carmel = draft.positions.find((p) => p.kind === "standby_carmel_a")!;
    expect((draft.assignments[carmel.slots[0].id] || []).filter(Boolean)).toEqual([
      "אדר קדוש",
      "גפן פרומקס",
      "עמית בן סימון",
    ]);

    const patrol = draft.positions.find((p) => p.name.includes("פטרול"))!;
    const firstTour = patrol.slots.find((s) => s.start_time === "09:30");
    expect((draft.assignments[firstTour!.id] || []).filter(Boolean)).toEqual(["רני פלג"]);
  });

  it("imports the validated 11-09 workbook when present", () => {
    if (!existsSync(MATRIX_FILE)) return;
    const bytes = new Uint8Array(readFileSync(MATRIX_FILE));
    const draft = parseLuachXlsx(bytes);
    expect(draft.mission_date).toBe("2026-09-11");
    expect(draft.scheduling_rules.board_start).toBe("09:00");

    const rear = draft.positions.find((p) => p.name.includes("רכב אחורי"))!;
    const morning = rear.slots.find((s) => s.start_time === "09:00" && s.end_time === "13:00");
    expect(draft.assignments[morning!.id]).toEqual(["אדר קדוש"]);

    const nightPair = rear.slots.find((s) => s.start_time === "18:00" && s.end_time === "21:00");
    expect(draft.assignments[nightPair!.id]).toEqual(["יהונתן אדיב", "יהונתן הלוי"]);

    const foot = draft.positions.find((p) => p.name.includes("רגלי"))!;
    expect(foot.slots.some((s) => s.start_time === "17:00" && s.end_time === "19:00")).toBe(true);

    const officer = draft.positions.find((p) => p.kind === "officer_duty")!;
    expect(draft.assignments[officer.slots[0].id]).toEqual(["רני פלג", "יסמין חדד"]);

    const abas = draft.positions.find((p) => p.name.includes("עבודות בסיס"))!;
    const first = abas.slots.find((s) => s.start_time === "08:30")!;
    expect(draft.assignments[first.id]).toHaveLength(20);
    expect(draft.assignedSeatCount).toBeGreaterThan(80);

    const flat = flattenMissionSlots({
      ...draft,
      id: "import",
      status: "draft",
      created_at: "",
      updated_at: "",
    });
    expect(flat.some((s) => s.assignees.includes("אדר קדוש"))).toBe(true);
  });

  it("imports the full-valid 11-09 workbook when present", () => {
    if (!existsSync(FULL_FILE)) return;
    const bytes = new Uint8Array(readFileSync(FULL_FILE));
    const draft = parseLuachXlsx(bytes);
    expect(draft.mission_date).toBe("2026-09-11");
    expect(draft.scheduling_rules.board_start).toBe("09:00");

    const carmelA = draft.positions.find((p) => p.kind === "standby_carmel_a")!;
    expect((draft.assignments[carmelA.slots[0].id] || []).filter(Boolean)).toEqual([
      "אדר קדוש",
      "גפן פרומקס",
      "עמית בן סימון",
    ]);

    const carmelB = draft.positions.find((p) => p.kind === "standby_carmel_b")!;
    expect((draft.assignments[carmelB.slots[0].id] || []).filter(Boolean)).toContain("אייקו שלו");

    const rear = draft.positions.find((p) => p.name.includes("רכב אחורי"))!;
    const morning = rear.slots.find((s) => s.start_time === "09:00" && s.end_time === "13:00");
    expect(draft.assignments[morning!.id]).toEqual(["אורי מרקוביץ"]);

    const abas = draft.positions.find((p) => p.name.includes("עבודות בסיס"))!;
    const first = abas.slots.find((s) => s.start_time === "08:30")!;
    expect((draft.assignments[first.id] || []).filter(Boolean)).toHaveLength(20);

    const ham = draft.positions.find((p) => p.name.includes("חמגש"))!;
    const breakfast = ham.slots.find((s) => s.start_time === "07:00")!;
    expect((draft.assignments[breakfast.id] || []).filter(Boolean)).toHaveLength(5);

    const officer = draft.positions.find((p) => p.kind === "officer_duty")!;
    expect(draft.assignments[officer.slots[0].id]).toEqual(["רני פלג", "יסמין חדד"]);

    expect(draft.assignedSeatCount).toBeGreaterThan(120);
  });
});

describe("buildLuachImportDraft", () => {
  it("throws without a hours header", () => {
    expect(() =>
      buildLuachImportDraft([{ name: "גלגולי שמירה", rows: [["אין כותרת"]] }]),
    ).toThrow(/שעות/);
  });
});
