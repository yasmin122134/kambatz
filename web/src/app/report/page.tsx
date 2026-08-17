"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { NameCombobox } from "@/components/NameCombobox";
import { createClient } from "@/lib/supabase/client";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPE_NOTE_PLACEHOLDERS,
  ISSUE_STATUS_LABELS,
  type Issue,
  type IssueType,
  type Person,
} from "@/lib/types";

const TIME_PRESETS = [
  { label: "בוקר (07:00–12:00)", start: "07:00", end: "12:00" },
  { label: "צהריים (12:00–17:00)", start: "12:00", end: "17:00" },
  { label: "ערב (17:00–21:00)", start: "17:00", end: "21:00" },
  { label: "לילה (21:00–07:00)", start: "21:00", end: "07:00" },
];

export default function ReportPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [myIssues, setMyIssues] = useState<Issue[]>([]);
  const [personName, setPersonName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [issueType, setIssueType] = useState<IssueType>("trial");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then(setPeople)
      .catch(() => setMessage({ ok: false, text: "לא הצלחתי לטעון רשימת שמות" }));

    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const me = await fetch("/api/me");
      if (me.ok) {
        const p = await me.json();
        if (p.name) setPersonName(p.name);
      }
    })();
  }, []);

  useEffect(() => {
    if (!personName) {
      setMyIssues([]);
      return;
    }
    fetch(`/api/issues?person_name=${encodeURIComponent(personName)}`)
      .then((r) => r.json())
      .then(setMyIssues)
      .catch(() => {});
  }, [personName, message]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const res = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_name: personName,
        start_time: startTime,
        end_time: endTime,
        issue_type: issueType,
        note: note || null,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setMessage({ ok: false, text: data.error || "שגיאה בשליחה" });
      return;
    }

    setMessage({
      ok: true,
      text: "הדיווח נשלח! ממתין לאישור מפקד — לא תשובצו לשום דבר בשעות האלה אחרי האישור.",
    });
    setNote("");
  }

  return (
    <PageShell
      title="דיווח חסימת שעות"
      lede="בחרו שם, שעות, סוג חסימה (מבחן, התנסות, רפואי…), והסבירו בקצרה למה. המפקד יאשר — ואז המחולל יכבד את זה אוטומטית."
    >
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="field">
          <label htmlFor="person">השם שלי</label>
          <NameCombobox
            id="person"
            required
            value={personName}
            onChange={setPersonName}
            placeholder="הקלידו או בחרו מהרשימה"
          />
          {people.length === 0 && (
            <p className="hint">אין שמות עדיין — המפקד צריך להוסיף את המחזור בלשונית ניהול.</p>
          )}
        </div>

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

        <div className="rowf">
          <div className="field">
            <label htmlFor="start">משעה</label>
            <input
              id="start"
              type="time"
              required
              className="mono"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="end">עד שעה</label>
            <input
              id="end"
              type="time"
              required
              className="mono"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="type">סוג החסימה</label>
          <select
            id="type"
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
          <label htmlFor="note">הסבר קצר</label>
          <textarea
            id="note"
            rows={2}
            required
            placeholder={ISSUE_TYPE_NOTE_PLACEHOLDERS[issueType]}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="hint">למשל: שם קורס, חדר, או סיבה — כדי שהמפקד יבין.</p>
        </div>

        {message && (
          <p className={message.ok ? "msg-ok" : "msg-err"}>{message.text}</p>
        )}

        <button type="submit" className="btn-pri" disabled={loading || !personName || !note.trim()}>
          {loading ? "שולח…" : "שלח דיווח"}
        </button>
      </form>

      {personName && myIssues.length > 0 && (
        <div className="card mt-6">
          <h3 className="font-display text-base mb-3">הדיווחים שלי</h3>
          <ul className="space-y-2 text-sm">
            {myIssues.map((iss) => (
              <li key={iss.id} className="flex flex-wrap gap-2 items-center border-b border-line2 pb-2">
                <span className="mono">{iss.start_time}–{iss.end_time}</span>
                <span>{ISSUE_TYPE_LABELS[iss.issue_type]}</span>
                <span className={`tag tag-${iss.status}`}>
                  {ISSUE_STATUS_LABELS[iss.status]}
                </span>
                {iss.note && <span className="text-ink2">{iss.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
