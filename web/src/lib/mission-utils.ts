import type {
  FairnessRules,
  Issue,
  MissionDay,
  MissionPosition,
  MissionPositionKind,
  MissionSchedulingRules,
  MissionSlot,
  MissionType,
  Person,
} from "@/lib/types";
import {
  DEFAULT_BASE_WORK_SCHEDULING_RULES,
  DEFAULT_KITCHEN_SCHEDULING_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
  type BaseWorkSchedulingRules,
  type KitchenSchedulingRules,
} from "@/lib/types";

export type FlatSlot = {
  slotId: string;
  positionId: string;
  positionName: string;
  positionKind: MissionPositionKind;
  sameRoom: boolean;
  sameGender: boolean;
  /** סוג יום המשימה — לחפיפות מותרות (כרמל + מטבch/עב״ס) */
  missionType: MissionType;
  startTime: string;
  endTime: string;
  timeLabel: string;
  seatCount: number;
  assignees: string[];
  sortKey: number;
  durationMinutes: number;
  cyclicStart: number;
  /** אינדקס משמרת מטבח (0-based) */
  kitchenShiftIndex?: number;
  /** אינדקס חלון עב״ס (0-based) */
  baseWorkShiftIndex?: number;
};

export type UpcomingMissionItem = {
  id: string;
  missionId: string;
  missionTitle: string;
  missionType: MissionType;
  missionDate: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  sortKey: number;
};

function timeLabel(start: string, end: string) {
  return `${start}–${end}`;
}

export function parseTimeMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export function slotDurationMinutes(start: string, end: string): number {
  const a = parseTimeMinutes(start);
  const b = parseTimeMinutes(end);
  if (a === null || b === null) return 0;
  if (b > a) return b - a;
  if (b === a) return 1440;
  return 1440 - a + b;
}

export function defaultPositionKind(
  missionType: MissionType,
  name = "",
): MissionPositionKind {
  const n = name.trim();
  if (/כרמל\s*א/.test(n)) return "standby_carmel_a";
  if (/כרמל\s*ב/.test(n)) return "standby_carmel_b";
  if (missionType === "kitchen") return "kitchen";
  if (missionType === "base_work") return "duty";
  return "guard";
}

export function resolvePositionKind(
  missionType: MissionType,
  pos: MissionPosition,
): MissionPositionKind {
  if (pos.kind) return pos.kind;
  return defaultPositionKind(missionType, pos.name);
}

export function isStandbyKind(kind: MissionPositionKind): boolean {
  return kind === "standby_carmel_a" || kind === "standby_carmel_b";
}

export function isGuardKind(kind: MissionPositionKind): boolean {
  return kind === "guard" || kind === "officer_duty";
}

export function eatsRest(kind: MissionPositionKind): boolean {
  return kind !== "standby_carmel_a" && kind !== "standby_carmel_b";
}

export function normalizeSchedulingRules(raw: unknown): MissionSchedulingRules {
  const src = (raw || {}) as Partial<MissionSchedulingRules> & {
    kitchen?: Partial<KitchenSchedulingRules>;
  };
  const out = { ...DEFAULT_MISSION_SCHEDULING_RULES };
  if (src.rest_hours != null) {
    const v = +src.rest_hours;
    if (!Number.isNaN(v) && v >= 0 && v <= 24) out.rest_hours = v;
  }
  if (src.guard_ratio != null) {
    const v = +src.guard_ratio;
    if (!Number.isNaN(v) && v >= 0) out.guard_ratio = v;
  }
  if (src.board_start && /^\d{1,2}:\d{2}$/.test(src.board_start)) {
    out.board_start = src.board_start;
  }
  if (src.shift_hours != null) {
    const v = +src.shift_hours;
    if (!Number.isNaN(v) && v >= 1 && v <= 12) out.shift_hours = v;
  }
  const k: Partial<KitchenSchedulingRules> = src.kitchen ?? {};
  out.kitchen = {
    points_per_shift: k.points_per_shift !== false,
    seats_per_shift: Math.max(
      1,
      Math.min(60, +k.seats_per_shift! || DEFAULT_KITCHEN_SCHEDULING_RULES.seats_per_shift),
    ),
    squad_rest_by_shift: normalizeSquadRest(k.squad_rest_by_shift),
  };
  const b: Partial<BaseWorkSchedulingRules> = src.base_work ?? {};
  out.base_work = {
    seats_per_shift: Math.max(
      13,
      Math.min(15, +b.seats_per_shift! || DEFAULT_BASE_WORK_SCHEDULING_RULES.seats_per_shift),
    ),
    squad_rest_by_shift: normalizeSquadRest(
      b.squad_rest_by_shift,
      DEFAULT_BASE_WORK_SCHEDULING_RULES.squad_rest_by_shift,
    ),
  };
  return out;
}

