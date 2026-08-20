export type IssueType = "exam" | "trial" | "medical" | "weapon" | "other";
export type IssueStatus = "pending" | "approved" | "rejected";

export interface ProfileRequest {
  id: string;
  person_id: string | null;
  person_name: string;
  km: boolean;
  exam: boolean;
  no_weapon: boolean;
  no_guard: boolean;
  no_mag: boolean;
  status: IssueStatus;
  created_at: string;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  room: string | null;
  gender: "m" | "f" | null;
  active: boolean;
  is_admin?: boolean;
  km: boolean;
  exam: boolean;
  no_weapon: boolean;
  no_guard: boolean;
  no_mag: boolean;
  prior_score: number;
  created_at: string;
}

export type PersonalFlags = Pick<
  Person,
  "km" | "exam" | "no_weapon" | "no_guard" | "no_mag"
>;

export const PERSONAL_FLAG_LABELS: Record<keyof PersonalFlags, string> = {
  km: "כושר מיוחד (כ״מ)",
  exam: "יש לי מבחן — העדיפו כוננות",
  no_weapon: "ללא נשק — רק חמגשיות/עב״ס",
  no_guard: "פטור שמירה",
  no_mag: "פטור מחסניות",
};

export interface Issue {
  id: string;
  person_id: string | null;
  person_name: string;
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

export interface MissionSlot {
  id: string;
  start_time: string;
  end_time: string;
  seat_count: number;
}

export interface MissionPosition {
  id: string;
  name: string;
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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  guards: "יום שמירות",
  base_work: "עבודות בסיס",
  kitchen: "תורנות מטבח",
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  draft: "טיוטה",
  published: "פורסם",
};

export type FairnessBucket = "solo" | "pair" | "standby" | "duty" | "kitchen";

export type FairnessRules = Record<FairnessBucket, number> & { hist: number };

export interface FairnessRuleRequest {
  id: string;
  person_id: string | null;
  person_name: string;
  proposed_rules: FairnessRules;
  note: string;
  status: IssueStatus;
  created_at: string;
}

export const DEFAULT_FAIRNESS_RULES: FairnessRules = {
  solo: 1.5,
  pair: 1.0,
  standby: 0.15,
  duty: 0.1,
  kitchen: 0.1,
  hist: 0.7,
};

export const FAIRNESS_BUCKET_LABELS: Record<FairnessBucket, string> = {
  solo: "שמירה לבד (לשעה)",
  pair: "שמירה בזוג (לשעה)",
  standby: "כוננות (לשעה)",
  duty: "עבודות בסיס (לשעה)",
  kitchen: "תורנות מטבח (לשעה)",
};

export const FAIRNESS_BUCKET_HELP: Record<FairnessBucket, string> = {
  solo: "משמרת שמירה כשמאיישים יחיד בעמדה",
  pair: "משמרת שמירה עם 2+ מאיישים",
  standby: "כיתת כוננות",
  duty: "עב״ס, עתודה ומשימות בסיס",
  kitchen: "חמגשיות ותורנות מטבח",
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
};

export type PersonFairnessStats = {
  rules: FairnessRules;
  priorScore: number;
  periodPoints: number;
  totalPoints: number;
  history: PersonMissionHistoryItem[];
};
