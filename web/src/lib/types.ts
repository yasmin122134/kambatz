export type IssueType = "exam" | "trial" | "medical" | "weapon" | "other";
export type IssueStatus = "pending" | "approved" | "rejected";

export interface ProfileRequest {
  id: string;
  person_id: string | null;
  person_name: string;
  no_guard: boolean;
  no_standby: boolean;
  no_standing: boolean;
  no_base_work: boolean;
  no_kitchen: boolean;
  status: IssueStatus;
  created_at: string;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  room: string | null;
  gender: "m" | "f" | null;
  /** צוות 1–4 — לשיבוץ מטבח ועב״ס */
  squad?: number | null;
  active: boolean;
  is_admin?: boolean;
  is_officer?: boolean;
  no_guard: boolean;
  no_standby: boolean;
  no_standing: boolean;
  no_base_work: boolean;
  no_kitchen: boolean;
  prior_score: number;
  created_at: string;
}

export type PersonalFlags = Pick<
  Person,
  "no_guard" | "no_standby" | "no_standing" | "no_base_work" | "no_kitchen"
>;

export const PERSONAL_FLAG_LABELS: Record<keyof PersonalFlags, string> = {
  no_guard: "פטור משמירה",
  no_standby: "פטור מכוננות (כרמל א׳ ו-ב׳)",
  no_standing: "פטור עמידה — שיבוץ לתצפיתן בלבד",
  no_base_work: "פטור מעב״ס",
  no_kitchen: "פטור מטבח",
};

export const PERSONAL_FLAG_HINTS: Partial<Record<keyof PersonalFlags, string>> = {
  no_standing: "בשמירות — רק עמדת תצפיתן",
};

export interface Issue {
  id: string;
  person_id: string | null;
  person_name: string;
  /** YYYY-MM-DD — the calendar day this block applies to (Israel). */
  constraint_date: string;
  start_time: string;
  end_time: string;
  issue_type: IssueType;
  note: string | null;
  status: IssueStatus;
  created_at: string;
}

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  exam: "מבחן",
  trial: "התנסות",
  medical: "רפואי",
  weapon: "ללא נשק",
  other: "אחר",
};

export const ISSUE_TYPE_NOTE_PLACEHOLDERS: Record<IssueType, string> = {
  exam: "למשל: מבחן מתמatics, כיתה 312",
  trial: "למשל: התנסות קמ״צ, משרד מפק״ץ",
  medical: "למשל: תור רפואי, פטור ליום",
  weapon: "למשל: החזרת נשק זמנית",
  other: "פרט בקצרה מה החסימה",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  pending: "ממתין לאישור",
  approved: "אושר",
  rejected: "נדחה",
};

export type MissionType = "guards" | "base_work" | "kitchen";
export type MissionStatus = "draft" | "published";

export type MissionPositionKind =
  | "guard"
  | "standby_carmel_a"
  | "standby_carmel_b"
  | "duty"
  | "kitchen"
  | "officer_duty";

export interface KitchenSchedulingRules {
  /** נקודות צדק קבועות לכל משמרת (לא לפי שעות) */
  points_per_shift: boolean;
  /** כמה צוערים בכל משמרת מטבח — תמיד 35 */
  seats_per_shift: number;
  /** לכל משמרת (0-based): מספר הצוות (1–4) שבמנוחה (עדיפות, לא חובה אם חסר כוח) */
  squad_rest_by_shift: number[];
}

export interface BaseWorkSchedulingRules {
  /** יעד צוערים בחלון עב״ס (13–15, בדרך כלל צוות שלם) */
  seats_per_shift: number;
  /** לכל חלון (0-based): צוות במנוחה */
  squad_rest_by_shift: number[];
}

export interface MissionSchedulingRules {
  rest_hours: number;
  guard_ratio: number;
  board_start: string;
  /** אורך משמרת מסתובבת (שעות) */
  shift_hours: number;
  /** מרווח מינימלי (דקות) בין עב״ס לשמירה לאותו צוער */
  duty_guard_gap_minutes?: number;
  /** מזהה קבוצה — שמירות+עב״ס באותו יום */
  guard_day_bundle_id?: string;
  /** משימה מקושרת (שמירות ↔ עב״ס) */
  linked_mission_id?: string;
  kitchen?: KitchenSchedulingRules;
  base_work?: BaseWorkSchedulingRules;
}

export const DEFAULT_KITCHEN_SCHEDULING_RULES: KitchenSchedulingRules = {
  points_per_shift: true,
  seats_per_shift: 35,
  squad_rest_by_shift: [1, 2, 3, 4],
};

export const DEFAULT_BASE_WORK_SCHEDULING_RULES: BaseWorkSchedulingRules = {
  seats_per_shift: 14,
  squad_rest_by_shift: [4, 1, 2],
};

export const DEFAULT_MISSION_SCHEDULING_RULES: MissionSchedulingRules = {
  rest_hours: 7,
  guard_ratio: 2,
  board_start: "20:00",
  shift_hours: 4,
  duty_guard_gap_minutes: 90,
  kitchen: DEFAULT_KITCHEN_SCHEDULING_RULES,
  base_work: DEFAULT_BASE_WORK_SCHEDULING_RULES,
};

export interface MissionSlot {
  id: string;
  start_time: string;
  end_time: string;
  seat_count: number;
  /** Canonical absolute start — authoritative when present */
  starts_at?: string;
  /** Canonical absolute end — authoritative when present */
  ends_at?: string;
}

export interface MissionPosition {
  id: string;
  name: string;
  kind?: MissionPositionKind;
  same_room?: boolean;
  /** כוננות כרמל — כולם מאותו מין */
  same_gender?: boolean;
  slots: MissionSlot[];
}

