import type { IssueType } from "@/lib/types";

export type IssuePayloadInput = {
  constraint_date?: string;
  start_time?: string;
  end_time?: string;
  issue_type?: IssueType;
  note?: string | null;
};

export function parseIssuePayload(body: IssuePayloadInput): {
  constraint_date: string;
  start_time: string;
  end_time: string;
  issue_type: IssueType;
  note: string;
} | { error: string } {
  const constraint_date = String(body.constraint_date || "").trim().slice(0, 10);
  const start_time = String(body.start_time || "").trim();
  const end_time = String(body.end_time || "").trim();
  const issue_type = body.issue_type;
  const note = body.note ? String(body.note).trim() : "";

  if (!constraint_date || !start_time || !end_time || !issue_type) {
    return { error: "חסרים שדות חובה" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(constraint_date)) {
    return { error: "פורמט תאריך לא תקין (YYYY-MM-DD)" };
  }
  if (!note) {
    return { error: "יש לכתוב הערה קצרה שמסבירה את החסימה" };
  }
  if (!/^\d{1,2}:\d{2}$/.test(start_time) || !/^\d{1,2}:\d{2}$/.test(end_time)) {
    return { error: "פורמט שעה לא תקין (HH:MM)" };
  }
  const validTypes = ["exam", "trial", "medical", "weapon", "other"] as const;
  if (!validTypes.includes(issue_type as (typeof validTypes)[number])) {
    return { error: "סוג אילוץ לא תקין" };
  }

  return {
    constraint_date,
    start_time,
    end_time,
    issue_type: issue_type as IssueType,
    note,
  };
}
