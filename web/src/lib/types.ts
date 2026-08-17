export type IssueType = "exam" | "trial" | "medical" | "weapon" | "other";
export type IssueStatus = "pending" | "approved" | "rejected";

export interface Person {
  id: string;
  name: string;
  room: string | null;
  gender: "m" | "f" | null;
  active: boolean;
  km: boolean;
  exam: boolean;
  no_weapon: boolean;
  no_guard: boolean;
  no_mag: boolean;
  prior_score: number;
  created_at: string;
}

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
