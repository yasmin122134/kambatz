import { guardShiftRosterViews } from "@/lib/guard-shift-roster";
import { kitchenShiftRosterViews } from "@/lib/kitchen-handoffs";
import {
  effectiveBoardStartMin,
  flattenMissionSlots,
  type FlatSlot,
} from "@/lib/mission-utils";
import {
  MISSION_POSITION_KIND_LABELS,
  type MissionDay,
} from "@/lib/types";
import {
  colName,
  triggerBrowserDownload,
  writeXlsx,
  type XlsxCell,
  type XlsxSheet,
  type XlsxStyle,
} from "@/lib/xlsx-writer";

const HE_WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

const EMPTY = "—";

export type ExportRowKind = "title" | "section" | "header" | "data" | "muted" | "blank";

export type MissionExportTable = {
  name: string;
  rows: { kind: ExportRowKind; cells: string[] }[];
};

function compareHe(a: string, b: string): number {
  return a.localeCompare(b, "he");
}

export function formatMissionDateHe(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const weekday = HE_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const month = HE_MONTHS[m - 1];
  return `יום ${weekday}, ${d} ב${month} ${y}`;
}

export function weekdayHe(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return HE_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

function joinNames(names: string[]): string {
  return names.filter((n) => n?.trim()).join(" · ");
}

/** Hide standalone עב״ס that's already embedded in the matching guard day. */
export function missionsForExcelExport(missions: MissionDay[]): MissionDay[] {
  const linked = new Set(
    missions
      .filter((m) => m.mission_type === "guards")
      .map((m) => m.scheduling_rules?.linked_mission_id)
      .filter((id): id is string => Boolean(id)),
  );
  return missions
    .filter((m) => !linked.has(m.id))
    .slice()
    .sort(
      (a, b) =>
        a.mission_date.localeCompare(b.mission_date) ||
        a.mission_type.localeCompare(b.mission_type) ||
        a.title.localeCompare(b.title, "he"),
    );
}

function flattenedSlots(mission: MissionDay): FlatSlot[] {
  return flattenMissionSlots(mission, effectiveBoardStartMin(mission));
}

function kindLabel(slot: FlatSlot): string {
  if (slot.missionType === "base_work") return "עב״ס";
  if (slot.missionType === "kitchen") return "מטבח";
  return MISSION_POSITION_KIND_LABELS[slot.positionKind] ?? slot.positionKind;
}

function positionHeaderOrder(mission: MissionDay): { id: string; name: string }[] {
  const views = guardShiftRosterViews(mission);
  const seen = new Set<string>();
  const fromViews: { id: string; name: string }[] = [];
  for (const view of views) {
    for (const pos of view.positions) {
      if (seen.has(pos.positionId)) continue;
      seen.add(pos.positionId);
      fromViews.push({ id: pos.positionId, name: pos.positionName });
    }
  }
  const order = new Map((mission.positions || []).map((p, i) => [p.id, i]));
  return fromViews.sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
  );
}

function rosterCell(view: ReturnType<typeof guardShiftRosterViews>[number], positionId: string): string {
  const entry = view.positions.find((p) => p.positionId === positionId);
  if (!entry) return "";
  const names = joinNames(entry.assignees);
  return names || EMPTY;
}

function buildRosterTable(missions: MissionDay[]): MissionExportTable {
  const guards = missions.filter((m) => m.mission_type === "guards");
  const rows: MissionExportTable["rows"] = [
    { kind: "title", cells: ["גלגולי שמירה"] },
  ];

  if (!guards.length) {
    rows.push({ kind: "muted", cells: ["אין ימי שמירות בלוח."] });
    return { name: "גלגולי שמירה", rows };
  }

  for (const mission of guards) {
    rows.push({ kind: "blank", cells: [] });
    rows.push({
      kind: "section",
      cells: [`${formatMissionDateHe(mission.mission_date)} · ${mission.title}`],
    });
    const views = guardShiftRosterViews(mission);
    const positions = positionHeaderOrder(mission);
    if (!views.length || !positions.length) {
      rows.push({ kind: "muted", cells: ["אין משמרות שמירה ביום זה."] });
      continue;
    }
    rows.push({
      kind: "header",
      cells: ["שעות", ...positions.map((p) => p.name), "עולים לשמירה"],
    });
    for (const view of views) {
      rows.push({
        kind: "data",
        cells: [
          view.timeLabel,
          ...positions.map((p) => rosterCell(view, p.id)),
          joinNames(view.allNames) || EMPTY,
        ],
      });
    }
  }

  return { name: "גלגולי שמירה", rows };
}

