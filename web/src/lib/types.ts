export type IssueType = "exam" | "trial" | "medical" | "weapon" | "other";
export type IssueStatus = "pending" | "approved" | "rejected";

export interface Person {
  id: string;
  name: string;
  room: string | null;
  gender: "m" | "f" | null;
  active: boolean;
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
  trial: "התנסות / בלת״ם לוז",
  medical: "רפואי / פטור זמני",
  weapon: "ללא נשק / החזרת נשק",
  other: "אחר",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  pending: "ממתין לאישור",
  approved: "אושר",
  rejected: "נדחה",
};
