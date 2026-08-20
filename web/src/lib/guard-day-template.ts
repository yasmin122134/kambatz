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

function rearVehicleSlots(dayStart: string, dayEnd: string, shift: number, board: string): MissionSlot[] {
  const tour = { boardStart: board };
  return [
    ...buildRotatedSlots(dayStart, dayEnd, 1, shift, tour),
    ...buildRotatedSlots(dayEnd, dayStart, 2, shift, tour),
  ];
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
    guardPosition("ש״ג רכב אחורי", rearVehicleSlots(day[0], day[1], shift, board)),
    guardPosition("ש״ג רכב קדמי", buildRotatedSlots("00:00", "00:00", 2, shift, tour)),
    guardPosition("פטל", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition("תצפיתן", buildRotatedSlots("00:00", "00:00", 1, shift, tour)),
    guardPosition("ש״ג רגלי", buildRotatedSlots(day[0], day[1], 1, shift)),
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

export const GUARD_FAIRNESS_REFERENCE = [
  { bucket: "solo", label: "שמירה לבד", default: 1.5, examples: "פטל, נשקייה, תצפיתן, ש״ג רגלי (יום)" },
  { bucket: "pair", label: "שמירה בזוג+", default: 1.0, examples: "ש״ג רכב קדמי, ש״ג רכב אחורי (לילה — 2)" },
  { bucket: "standby_a", label: "כרמל א׳", default: 0.45, examples: "3 צוערים, יום מלא, מטבח במקביל" },
  { bucket: "standby_b", label: "כרמל ב׳", default: 0.15, examples: "3 צוערים, עב״ס/רס״ר + מטבח במקביל" },
  { bucket: "duty", label: "עב״ס / עתודה", default: 0.1, examples: "כוח עתודה (3)" },
  { bucket: "kitchen", label: "מטבח", default: 0.1, examples: "35 למשמרת" },
] as const;
