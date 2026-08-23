"use client";

import { FormEvent, useEffect, useState } from "react";
import { NameCombobox } from "@/components/NameCombobox";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPE_NOTE_PLACEHOLDERS,
  PERSONAL_FLAG_HINTS,
  PERSONAL_FLAG_LABELS,
  type IssueType,
  type Person,
  type PersonalFlags,
} from "@/lib/types";

const FLAG_KEYS = Object.keys(PERSONAL_FLAG_LABELS) as (keyof PersonalFlags)[];

const TIME_PRESETS = [
  { label: "בוקר (07:00–12:00)", start: "07:00", end: "12:00" },
  { label: "צהריים (12:00–17:00)", start: "12:00", end: "17:00" },
  { label: "ערב (17:00–21:00)", start: "17:00", end: "21:00" },
  { label: "לילה (21:00–07:00)", start: "21:00", end: "07:00" },
];

const EMPTY_FLAGS: PersonalFlags = {
  no_guard: false,
  no_standby: false,
  no_standing: false,
  no_base_work: false,
  no_kitchen: false,
};

type Props = {
  people: Person[];
  onSaved: () => void;
  /** Default calendar date for time blocks (e.g. active board day). */
  defaultDate?: string;
};

export function AdminManualConstraints({ people, onSaved, defaultDate }: Props) {
  const [mode, setMode] = useState<"flags" | "block">("flags");
  const [personName, setPersonName] = useState("");
  const [flags, setFlags] = useState<PersonalFlags>(EMPTY_FLAGS);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [constraintDate, setConstraintDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [issueType, setIssueType] = useState<IssueType>("trial");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = people.find((p) => p.name === personName);

  useEffect(() => {
    if (defaultDate) setConstraintDate(defaultDate.slice(0, 10));
  }, [defaultDate]);

  useEffect(() => {
    if (!selected) {
      setFlags(EMPTY_FLAGS);
      return;
    }
    setFlags({
      no_guard: !!selected.no_guard,
      no_standby: !!selected.no_standby,
      no_standing: !!selected.no_standing,
      no_base_work: !!selected.no_base_work,
      no_kitchen: !!selected.no_kitchen,
    });
  }, [selected]);

  async function saveFlags(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    setError("");

    const res = await fetch("/api/people", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, ...flags }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "שגיאה בשמירה");
      return;
    }

    setMessage("הסימונים נשמרו — נכנסים לשיבוץ מיד");
    onSaved();
  }

  async function saveBlock(e: FormEvent) {
    e.preventDefault();
    if (!personName.trim()) return;
    setSaving(true);
    setMessage("");
    setError("");

    const res = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_name: personName,
        constraint_date: constraintDate,
        start_time: startTime,
        end_time: endTime,
        issue_type: issueType,
        note: note.trim(),
        approved: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "שגיאה בשמירה");
      return;
    }

    setMessage("חסימת השעות נוספה ואושרה — תיכנס למחולל אוטומטית");
    setNote("");
    onSaved();
  }

  return (
    <section className="card mb-6">
      <h3 className="font-display text-base mb-2">אילוצים ידניים</h3>
      <p className="lede mb-4">
        הזינו פטורי שיבוץ או חסימות שעות ישירות — בלי לחכות לדיווח/אישור
        מהצוער.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          type="button"
          className={`btn-sm ${mode === "flags" ? "on" : ""}`}
          onClick={() => {
            setMode("flags");
            setMessage("");
            setError("");
          }}
        >
          סימונים אישיים
        </button>
        <button
          type="button"
          className={`btn-sm ${mode === "block" ? "on" : ""}`}
          onClick={() => {
            setMode("block");
            setMessage("");
            setError("");
          }}
        >
          חסימת שעות
        </button>
      </div>

      <div className="field mb-4">
        <label htmlFor="constraint-person">צוער</label>
        <NameCombobox
          id="constraint-person"
          value={personName}
          onChange={setPersonName}
          placeholder="בחרו שם מהמחזור"
        />
      </div>

      {mode === "flags" ? (
        <form onSubmit={saveFlags} className="space-y-4">
          <div className="space-y-2">
            {FLAG_KEYS.map((key) => (
              <label
                key={key}
                className="flex flex-col items-end gap-0.5 cursor-pointer w-full"
              >
                <span className="flex flex-row-reverse items-center justify-end gap-3 w-fit max-w-full">
                  <input
                    type="checkbox"
                    className="shrink-0 size-4"
                    checked={flags[key]}
                    disabled={!selected}
                    onChange={(e) =>
                      setFlags((f) => ({ ...f, [key]: e.target.checked }))
                    }
                  />
                  <span className="text-right">{PERSONAL_FLAG_LABELS[key]}</span>
                </span>
                {PERSONAL_FLAG_HINTS[key] && (
                  <span className="text-xs text-ink3 pr-7">
                    {PERSONAL_FLAG_HINTS[key]}
                  </span>
                )}
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="btn-pri btn-sm"
            disabled={saving || !selected}
          >
            {saving ? "שומר…" : "שמור סימונים"}
          </button>
        </form>
      ) : (
        <form onSubmit={saveBlock} className="space-y-4">
          <div className="field">
            <label>קיצורי דרך</label>
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
          </div>

          <div className="field">
            <label htmlFor="c-date">תאריך</label>
            <input
              id="c-date"
              type="date"
              required
              className="mono"
              value={constraintDate}
              onChange={(e) => setConstraintDate(e.target.value)}
            />
          </div>

          <div className="rowf">
            <div className="field">
              <label htmlFor="c-start">משעה</label>
              <input
                id="c-start"
                type="time"
                required
                className="mono"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="c-end">עד שעה</label>
              <input
                id="c-end"
                type="time"
                required
                className="mono"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-type">סוג החסימה</label>
            <select
              id="c-type"
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
            <label htmlFor="c-note">הסבר</label>
            <textarea
              id="c-note"
              rows={2}
              required
              placeholder={ISSUE_TYPE_NOTE_PLACEHOLDERS[issueType]}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn-pri btn-sm"
            disabled={saving || !personName.trim() || !note.trim()}
          >
            {saving ? "שומר…" : "הוסף חסימה מאושרת"}
          </button>
        </form>
      )}

      {error && <p className="msg-err mt-3">{error}</p>}
      {message && <p className="msg-ok mt-3">{message}</p>}

      <p className="hint mt-4">
        סימונים נשמרים ישירות בפרופיל ובמחולל. חסימות שעות נכנסות מיד ללשונית 06
        · חסימות.
      </p>
    </section>
  );
}
