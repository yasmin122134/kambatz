import { lockFilledSeats } from "@/lib/assignment-lock";
import { isBaseWorkPosition, isBaseWorkShiftSlot } from "@/lib/base-work-template";
import { isHamagshiyotPosition } from "@/lib/hamagshiyot-template";
import {
  defaultSchedulingForType,
  standardMissionPositions,
} from "@/lib/mission-templates";
import { defaultPositionKind, syncAssignmentSeats } from "@/lib/mission-utils";
import { isPatrolPosition } from "@/lib/patrol-day-template";
import {
  addCalendarDays,
  materializeSlotAbsoluteBounds,
  normalizeTimeLabel,
  parseIsoMs,
  parseTimeMinutes,
  resolveSlotAbsoluteInterval,
  wallClockIntervalOnCalendarDate,
} from "@/lib/time-interval";
import type { MissionDay, MissionPosition, MissionSlot } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import { readXlsxSheets, type XlsxSheetGrid } from "@/lib/xlsx-reader";

const HE_MONTHS: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

function uid(): string {
  return crypto.randomUUID();
}

export function normalizeHeName(value: string): string {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u00a0\u202a-\u202e]/g, "")
    .replace(/[׳'’]/g, "'")
    .replace(/[״""]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function splitAssigneeNames(raw: string): string[] {
  const text = normalizeHeName(raw);
  if (!text || text === "—" || text === "-" || text === "–") return [];
  return text
    .split(/\s*[·|,;]\s*/)
    .map((s) => normalizeHeName(s))
    .filter(Boolean);
}

export function parseTimeRange(raw: string): { start: string; end: string } | null {
  const m = String(raw)
    .trim()
    .match(/^(\d{1,2}:\d{2})\s*[–—\-−]\s*(\d{1,2}:\d{2})$/);
  if (!m) return null;
  const start = normalizeTimeLabel(m[1]);
  const end = normalizeTimeLabel(m[2]);
  if (parseTimeMinutes(start) === null || parseTimeMinutes(end) === null) return null;
  return { start, end };
}

export function parseHebrewMissionDate(text: string): string | null {
  const titled = String(text).match(/(\d{1,2})\s*ב([א-ת]+)\s*(\d{4})/);
  if (titled) {
    const month = HE_MONTHS[titled[2]];
    const day = Number(titled[1]);
    const year = Number(titled[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const dotted = String(text).match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const yearRaw = dotted[3] ? Number(dotted[3]) : 2026;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

export function resolveRosterName(raw: string, rosterNames: string[]): string {
  const wanted = normalizeHeName(raw);
  if (!wanted) return raw.trim();
  const exact = rosterNames.find((n) => normalizeHeName(n) === wanted);
  return exact ?? wanted;
}

type ExcelSlot = {
  start: string;
  end: string;
  names: string[];
  seats?: number;
  label?: string;
};

type ParsedLuachSheet = {
  title: string;
  date: string | null;
  boardStart: string;
  positions: { name: string; slots: ExcelSlot[] }[];
};

function pickSheet(sheets: XlsxSheetGrid[], re: RegExp): XlsxSheetGrid | undefined {
  return sheets.find((s) => re.test(s.name));
}

function headerRowIndex(rows: string[][], required: string[]): number {
  return rows.findIndex((row) => required.every((k) => row.some((c) => String(c).includes(k))));
}

function colIndex(header: string[], ...needles: string[]): number {
  return header.findIndex((c) => needles.some((n) => String(c).includes(n)));
}

function isLongFormHeader(header: string[]): boolean {
  const joined = header.join(" ");
  return joined.includes("עמדה") && /משובצ/.test(joined);
}

function parsePositionCell(raw: string): { name: string; label?: string } {
  const n = normalizeHeName(raw);
  const m = n.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (m && /פטרול/.test(m[1])) return { name: m[1], label: m[2] };
  return { name: n };
}

function skipForBoardStart(name: string): boolean {
  return /עבודות בסיס|חמגש/.test(name);
}

function inferBoardStart(entries: { start: string; end: string; name: string }[]): string {
  const fullDay = entries.find(
    (e) => e.start === e.end && (/כרמל/.test(e.name) || /קצין\s*תורן/.test(e.name)),
  );
  if (fullDay) return fullDay.start;
  if (entries.some((e) => e.start === "09:00" && !skipForBoardStart(e.name))) return "09:00";
  if (entries.some((e) => e.start === "20:00" && !skipForBoardStart(e.name))) return "20:00";
  const first = entries.find((e) => !skipForBoardStart(e.name));
  return first?.start || "09:00";
}

function parseLongFormSheet(sheet: XlsxSheetGrid): ParsedLuachSheet {
  const rows = sheet.rows;
  const title = rows[0]?.[0] || sheet.name;
  const date =
    parseHebrewMissionDate(title) ??
    parseHebrewMissionDate(sheet.name) ??
    parseHebrewMissionDate(rows.flat().join(" "));
  const hi = headerRowIndex(rows, ["עמדה"]);
  if (hi < 0) throw new Error("לא נמצאה שורת כותרת עם עמודת עמדה");

  const header = rows[hi] || [];
  const timeCol = Math.max(0, colIndex(header, "שעות", "התחלה"));
  const posCol = colIndex(header, "עמדה");
  const namesCol = colIndex(header, "משובצים");
  const namesColAlt = namesCol >= 0 ? namesCol : colIndex(header, "משובץ");
  const seatsCol = colIndex(header, "כמות", "קיבולת");
  if (posCol < 0 || namesColAlt < 0) {
    throw new Error("גיליון הלוח המלא חסר עמודות עמדה/משובצים");
  }

  const byName = new Map<string, ExcelSlot[]>();
  const boardEntries: { start: string; end: string; name: string }[] = [];

  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const range = parseTimeRange(row[timeCol] || "");
    const parsedPos = parsePositionCell(row[posCol] || "");
    if (!range || !parsedPos.name) continue;
    const names = splitAssigneeNames(row[namesColAlt] || "");
    if (!names.length) continue;
    const seatsRaw = seatsCol >= 0 ? Number(row[seatsCol]) : NaN;
    const list = byName.get(parsedPos.name) ?? [];
    list.push({
      start: range.start,
      end: range.end,
      names,
      seats: Number.isFinite(seatsRaw) && seatsRaw > 0 ? seatsRaw : names.length,
      label: parsedPos.label,
    });
    byName.set(parsedPos.name, list);
    boardEntries.push({ start: range.start, end: range.end, name: parsedPos.name });
  }

  if (!byName.size) throw new Error("לא נמצאו שיבוצים בגיליון הלוח המלא");

  return {
    title,
    date,
    boardStart: inferBoardStart(boardEntries),
    positions: [...byName.entries()].map(([name, slots]) => ({ name, slots })),
  };
}

function parseMatrixRosterSheet(sheet: XlsxSheetGrid): ParsedLuachSheet {
  const rows = sheet.rows;
  const title = rows[0]?.[0] || sheet.name;
  const date = parseHebrewMissionDate(title) ?? parseHebrewMissionDate(rows.flat().join(" "));
  const hi = headerRowIndex(rows, ["שעות"]);
  if (hi < 0) throw new Error("לא נמצאה שורת כותרת «שעות» בגיליון השמירות");

  const header = [...(rows[hi] || [])];
  const next = rows[hi + 1] || [];
  if (!parseTimeRange(next[0] || "")) {
    for (let i = 0; i < Math.max(header.length, next.length); i++) {
      if (!normalizeHeName(header[i] || "") && next[i]) header[i] = next[i];
    }
  }
  const positionCols: { index: number; name: string }[] = [];
  for (let i = 1; i < header.length; i++) {
    const name = normalizeHeName(header[i]);
    if (!name || name === "עולים לשמירה" || name === "סוג" || name === "עמדה") continue;
    if (/משובצ/.test(name) || name === "כמות" || name === "הערה") continue;
    positionCols.push({ index: i, name });
  }
  if (!positionCols.length) throw new Error("לא נמצאו עמדות בגיליון השמירות");

  const byName = new Map<string, ExcelSlot[]>();
  let boardStart = "09:00";
  let sawFirst = false;

  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const range = parseTimeRange(row[0] || "");
    if (!range) continue;
    if (!sawFirst) {
      boardStart = range.start;
      sawFirst = true;
    }
    for (const col of positionCols) {
      const names = splitAssigneeNames(row[col.index] || "");
      if (!names.length) continue;
      const list = byName.get(col.name) ?? [];
      list.push({ start: range.start, end: range.end, names });
      byName.set(col.name, list);
    }
  }

  return {
    title,
    date,
    boardStart,
    positions: positionCols
      .filter((c) => byName.has(c.name))
      .map((c) => ({ name: c.name, slots: byName.get(c.name) || [] })),
  };
}

function parseLuachSheet(sheet: XlsxSheetGrid): ParsedLuachSheet {
  const hi = Math.max(headerRowIndex(sheet.rows, ["שעות"]), headerRowIndex(sheet.rows, ["עמדה"]));
  const header = hi >= 0 ? sheet.rows[hi] || [] : [];
  if (isLongFormHeader(header)) return parseLongFormSheet(sheet);
  return parseMatrixRosterSheet(sheet);
}

function parseBaseWorkSheet(sheet: XlsxSheetGrid | undefined): ExcelSlot[] {
  if (!sheet) return [];
  const hi = headerRowIndex(sheet.rows, ["שעות"]);
  if (hi < 0) return [];
  const header = sheet.rows[hi] || [];
  if (isLongFormHeader(header)) return [];
  const namesCol = header.findIndex((c) => String(c).includes("משובץ"));
  const out: ExcelSlot[] = [];
  for (let r = hi + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const range = parseTimeRange(row[0] || "");
    if (!range) continue;
    if (String(row[0] || "").includes("צוער")) break;
    const names = splitAssigneeNames(row[namesCol >= 0 ? namesCol : 2] || "");
    if (!names.length) continue;
    out.push({ start: range.start, end: range.end, names });
  }
  return out;
}

function missionIso(date: string, time: string): string {
  const interval = wallClockIntervalOnCalendarDate(date, time, time === "00:00" ? "00:01" : time);
  const midnight = interval
    ? interval.startMs - (parseTimeMinutes(time) ?? 0) * 60_000
    : parseIsoMs(`${date}T12:00:00+03:00`);
  if (midnight == null) return `${date}T${time}:00+03:00`;
  const startMin = parseTimeMinutes(time) ?? 0;
  return new Date(midnight + startMin * 60_000).toISOString();
}

function materializeImportedSlot(
  start: string,
  end: string,
  seats: number,
  startsAt: string,
  endsAt: string,
  missionDate: string,
  label?: string,
): MissionSlot {
  const slot: MissionSlot = {
    id: uid(),
    start_time: start,
    end_time: end,
    seat_count: seats,
  };
  if (label) slot.label = label;
  const abs =
    resolveSlotAbsoluteInterval(startsAt, endsAt, start, end) ??
    wallClockIntervalOnCalendarDate(missionDate, start, end);
  if (abs) Object.assign(slot, materializeSlotAbsoluteBounds(slot, abs));
  return slot;
}

function findNamedPosition(positions: MissionPosition[], name: string): MissionPosition | undefined {
  const wanted = normalizeHeName(name);
  return (
    positions.find((p) => normalizeHeName(p.name) === wanted) ||
    positions.find(
      (p) =>
        normalizeHeName(p.name).includes(wanted) || wanted.includes(normalizeHeName(p.name)),
    )
  );
}

function keepTemplateSlots(pos: MissionPosition): boolean {
  if (pos.kind === "officer_duty") return true;
  if (pos.kind === "standby_carmel_a" || pos.kind === "standby_carmel_b") return true;
  if (isPatrolPosition(pos) || isHamagshiyotPosition(pos) || isBaseWorkPosition(pos)) return true;
  return false;
}

function slotMatchesExcel(
  slot: MissionSlot,
  excel: ExcelSlot,
  boardStart: string,
): boolean {
  const start = normalizeTimeLabel(slot.start_time);
  const end = normalizeTimeLabel(slot.end_time);
  if (start === excel.start && end === excel.end) return true;
  if (excel.start === excel.end && start === end) {
    return start === excel.start || start === boardStart;
  }
  if (excel.label && slot.label && excel.label === slot.label) return true;
  return false;
}

export type LuachImportDraft = Pick<
  MissionDay,
  | "title"
  | "mission_type"
  | "mission_date"
  | "starts_at"
  | "ends_at"
  | "positions"
  | "assignments"
  | "locked_seats"
  | "scheduling_rules"
  | "notes"
> & {
  unmatchedNames: string[];
  assignedSeatCount: number;
};

export function buildLuachImportDraft(
  sheets: XlsxSheetGrid[],
  rosterNames: string[] = [],
): LuachImportDraft {
  const rosterSheet =
    pickSheet(sheets, /לוח\s*מלא/) ||
    pickSheet(sheets, /פירוט שיבוץ/) ||
    pickSheet(sheets, /גלגול/) ||
    pickSheet(sheets, /שמיר/) ||
    sheets[0];
  if (!rosterSheet) throw new Error("הקובץ ריק");

  const parsed = parseLuachSheet(rosterSheet);
  const missionDate = parsed.date;
  if (!missionDate) throw new Error("לא הצלחתי לקרוא תאריך מגיליון השמירות");

  const boardStart = parsed.boardStart || "09:00";
  const nextDate = addCalendarDays(missionDate, 1);
  const startsAt = missionIso(missionDate, boardStart);
  const endsAt = missionIso(nextDate, boardStart);
  const scheduling = {
    ...defaultSchedulingForType("guards", startsAt),
    board_start: boardStart,
    duty_guard_gap_minutes: 30,
  };

  const positions = standardMissionPositions({
    missionType: "guards",
    startsAt,
    endsAt,
    scheduling,
    missionDate,
  });
  const assignments: Record<string, string[]> = {};
  const unmatched = new Set<string>();

  const resolve = (name: string): string => {
    const mapped = resolveRosterName(name, rosterNames);
    if (rosterNames.length && !rosterNames.some((n) => normalizeHeName(n) === normalizeHeName(mapped))) {
      unmatched.add(name);
    }
    return mapped;
  };

  for (const excelPos of parsed.positions) {
    const target = findNamedPosition(positions, excelPos.name);
    if (!target) continue;

    if (target.kind === "officer_duty") {
      const names: string[] = [];
      for (const slot of excelPos.slots) {
        for (const n of slot.names) {
          const mapped = resolve(n);
          if (!names.includes(mapped)) names.push(mapped);
        }
      }
      const slot = target.slots[0];
      if (slot) {
        slot.seat_count = Math.max(slot.seat_count, names.length, 2);
        assignments[slot.id] = names;
      }
      continue;
    }

    if (keepTemplateSlots(target)) {
      for (const excelSlot of excelPos.slots) {
        const slot =
          target.slots.find((s) => slotMatchesExcel(s, excelSlot, boardStart)) ||
          target.slots.find(
            (s) =>
              isBaseWorkPosition(target) &&
              isBaseWorkShiftSlot(excelSlot.start, excelSlot.end) &&
              normalizeTimeLabel(s.start_time) === excelSlot.start,
          );
        if (!slot) continue;
        slot.seat_count = Math.max(
          slot.seat_count,
          excelSlot.names.length,
          excelSlot.seats ?? 0,
        );
        assignments[slot.id] = excelSlot.names.map(resolve);
      }
      continue;
    }

    target.kind = defaultPositionKind("guards", target.name);
    target.slots = excelPos.slots.map((slot) => {
      const built = materializeImportedSlot(
        slot.start,
        slot.end,
        Math.max(1, slot.names.length, slot.seats ?? 0),
        startsAt,
        endsAt,
        missionDate,
        slot.label,
      );
      assignments[built.id] = slot.names.map(resolve);
      return built;
    });
  }

  const alreadyHasAbas = parsed.positions.some((p) => isBaseWorkPosition({ name: p.name }));
  if (!alreadyHasAbas) {
    const abasSlots = parseBaseWorkSheet(pickSheet(sheets, /עב/));
    const abas = positions.find((p) => isBaseWorkPosition(p));
    if (abas && abasSlots.length) {
      for (const excel of abasSlots) {
        const slot =
          abas.slots.find(
            (s) =>
              normalizeTimeLabel(s.start_time) === excel.start &&
              normalizeTimeLabel(s.end_time) === excel.end,
          ) ||
          abas.slots.find(
            (s) => isBaseWorkShiftSlot(excel.start, excel.end) && s.start_time === excel.start,
          );
        if (!slot) continue;
        slot.seat_count = Math.max(slot.seat_count, excel.names.length);
        assignments[slot.id] = excel.names.map(resolve);
      }
    }
  }

  const synced = syncAssignmentSeats(positions, assignments);
  const assignedSeatCount = Object.values(synced).reduce(
    (n, seats) => n + seats.filter(Boolean).length,
    0,
  );

  return {
    title: parsed.title.includes(missionDate)
      ? parsed.title
      : `${parsed.title}`.replace(/\s+$/, "") || `${missionDate} · שמירות+עב״ס`,
    mission_type: "guards",
    mission_date: missionDate,
    starts_at: startsAt,
    ends_at: endsAt,
    positions,
    assignments: synced,
    locked_seats: lockFilledSeats(positions, synced),
    scheduling_rules: {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      ...scheduling,
    },
    notes: "יובא מקובץ לוח שמירות מאומת",
    unmatchedNames: [...unmatched],
    assignedSeatCount,
  };
}

export function parseLuachXlsx(bytes: Uint8Array, rosterNames: string[] = []): LuachImportDraft {
  return buildLuachImportDraft(readXlsxSheets(bytes), rosterNames);
}