function buildDetailTable(missions: MissionDay[]): MissionExportTable {
  const rows: MissionExportTable["rows"] = [
    { kind: "title", cells: ["פירוט שיבוצים"] },
    {
      kind: "header",
      cells: ["תאריך", "יום", "שעות", "סוג", "עמדה", "משובצים", "משובץ", "קיבולת"],
    },
  ];

  const slots = missions
    .flatMap((mission) =>
      flattenedSlots(mission).map((slot) => ({ mission, slot })),
    )
    .sort(
      (a, b) =>
        a.mission.mission_date.localeCompare(b.mission.mission_date) ||
        a.slot.sortKey - b.slot.sortKey ||
        a.slot.positionName.localeCompare(b.slot.positionName, "he"),
    );

  for (const { mission, slot } of slots) {
    const names = joinNames(slot.assignees);
    const assigned = slot.assignees.filter((n) => n?.trim()).length;
    const position =
      slot.slotLabel?.trim()
        ? `${slot.positionName} (${slot.slotLabel.trim()})`
        : slot.positionName;
    rows.push({
      kind: "data",
      cells: [
        mission.mission_date,
        weekdayHe(mission.mission_date),
        slot.timeLabel,
        kindLabel(slot),
        position,
        names || EMPTY,
        String(assigned),
        String(slot.seatCount),
      ],
    });
  }

  if (slots.length === 0) {
    rows.push({ kind: "muted", cells: ["אין שיבוצים בלוח."] });
  }

  return { name: "פירוט שיבוצים", rows };
}

function buildByPersonTable(missions: MissionDay[]): MissionExportTable {
  const rows: MissionExportTable["rows"] = [
    { kind: "title", cells: ["לפי צוער"] },
    {
      kind: "header",
      cells: ["צוער", "תאריך", "יום", "שעות", "עמדה", "סוג"],
    },
  ];

  const items: {
    name: string;
    date: string;
    timeLabel: string;
    position: string;
    kind: string;
    sortKey: number;
  }[] = [];

  for (const mission of missions) {
    for (const slot of flattenedSlots(mission)) {
      for (const name of slot.assignees) {
        const trimmed = name?.trim();
        if (!trimmed) continue;
        items.push({
          name: trimmed,
          date: mission.mission_date,
          timeLabel: slot.timeLabel,
          position: slot.positionName,
          kind: kindLabel(slot),
          sortKey: slot.sortKey,
        });
      }
    }
  }

  items.sort(
    (a, b) =>
      compareHe(a.name, b.name) ||
      a.date.localeCompare(b.date) ||
      a.sortKey - b.sortKey ||
      a.position.localeCompare(b.position, "he"),
  );

  for (const item of items) {
    rows.push({
      kind: "data",
      cells: [
        item.name,
        item.date,
        weekdayHe(item.date),
        item.timeLabel,
        item.position,
        item.kind,
      ],
    });
  }

  if (!items.length) {
    rows.push({ kind: "muted", cells: ["אין שיבוצים בלוח."] });
  }

  return { name: "לפי צוער", rows };
}

