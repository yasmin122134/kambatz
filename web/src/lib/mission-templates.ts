import {
  defaultBaseWorkPositions,
  isBaseWorkPosition,
  materializeBaseWorkPositions,
} from "@/lib/base-work-template";
import {
  buildGuardDayPositions,
  footPatrolSlotsValid,
  guardPositionHint,
  officerDutySlotsValid,
  rearVehicleSlotsValid,
  summarizeGuardSlots,
  syncGuardShiftSlots,
} from "@/lib/guard-day-template";
export { guardPositionHint, summarizeGuardSlots, syncGuardShiftSlots };
import { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
import type { MissionPosition, MissionSchedulingRules, MissionType } from "@/lib/types";
import {
  DEFAULT_BASE_WORK_SCHEDULING_RULES,
  DEFAULT_KITCHEN_SCHEDULING_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
} from "@/lib/types";

export function boardStartFromMissionStart(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "20:00";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** שעות ברירת מחדל ליום משימה לפי סוג */
export function defaultMissionWindow(
  missionType: MissionType,
  missionDate: string,
): { startsAt: string; endsAt: string; missionDate: string } {
  const date = missionDate.slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (missionType === "kitchen") {
    return {
      missionDate: date,
      startsAt: `${date}T06:00`,
      endsAt: `${date}T22:00`,
    };
  }
  if (missionType === "base_work") {
    return {
      missionDate: date,
      startsAt: `${date}T08:30`,
      endsAt: `${date}T20:00`,
    };
  }
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return {
    missionDate: date,
    startsAt: `${date}T20:00`,
    endsAt: `${nextDate}T20:00`,
  };
}

/** כללי שיבוץ ברירת מחדל לפי סוג משימה */
export function defaultSchedulingForType(
  missionType: MissionType,
  startsAt?: string,
): MissionSchedulingRules {
  const base = { ...DEFAULT_MISSION_SCHEDULING_RULES };
  if (missionType === "guards" && startsAt) {
    base.board_start = boardStartFromMissionStart(startsAt);
    base.base_work = { ...DEFAULT_BASE_WORK_SCHEDULING_RULES };
  }
  if (missionType === "kitchen") {
    base.kitchen = { ...DEFAULT_KITCHEN_SCHEDULING_RULES };
  }
  if (missionType === "base_work") {
    base.base_work = { ...DEFAULT_BASE_WORK_SCHEDULING_RULES };
  }
  return base;
}

export type StandardMissionInput = {
  missionType: MissionType;
  startsAt: string;
  endsAt: string;
  scheduling?: MissionSchedulingRules;
  season?: "summer" | "winter";
};

/** כל העמדות/משמרות לפי הפקודה — מקור אמת יחיד */
export function standardMissionPositions(input: StandardMissionInput): MissionPosition[] {
  const scheduling =
    input.scheduling ?? defaultSchedulingForType(input.missionType, input.startsAt);

  if (input.missionType === "guards") {
    return buildGuardDayPositions({
      shiftHours: scheduling.shift_hours,
      boardStart: scheduling.board_start,
      season: input.season ?? "summer",
      missionStartsAt: input.startsAt,
      missionEndsAt: input.endsAt,
      baseWorkSeatsPerShift: scheduling.base_work?.seats_per_shift,
    });
  }

  if (input.missionType === "kitchen") {
    return defaultKitchenDayPositions({
      seatsPerShift: scheduling.kitchen?.seats_per_shift ?? 35,
    });
  }

  return defaultBaseWorkPositions({
    seatsPerShift: scheduling.base_work?.seats_per_shift,
  });
}

/** מסנכרן חלונות משמרת לכל עמדות השמירה לפני שמירה */
export function finalizeGuardMissionPositions(
  positions: MissionPosition[],
  input: {
    startsAt: string;
    endsAt: string;
    scheduling?: MissionSchedulingRules;
    season?: "summer" | "winter";
  },
): MissionPosition[] {
  if (!positions?.length) return positions;
  const baseWorkPositions = positions.filter((p) => isBaseWorkPosition(p));
  const guardPositions = positions.filter((p) => !isBaseWorkPosition(p));
  const synced = syncGuardShiftSlots(guardPositions, {
    shiftHours: input.scheduling?.shift_hours,
    boardStart: input.scheduling?.board_start,
    season: input.season ?? "summer",
    missionStartsAt: input.startsAt,
    missionEndsAt: input.endsAt,
    baseWorkSeatsPerShift: input.scheduling?.base_work?.seats_per_shift,
  });
  const baseWork =
    baseWorkPositions.length > 0
      ? materializeBaseWorkPositions(baseWorkPositions, input.startsAt, input.endsAt)
      : materializeBaseWorkPositions(
          defaultBaseWorkPositions({
            seatsPerShift: input.scheduling?.base_work?.seats_per_shift,
          }),
          input.startsAt,
          input.endsAt,
        );
  return [...synced, ...baseWork];
}

/** Operation A — regenerate guard slot structure from mission window + rules. */
export function generateGuardMissionStructure(
  positions: MissionPosition[],
  input: {
    startsAt: string;
    endsAt: string;
    scheduling?: MissionSchedulingRules;
    season?: "summer" | "winter";
  },
): MissionPosition[] {
  return finalizeGuardMissionPositions(positions, input);
}

export type ResolveMissionPositionsInput = {
  missionType: MissionType;
  startsAt: string;
  endsAt: string;
  scheduling?: MissionSchedulingRules;
  season?: "summer" | "winter";
  clientPositions?: MissionPosition[];
  /** When false (default), persisted client positions are authoritative. */
  regenerateStructure?: boolean;
};

export function resolveMissionPositions(input: ResolveMissionPositionsInput): MissionPosition[] {
  const scheduling =
    input.scheduling ?? defaultSchedulingForType(input.missionType, input.startsAt);
  const base = input.clientPositions?.length
    ? input.clientPositions
    : standardMissionPositions({
        missionType: input.missionType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        scheduling,
        season: input.season,
      });

  if (input.missionType !== "guards") return base;

  if (!input.regenerateStructure) return base;

  return generateGuardMissionStructure(base, {
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    scheduling,
    season: input.season,
  });
}

function guardSlotIdsUnique(positions: MissionPosition[]): boolean {
  const seen = new Set<string>();
  for (const pos of positions) {
    for (const slot of pos.slots) {
      if (seen.has(slot.id)) return false;
      seen.add(slot.id);
    }
  }
  return true;
}

export function missionTemplateComplete(
  missionType: MissionType,
  positions: MissionPosition[],
  opts?: { startsAt?: string; endsAt?: string },
): boolean {
  if (!positions?.length) return false;
  if (missionType === "guards") {
    const required = [
      "כרמל א׳ (כוננות)",
      "כרמל ב׳ (כוננות)",
      "ש״ג רכב אחורי",
      "ש״ג רכב קדמי",
      "פטל",
      "תצפיתן",
      "ש״ג רגלי",
      "ימ״ח",
      "נשקייה",
      "בונקר",
      "כוח עתודה",
      "קצין תורן",
      "עבודות בסיס",
    ];
    const names = new Set(positions.map((p) => p.name));
    const rear = positions.find((p) => p.name.includes("רכב אחורי"));
    const foot = positions.find((p) => p.name.includes("רגלי"));
    const officer = positions.find((p) => p.kind === "officer_duty");
    const startsAt = opts?.startsAt ?? "2026-01-01T20:00:00";
    const endsAt = opts?.endsAt ?? "2026-01-02T20:00:00";
    return (
      positions.length >= 13 &&
      required.every((n) => names.has(n)) &&
      guardSlotIdsUnique(positions) &&
      (!rear || rearVehicleSlotsValid(rear.slots, "06:00", "18:00", startsAt, endsAt)) &&
      (!foot || footPatrolSlotsValid(foot.slots, "06:00", "19:00", startsAt, endsAt)) &&
      (!officer || officerDutySlotsValid(officer.slots))
    );
  }
  if (missionType === "kitchen") {
    const pos = positions[0];
    const slots = pos?.slots ?? [];
    const seats = slots[0]?.seat_count ?? 0;
    return (
      pos?.kind === "kitchen" &&
      slots.length === 4 &&
      seats >= 1 &&
      slots.every((s) => s.seat_count === seats) &&
      slots.some((s) => s.start_time === "06:00" && s.end_time === "10:00") &&
      slots.some((s) => s.start_time === "19:00" && s.end_time === "22:00")
    );
  }
  if (missionType === "base_work") {
    const slots = positions[0]?.slots ?? [];
    return (
      slots.length === 3 &&
      slots.some((s) => s.start_time === "08:30") &&
      slots.some((s) => s.start_time === "13:30")
    );
  }
  return true;
}

export const STANDARD_GUARD_DAY_SUMMARY = [
  "חילוף משמרות ~4 שעות מעוגן לתחילת יום המשימה (לא ל-08:00 גלובלי)",
  "משמרת פתיחה/סגירה קצרה — מסנכרנת לרשת 08:00 (למשל 09:00–10:00, 06:00–08:00, 08:00–09:00)",
  "כרמל א׳/ב׳ — 3 צוערים, אותו מגדר, עדיפות אותו חדר, מתחילת יום המשימה עד סופה",
  "כרמל א׳ — מותר במקביל למטבח · כרמל ב׳ — מותר במקביל לעב״ס (רס״ר) ולמטבח",
  "ש״ג רכב אחורי — בדיוק 1 ב־06–18, בדיוק 2 בשאר השעות · חילוף מסונכרן",
  "ש״ג רכב קדמי — 2 תמיד · ש״ג רגלי — בדיוק 1 ב־06–19, 0 בשאר השעות",
  "פטל, תצפיתן, ימ״ח, נשקייה, בונקר — 1 תמיד",
  "כוח עתודה — 3 תמיד · קצין תורן — רק רני פלג / יסמין חדד, שתי משמרות (חצי יום כל אחת)",
] as const;

export const STANDARD_KITCHEN_SUMMARY = [
  "35 צוערים בכל משמרת · 4 משמרות 06:00–22:00",
  "06–10, 10–15, 15–19, 19–22 (ניתן לעריכה)",
  "נקודות צדק זהות לכל משמרת · שיבוץ לפי 4 צוותים",
] as const;

export const STANDARD_BASE_WORK_SUMMARY = [
  "בוקר 08:30–11:30 · צהריים 13:30–17:30 · ערב 18:30–20:00",
  "13–15 צוערים בחלון · עדיפות צוות שלם",
] as const;
