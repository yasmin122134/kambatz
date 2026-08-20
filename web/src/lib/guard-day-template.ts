import type { MissionPosition, MissionPositionKind, MissionSlot } from "@/lib/types";

function uid() {
  return crypto.randomUUID();
}

export function parseTimeMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

function fmtTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** HH:MM מתאריך ISO (שעון מקומי) */
export function isoToTimeLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtTime(d.getHours() * 60 + d.getMinutes());
}

/** חלון כוננות כרמל — מתחילת יום המשימה עד סופו */
export function carmelSlotFromMission(
  missionStartsAt?: string,
  missionEndsAt?: string,
  boardStart?: string,
  seats = 3,
): MissionSlot {
  const start = isoToTimeLabel(missionStartsAt) ?? boardStart ?? "20:00";
  const end = isoToTimeLabel(missionEndsAt) ?? start;
  return newSlot(start, end, seats);
}

function newPosition(
  name: string,
  opts?: {
    kind?: MissionPositionKind;
    same_room?: boolean;
    same_gender?: boolean;
    slots?: MissionSlot[];
  },
): MissionPosition {
  const kind = opts?.kind;
  const isCarmel = kind === "standby_carmel_a" || kind === "standby_carmel_b";
  return {
    id: uid(),
    name,
    kind,
    same_room: opts?.same_room ?? isCarmel,
    same_gender: opts?.same_gender ?? isCarmel,
    slots: opts?.slots || [newSlot()],
  };
}

/** פיצול חלון שעות למשמרות מסתובבות */
export function buildRotatedSlots(
  startTime: string,
  endTime: string,
  seatCount: number,
  shiftHours: number,
  options?: {
    fullTour?: boolean;
    boardStart?: string;
  },
): MissionSlot[] {
  const board = parseTimeMinutes(options?.boardStart ?? "20:00") ?? 20 * 60;
  const shiftMin = Math.max(60, Math.round(shiftHours * 60));

  let startMin: number;
  let endMin: number;

  if (options?.fullTour || startTime === endTime) {
    startMin = board;
    endMin = board + 1440;
  } else {
    const a = parseTimeMinutes(startTime);
    const b = parseTimeMinutes(endTime);
    if (a === null || b === null) return [newSlot(startTime, endTime, seatCount)];
    startMin = a;
    endMin = b <= a ? b + 1440 : b;
  }

  const slots: MissionSlot[] = [];
  let cursor = startMin;
  while (cursor < endMin - 1) {
    const next = Math.min(cursor + shiftMin, endMin);
    slots.push(newSlot(fmtTime(cursor), fmtTime(next), seatCount));
    cursor = next;
  }
  return slots.length ? slots : [newSlot(startTime, endTime, seatCount)];
}

function guardPosition(
  name: string,
  slots: MissionSlot[],
  kind: MissionPositionKind = "guard",
  opts?: { same_room?: boolean; same_gender?: boolean },
): MissionPosition {
  return newPosition(name, { kind, ...opts, slots });
}

function cycleMinutesFromMission(startsAt?: string, endsAt?: string): number {
  if (startsAt && endsAt) {
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      return Math.max(60, Math.round((endMs - startMs) / 60000));
    }
  }
  return 1440;
}

function isDaytime(clockMin: number, dayStartMin: number, dayEndMin: number): boolean {
  return clockMin >= dayStartMin && clockMin < dayEndMin;
}

/** חלונות יום/לילה בתוך מחזור יום השמירות (מתחילת board_start) */
export function dayNightSegmentsInCycle(
  boardMin: number,
  cycleMin: number,
  dayStartMin: number,
  dayEndMin: number,
  daySeats: number,
  nightSeats: number,
): Array<{ startMin: number; endMin: number; seats: number }> {
  if (cycleMin <= 0) return [];

  const segments: Array<{ startMin: number; endMin: number; seats: number }> = [];
  let segStart = 0;
  let segSeats = isDaytime((boardMin + 0) % 1440, dayStartMin, dayEndMin) ? daySeats : nightSeats;

  for (let offset = 1; offset <= cycleMin; offset++) {
    const atEnd = offset === cycleMin;
    const nextSeats = atEnd
      ? null
      : isDaytime((boardMin + offset) % 1440, dayStartMin, dayEndMin)
        ? daySeats
        : nightSeats;

    if (atEnd || nextSeats !== segSeats) {
      if (segSeats > 0) {
        segments.push({
          startMin: boardMin + segStart,
          endMin: boardMin + offset,
          seats: segSeats,
        });
      }
      if (!atEnd && nextSeats != null) {
        segStart = offset;
        segSeats = nextSeats;
      }
    }
  }

  return segments;
}

