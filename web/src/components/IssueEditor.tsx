"use client";

import { FormEvent, useState } from "react";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPE_NOTE_PLACEHOLDERS,
  ISSUE_STATUS_LABELS,
  type Issue,
  type IssueType,
} from "@/lib/types";

const TIME_PRESETS = [
  { label: "בוקר", start: "07:00", end: "12:00" },
  { label: "צהריים", start: "12:00", end: "17:00" },
  { label: "ערב", start: "17:00", end: "21:00" },
  { label: "לילה", start: "21:00", end: "07:00" },
];

type Props = {
  issue: Issue;
  onSaved: (issue: Issue) => void;
  onCancel: () => void;
  onDeleted: (id: string) => void;
};

export function IssueEditor({
  issue,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const [constraintDate, setConstraintDate] = useState(issue.constraint_date);
  const [startTime, setStartTime] = useState(issue.start_time);
  const [endTime, setEndTime] = useState(issue.end_time);
  const [issueType, setIssueType] = useState<IssueType>(issue.issue_type);
  const [note, setNote] = useState(issue.note || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        constraint_date: constraintDate,
        start_time: startTime,
        end_time: endTime,
        issue_type: issueType,
        note,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "שגיאה בשמירה");
      return;
    }
    onSaved(data);
  }

  async function remove() {
    if (!confirm("למחוק את האילוץ?")) return;
    setDeleting(true);
    setError("");
    const res = await fetch(`/api/issues/${issue.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      setError(data.error || "שגיאה במחיקה");
      return;
    }
    onDeleted(issue.id);
  }

  return (
    <form onSubmit={save} className="space-y-3 border border-line2 rounded-lg p-3 mt-2">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className={`tag tag-${issue.status}`}>
          {ISSUE_STATUS_LABELS[issue.status]}
        </span>
        {issue.status === "approved" && (
          <span className="hint text-xs">עריכה תחזיר לאישור מפקד</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TIME_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn-sm"
            onClick={() => {
              setStartTime(p.start);
              setEndTime(p.end);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor={`date-${issue.id}`}>תאריך</label>
        <input
          id={`date-${issue.id}`}
          type="date"
          required
          className="mono"
          value={constraintDate}
          onChange={(e) => setConstraintDate(e.target.value)}
        />
      </div>

      <div className="rowf">
        <div className="field">
          <label htmlFor={`start-${issue.id}`}>משעה</label>
          <input
            id={`start-${issue.id}`}
            type="time"
            required
            className="mono"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`end-${issue.id}`}>עד שעה</label>
          <input
            id={`end-${issue.id}`}
            type="time"
            required
            className="mono"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`type-${issue.id}`}>סוג</label>
        <select
          id={`type-${issue.id}`}
          required
          value={issueType}
          onChange={(e) => setIssueType(e.target.value as IssueType)}
        >
          {Object.entries(ISSUE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`note-${issue.id}`}>הסבר</label>
        <textarea
          id={`note-${issue.id}`}
          rows={2}
          required
          placeholder={ISSUE_TYPE_NOTE_PLACEHOLDERS[issueType]}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="msg-err">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-pri btn-sm" disabled={saving || deleting}>
          {saving ? "שומר…" : "שמור"}
        </button>
        <button type="button" className="btn-sm" onClick={onCancel} disabled={saving || deleting}>
          ביטול
        </button>
        <button
          type="button"
          className="btn-sm text-red-600"
          onClick={remove}
          disabled={saving || deleting}
        >
          {deleting ? "מוחק…" : "מחק"}
        </button>
      </div>
    </form>
  );
}