function buildKitchenTable(
  missions: MissionDay[],
  rosterNames: string[],
): MissionExportTable | null {
  const kitchens = missions.filter((m) => m.mission_type === "kitchen");
  if (!kitchens.length) return null;

  const rows: MissionExportTable["rows"] = [
    { kind: "title", cells: ["תורנות מטבח"] },
  ];

  for (const mission of kitchens) {
    rows.push({ kind: "blank", cells: [] });
    rows.push({
      kind: "section",
      cells: [`${formatMissionDateHe(mission.mission_date)} · ${mission.title}`],
    });
    rows.push({
      kind: "header",
      cells: ["משמרת", "שעות", "משובצים", "לא במשמרת"],
    });
    const views = kitchenShiftRosterViews(flattenedSlots(mission), rosterNames);
    if (!views.length) {
      rows.push({ kind: "muted", cells: ["אין משמרות מטבח ביום זה."] });
      continue;
    }
    for (const view of views) {
      rows.push({
        kind: "data",
        cells: [
          String(view.shiftIndex + 1),
          view.timeLabel,
          joinNames(view.assignedNames) || EMPTY,
          joinNames(view.absentNames) || EMPTY,
        ],
      });
    }
  }

  return { name: "מטבח", rows };
}

export function buildMissionExportTables(
  missions: MissionDay[],
  rosterNames: string[] = [],
): MissionExportTable[] {
  const visible = missionsForExcelExport(missions);
  const tables = [
    buildRosterTable(visible),
    buildDetailTable(visible),
    buildByPersonTable(visible),
  ];
  const kitchen = buildKitchenTable(visible, rosterNames);
  if (kitchen) tables.push(kitchen);
  return tables;
}

const KIND_TO_STYLE: Record<ExportRowKind, XlsxStyle> = {
  title: "title",
  section: "section",
  header: "header",
  data: "data",
  muted: "muted",
  blank: "blank",
};

function tableToSheet(table: MissionExportTable): XlsxSheet {
  const width = Math.max(1, ...table.rows.map((r) => r.cells.length));
  const rows: XlsxCell[][] = table.rows.map((row, rowIndex) => {
    const style = KIND_TO_STYLE[row.kind];
    const dataIndex = table.rows
      .slice(0, rowIndex)
      .filter((r) => r.kind === "data").length;
    const cells: XlsxCell[] = [];
    for (let i = 0; i < Math.max(width, row.cells.length, 1); i++) {
      const v = row.cells[i] ?? "";
      if (row.kind === "data") {
        const isTime = i === 0 && table.name === "גלגולי שמירה";
        cells.push({
          v,
          style: isTime ? "time" : dataIndex % 2 === 1 ? "dataAlt" : "data",
        });
      } else {
        cells.push({ v, style });
      }
    }
    return cells;
  });

  const merges: string[] = [];
  table.rows.forEach((row, i) => {
    if (row.kind === "title" || row.kind === "section") {
      merges.push(`A${i + 1}:${colName(width - 1)}${i + 1}`);
    }
  });

  const headerIndex = table.rows.findIndex((r) => r.kind === "header");
  const freeze = headerIndex >= 0 && table.name !== "גלגולי שמירה" ? headerIndex + 1 : 1;

  const colWidths =
    table.name === "גלגולי שמירה"
      ? [14, ...Array(Math.max(0, width - 2)).fill(18), 36]
      : table.name === "פירוט שיבוצים"
        ? [12, 10, 14, 16, 22, 40, 10, 10]
        : table.name === "לפי צוער"
          ? [20, 12, 10, 14, 22, 18]
          : [12, 14, 40, 40];

  return {
    name: table.name,
    rows,
    colWidths: colWidths.slice(0, width),
    freeze,
    merges,
  };
}

export function missionExportFilename(missions: MissionDay[]): string {
  const dates = [
    ...new Set(missionsForExcelExport(missions).map((m) => m.mission_date)),
  ].sort();
  if (dates.length === 1) return `luach-shmirot-${dates[0]}.xlsx`;
  if (dates.length > 1) return `luach-shmirot-${dates[0]}-${dates[dates.length - 1]}.xlsx`;
  return "luach-shmirot.xlsx";
}

export function buildMissionExportXlsx(
  missions: MissionDay[],
  rosterNames: string[] = [],
): Uint8Array {
  return writeXlsx(buildMissionExportTables(missions, rosterNames).map(tableToSheet));
}

export function downloadMissionsExcel(
  missions: MissionDay[],
  rosterNames: string[] = [],
): void {
  const bytes = buildMissionExportXlsx(missions, rosterNames);
  triggerBrowserDownload(missionExportFilename(missions), bytes);
}