function slotsFromAbsoluteSegments(
  segments: Array<{ startMin: number; endMin: number; seats: number }>,
  shiftHours: number,
): MissionSlot[] {
  const shiftMin = Math.max(60, Math.round(shiftHours * 60));
  const slots: MissionSlot[] = [];

  for (const seg of segments) {
    let cursor = seg.startMin;
    while (cursor < seg.endMin - 1) {
      const next = Math.min(cursor + shiftMin, seg.endMin);
      slots.push(newSlot(fmtTime(cursor), fmtTime(next), seg.seats));
      cursor = next;
    }
  }

  return slots;
}

/** ש״ג רכב אחורי — 1 ביום (06–19), 2 בלילה, רק בתוך מחזור יום השמירות */
function rearVehicleSlots(
  dayStart: string,
  dayEnd: string,
  shift: number,
  board: string,
  cycleMin: number,
): MissionSlot[] {
  const boardMin = parseTimeMinutes(board) ?? 20 * 60;
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 19 * 60;
  const segments = dayNightSegmentsInCycle(boardMin, cycleMin, dayStartMin, dayEndMin, 1, 2);
  return slotsFromAbsoluteSegments(segments, shift);
}

/** ש״ג רגלי — 1 ביום בלבד, רק בתוך מחזור יום השמירות */
function footPatrolSlots(
  dayStart: string,
  dayEnd: string,
  shift: number,
  board: string,
  cycleMin: number,
): MissionSlot[] {
  const boardMin = parseTimeMinutes(board) ?? 20 * 60;
  const dayStartMin = parseTimeMinutes(dayStart) ?? 6 * 60;
  const dayEndMin = parseTimeMinutes(dayEnd) ?? 19 * 60;
  const segments = dayNightSegmentsInCycle(boardMin, cycleMin, dayStartMin, dayEndMin, 1, 0);
  return slotsFromAbsoluteSegments(segments, shift);
}

export type BuildGuardDayOptions = {
  shiftHours?: number;
  season?: "summer" | "winter";
  boardStart?: string;
  missionStartsAt?: string;
  missionEndsAt?: string;
  carmelSeats?: number;
};