export interface MissionDay {
  id: string;
  title: string;
  mission_type: MissionType;
  mission_date: string;
  starts_at: string;
  ends_at: string;
  status: MissionStatus;
  positions: MissionPosition[];
  assignments: Record<string, string[]>;
  scheduling_rules: MissionSchedulingRules;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const MISSION_POSITION_KIND_LABELS: Record<MissionPositionKind, string> = {
  guard: "שמירה",
  standby_carmel_a: "כרמל א׳ (כוננות)",
  standby_carmel_b: "כרמל ב׳ (כוננות)",
  duty: "עב״ס / תורנות",
  kitchen: "מטבח / חמגשיות",
  officer_duty: "קצין תורן",
};

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  guards: "יום שמירות",
  base_work: "עבודות בסיס",
  kitchen: "תורנות מטבח",
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  draft: "טיוטה",
  published: "פורסם",
};

export type FairnessBucket =
  | "solo"
  | "pair"
  | "standby"
  | "standby_a"
  | "standby_b"
  | "duty"
  | "kitchen";

export type GuardBandRule = {
  solo: number;
  paired: number;
};

export type FairnessRules = Record<FairnessBucket, number> & {
  hist: number;
  /** Multiplier on guard hours (default 2 — same pattern as כרמל × שעות). */
  guard_hours_factor: number;
  /** Six 4-hour wall-clock bands — scores for a full band before hours factor. */
  guard_bands: GuardBandRule[];
  /** Rest-penalty tiers: ≥16h, ≥12h, …, under 4h (mirrors getRestPenalty). */
  rest_penalties: number[];
};

export const DEFAULT_GUARD_BANDS: GuardBandRule[] = [
  { solo: 10, paired: 7 }, // 00:00–04:00
  { solo: 9, paired: 6 }, // 04:00–08:00
  { solo: 4, paired: 1 }, // 08:00–12:00 — זוג = 2 נק׳/4ש׳ with factor 2
  { solo: 9, paired: 6 }, // 12:00–16:00
  { solo: 6, paired: 3 }, // 16:00–20:00
  { solo: 7, paired: 4 }, // 20:00–00:00
];

export const DEFAULT_REST_PENALTIES = [0, 1, 2, 3, 4, 5, 7, 9, 12] as const;

export const DEFAULT_FAIRNESS_RULES: FairnessRules = {
  solo: 1.5,
  pair: 1.0,
  standby: 0.15,
  standby_a: 0.45,
  standby_b: 0.15,
  duty: 0.1,
  kitchen: 0.1,
  hist: 0.7,
  guard_hours_factor: 2,
  guard_bands: DEFAULT_GUARD_BANDS.map((b) => ({ ...b })),
  rest_penalties: [...DEFAULT_REST_PENALTIES],
};
export interface FairnessRuleRequest {
  id: string;
  person_id: string | null;
  person_name: string;
  proposed_rules: FairnessRules;
  note: string;
  status: IssueStatus;
  created_at: string;
}

export const FAIRNESS_BUCKET_LABELS: Record<FairnessBucket, string> = {
  solo: "שמירה לבד (לשעה)",
  pair: "שמירה בזוג (לשעה)",
  standby: "כוננות (לשעה)",
  standby_a: "כרמל א׳ — כוננות (לשעה)",
  standby_b: "כרמל ב׳ — כוננות (לשעה)",
  duty: "עבודות בסיס (לשעה)",
  kitchen: "תורנות מטבח (למשמרת)",
};

export const FAIRNESS_BUCKET_HELP: Record<FairnessBucket, string> = {
  solo: "משמרת שמירה כשמאיישים יחיד בעמדה",
  pair: "משמרת שמירה עם 2+ מאיישים",
  standby: "כיתת כוננות (כללי)",
  standby_a: "כרמל א׳ — כוננות מלאה, משמעותית קשה יותר",
  standby_b: "כרמל ב׳ — כוננות",
  duty: "עב״ס, עתודה ומשימות בסיס",
  kitchen: "חמגשיות ותורנות מטבח — נקודה קבועה לכל משמרת",
};

export type PersonMissionHistoryItem = {
  id: string;
  missionId: string;
  missionTitle: string;
  missionDate: string;
  missionType: MissionType;
  positionName: string;
  timeLabel: string;
  hours: number;
  bucket: FairnessBucket;
  points: number;
  /** Guard burden model — base time-of-day score */
  burdenBase?: number;
  /** Guard burden model — rest penalty before this shift */
  burdenRest?: number;
  burdenIsSolo?: boolean;
};

export type PersonFairnessStats = {
  rules: FairnessRules;
  priorScore: number;
  periodPoints: number;
  totalPoints: number;
  history: PersonMissionHistoryItem[];
  burden?: {
    guardBaseBurden: number;
    restPenalties: number;
    otherMissionPoints: number;
    kitchenPoints: number;
    dutyPoints: number;
    guardAssignmentCount: number;
    totalBurden: number;
  };
};

export const SCHEDULER_FAIRNESS_EXPLANATION = [
  "שמירות — ניקוד עומס לפי שעה ביום, סולו/זוג, ומנוחה בין משימות.",
  "משמרת 00:00–04:00 סולו = 20 נק׳ בסיס; זוג = 14. 08:00–12:00 זוג = 2 (2× שעות).",
  "מנוחה קצרה בין משימות מוסיפה עונש (למשל פחות מ-7 שעות = +4).",
  "מטבח, כוננות, עב״ס — עדיין לפי טבלת הצדק.",
  "בכל שיבוץ נבחר מי שעומס הנקודות שלו הכי נמוך (כולל ניקוד קודם).",
];