function normalizeSquadRest(raw: unknown, fallback?: number[]): number[] {
  const base = fallback ?? DEFAULT_KITCHEN_SCHEDULING_RULES.squad_rest_by_shift;
  if (!Array.isArray(raw) || !raw.length) {
    return [...base];
  }
  return raw.map((v, i) => {
    const n = +v;
    if (!Number.isNaN(n) && n >= 1 && n <= 4) return n;
    return base[i % base.length] ?? (i % 4) + 1;
  });
}

export function cyclicPos(minute: number, boardStart: number): number {
  return ((minute - boardStart) % 1440 + 1440) % 1440;
}

export function flattenMissionSlots(
  mission: MissionDay,
  boardStart?: number,
): FlatSlot[] {
  const rules = normalizeSchedulingRules(mission.scheduling_rules);
  const t0 =
    boardStart ??
    parseTimeMinutes(rules.board_start) ??
    20 * 60;
  const out: FlatSlot[] = [];
  let kitchenIdx = 0;
  let baseWorkIdx = 0;

  for (const pos of mission.positions || []) {
    const kind = resolvePositionKind(mission.mission_type, pos);
    const sameRoom = pos.same_room ?? isStandbyKind(kind);
    const sameGender = pos.same_gender ?? isStandbyKind(kind);
    for (const slot of pos.slots || []) {
      const assignees = (mission.assignments[slot.id] || []).filter(Boolean);
      const startMin = parseTimeMinutes(slot.start_time) ?? 0;
      const dur = slotDurationMinutes(slot.start_time, slot.end_time);
      const isKitchenSlot = mission.mission_type === "kitchen" || kind === "kitchen";
      const isBaseWorkSlot = mission.mission_type === "base_work";
      out.push({
        slotId: slot.id,
        positionId: pos.id,
        positionName: pos.name,
        positionKind: kind,
        sameRoom,
        sameGender,
        missionType: mission.mission_type,
        startTime: slot.start_time,
        endTime: slot.end_time,
        timeLabel: timeLabel(slot.start_time, slot.end_time),
        seatCount: slot.seat_count,
        assignees,
        sortKey: startMin,
        durationMinutes: dur,
        cyclicStart: cyclicPos(startMin, t0),
        kitchenShiftIndex: isKitchenSlot ? kitchenIdx++ : undefined,
        baseWorkShiftIndex: isBaseWorkSlot ? baseWorkIdx++ : undefined,
      });
    }
  }

  out.sort(
    (a, b) =>
      a.sortKey - b.sortKey || a.positionName.localeCompare(b.positionName),
  );
  return out;
}

export function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return {
    id: crypto.randomUUID(),
    start_time: start,
    end_time: end,
    seat_count: seats,
  };
}

export function newPosition(
  name: string,
  opts?: {
    kind?: MissionPositionKind;
    same_room?: boolean;
    slots?: MissionSlot[];
  },
): MissionPosition {
  const kind = opts?.kind;
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    same_room: opts?.same_room ?? (kind ? isStandbyKind(kind) : undefined),
    slots: opts?.slots || [newSlot()],
  };
}

export { buildGuardDayPositions, defaultGuardDayPositions } from "@/lib/guard-day-template";
export { standardGuardDayPositions, STANDARD_GUARD_DAY_SUMMARY } from "@/lib/guard-day-catalog";
export { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
export { defaultBaseWorkPositions } from "@/lib/base-work-template";

export function emptyAssignments(positions: MissionPosition[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const pos of positions) {
    for (const slot of pos.slots) {
      out[slot.id] = Array.from({ length: slot.seat_count }, () => "");
    }
  }
  return out;
}

export function syncAssignmentSeats(
  positions: MissionPosition[],
  assignments: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...assignments };
  for (const pos of positions) {
    for (const slot of pos.slots) {
      const cur = out[slot.id] || [];
      out[slot.id] = Array.from({ length: slot.seat_count }, (_, i) => cur[i] || "");
    }
  }
  return out;
}

const MISSION_TYPE_SHORT: Record<MissionType, string> = {
  guards: "שמירה",
  base_work: "עב״ס",
  kitchen: "מטבח",
};

export function upcomingFromMissions(
  missions: MissionDay[],
  personName: string,
): UpcomingMissionItem[] {
  const now = Date.now();
  const items: UpcomingMissionItem[] = [];

  for (const mission of missions.filter((m) => m.status === "published")) {
    const missionStart = new Date(mission.starts_at).getTime();
    if (missionStart + 48 * 3600_000 < now) continue;

    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      items.push({
        id: `${mission.id}:${slot.slotId}`,
        missionId: mission.id,
        missionTitle: mission.title,
        missionType: mission.mission_type,
        missionDate: mission.mission_date,
        timeLabel: slot.timeLabel,
        title: slot.positionName,
        subtitle: MISSION_TYPE_SHORT[mission.mission_type],
        sortKey:
          new Date(`${mission.mission_date}T${slot.startTime}:00`).getTime() ||
          missionStart,
      });
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items.filter((i) => i.sortKey >= now - 3600_000);
}

export type { Person, Issue, FairnessRules, MissionSchedulingRules };