/** מערך שמירות סטנדרטי — כל העמדות לפי הפקודה */
export function buildGuardDayPositions(options?: BuildGuardDayOptions): MissionPosition[] {
  const shift = options?.shiftHours ?? 4;
  const board = options?.boardStart ?? isoToTimeLabel(options?.missionStartsAt) ?? "20:00";
  const cycleMin = cycleMinutesFromMission(options?.missionStartsAt, options?.missionEndsAt);
  const carmelSeats = options?.carmelSeats ?? 3;
  const day =
    options?.season === "winter" ? (["05:00", "17:00"] as const) : (["06:00", "19:00"] as const);
  const tour = { fullTour: true, boardStart: board };
  const carmelSlot = carmelSlotFromMission(
    options?.missionStartsAt,
    options?.missionEndsAt,
    board,
    carmelSeats,
  );

  return [
    guardPosition("כרמל א׳ (כוננות)", [carmelSlot], "standby_carmel_a", {
      same_room: true,
      same_gender: true,
    }),
    guardPosition("כרמל ב׳ (כוננות)", [carmelSlot], "standby_carmel_b", {
      same_room: true,
      same_gender: true,
    }),
    guardPosition(
      "ש״ג רכב אחורי",
      rearVehicleSlots(day[0], day[1], shift, board, cycleMin),
    ),
    guardPosition("ש״ג רכב קדמי", buildRotatedSlots("00:00", "00:00", 2, shift, tour)),
    guardPosition("פטל", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition("תצפיתן", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition(
      "ש״ג רגלי",
      footPatrolSlots(day[0], day[1], shift, board, cycleMin),
    ),
    guardPosition("ימ״ח", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition("נשקייה", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition("בונקר", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition(
      "כוח עתודה",
      buildRotatedSlots("00:00", "00:00", 3, shift, tour),
      "duty",
    ),
    guardPosition(
      "קצין תורן",
      buildRotatedSlots("00:00", "00:00", 1, shift, tour),
      "officer_duty",
    ),
  ];
}

export function defaultGuardDayPositions(options?: BuildGuardDayOptions): MissionPosition[] {
  return buildGuardDayPositions(options);
}

/** הסבר קצר לכל עמדה — מוצג בעורך יום משימה */
export function guardPositionHint(pos: Pick<MissionPosition, "name" | "kind">): string | null {
  switch (pos.kind) {
    case "standby_carmel_a":
      return "3 צוערים, אותו מגדר, עדיפות אותו חדר, מתחילת יום המשימה עד סופו. מותר במקביל למטבח.";
    case "standby_carmel_b":
      return "3 צוערים, אותו מגדר, עדיפות אותו חדר, מתחילת יום המשימה עד סופו. מותר במקביל לעב״ס (רס״ר) ולמטבח.";
    case "officer_duty":
      return "קצין תורן זמין בכל רגע במהלך היום — משמרות מסתובבות בין צוערים שמוגדרים כקצין תורן.";
    case "duty":
      if (pos.name.includes("עתודה")) {
        return "3 צוערים תמיד — משמרות מסתובבות לאורך כל יום המשימה.";
      }
      return null;
    default:
      break;
  }
  if (pos.name.includes("רכב אחורי")) {
    return "שומר אחד בין 06:00–19:00 (רק בתוך יום השמירות), ובשאר שעות המחזור 2 צוערים — משמרות מסתובבות.";
  }
  if (pos.name.includes("רכב קדמי")) {
    return "2 שומרים בכל משמרת — לאורך כל יום המשימה.";
  }
  if (pos.name.includes("רגלי")) {
    return "שומר אחד בין 06:00–19:00 — רק בחלון שחופף ליום השמירות (לא לפני תחילתו).";
  }
  if (["פטל", "תצפיתן", "ימ״ח", "נשקייה", "בונקר"].some((n) => pos.name.includes(n))) {
    return "שומר אחד בכל משמרת — לאורך כל יום המשימה (משמרות מסתובבות).";
  }
  return null;
}

export function summarizeGuardSlots(slots: MissionSlot[]): string {
  if (!slots.length) return "";
  if (slots.length === 1) {
    const s = slots[0];
    if (s.start_time === s.end_time && s.start_time !== "00:00") {
      return `${s.seat_count} צוערים · ${s.start_time}–${s.end_time}`;
    }
    if (s.start_time === s.end_time) {
      return `${s.seat_count} צוערים · כל יום המשימה (כוננות)`;
    }
    return `${s.seat_count} צוערים · ${s.start_time}–${s.end_time}`;
  }
  const seats = [...new Set(slots.map((s) => s.seat_count))];
  const seatLabel = seats.length === 1 ? `${seats[0]} מאיישים` : "מספר מאיישים משתנה";
  return `${slots.length} משמרות · ${seatLabel} · ${slots[0].start_time}–${slots[0].end_time} (ראשונה)`;
}

export const GUARD_FAIRNESS_REFERENCE = [
  { bucket: "solo", label: "שמירה לבד", default: 1.5, examples: "פטל, נשקייה, תצפיתן, ש״ג רגלי (יום)" },
  { bucket: "pair", label: "שמירה בזוג+", default: 1.0, examples: "ש״ג רכב קדמי, ש״ג רכב אחורי (לילה — 2)" },
  { bucket: "standby_a", label: "כרמל א׳", default: 0.45, examples: "3 צוערים, יום מלא, מטבח במקביל" },
  { bucket: "standby_b", label: "כרמל ב׳", default: 0.15, examples: "3 צוערים, עב״ס/רס״ר + מטבח במקביל" },
  { bucket: "duty", label: "עב״ס / עתודה", default: 0.1, examples: "כוח עתודה (3)" },
  { bucket: "kitchen", label: "מטבח", default: 0.1, examples: "35 למשמרת" },
] as const;
