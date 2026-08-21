"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
  ISSUE_STATUS_LABELS,
  SCHEDULER_FAIRNESS_EXPLANATION,
  type FairnessBucket,
  type FairnessRules,
} from "@/lib/types";

const BUCKETS = Object.keys(FAIRNESS_BUCKET_LABELS) as FairnessBucket[];

export default function FairnessPage() {
  const [rules, setRules] = useState<FairnessRules>(DEFAULT_FAIRNESS_RULES);
  const [proposed, setProposed] = useState<FairnessRules>(DEFAULT_FAIRNESS_RULES);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/fairness").then((r) => r.json()),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([fair, me]) => {
        const r = fair.rules || DEFAULT_FAIRNESS_RULES;
        setRules(r);
        setProposed(r);
        setLoggedIn(!!me?.name);
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const res = await fetch("/api/fairness/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposed_rules: proposed, note }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "שגיאה בשליחה");
      return;
    }

    setMessage("ההצעה נשלחה — ממתינה לאישור מפקד");
    setNote("");
  }

  if (loading) {
    return (
      <AppShell title="טבלת צדק">
        <main className="mx-auto max-w-lg px-5 py-8">
          <p className="hint">טוען…</p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell title="טבלת צדק">
      <main className="mx-auto max-w-2xl px-5 py-8 space-y-6">
        <div className="card">
          <h2 className="font-display text-xl mb-2">טבלת צדק</h2>
          <p className="lede mb-4">
            נקודות לשעת משימה — כך המחולל מאזן שיבוצים. כולם רואים את הטבלה;
            שינוי דורש הצעה ואישור מפקד.
          </p>
          <ul className="text-sm text-ink2 space-y-1 mb-4 list-disc list-inside">
            {SCHEDULER_FAIRNESS_EXPLANATION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>סוג משימה</th>
                  <th>נקודות לשעה</th>
                  <th>הסבר</th>
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map((bucket) => (
                  <tr key={bucket}>
                    <td className="font-medium">{FAIRNESS_BUCKET_LABELS[bucket]}</td>
                    <td className="mono font-bold text-accent">{rules[bucket]}</td>
                    <td className="text-ink2 text-xs">{FAIRNESS_BUCKET_HELP[bucket]}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">משקל ניקוד קודם</td>
                  <td className="mono">{rules.hist}</td>
                  <td className="text-ink2 text-xs">
                    כמה לספור נקודות מימים קודמים באיזון
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {loggedIn ? (
          <form onSubmit={submit} className="card space-y-4">
            <h3 className="font-display text-base">הצעת שינוי לטבלה</h3>
            <p className="hint text-sm">
              ערכו את הערכים המוצעים והסבירו למה — כמו בדיווח אילוץ.
            </p>

            <div className="space-y-3">
              {BUCKETS.map((bucket) => (
                <div key={bucket} className="rowf items-end">
                  <div className="field flex-[2]">
                    <label>{FAIRNESS_BUCKET_LABELS[bucket]}</label>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      value={proposed[bucket]}
                      onChange={(e) =>
                        setProposed((p) => ({
                          ...p,
                          [bucket]: parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <p className="hint text-xs flex-1 pb-2">
                    נוכחי: {rules[bucket]}
                  </p>
                </div>
              ))}
              <div className="field">
                <label>משקל ניקוד קודם (hist)</label>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  value={proposed.hist}
                  onChange={(e) =>
                    setProposed((p) => ({
                      ...p,
                      hist: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="fair-note">הסבר לשינוי</label>
              <textarea
                id="fair-note"
                rows={2}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="למשל: שמירה בזוג קשה יותר — להעלות ל-1.2"
              />
            </div>

            {error && <p className="msg-err">{error}</p>}
            {message && <p className="msg-ok">{message}</p>}

            <button type="submit" className="btn-pri" disabled={saving || !note.trim()}>
              {saving ? "שולח…" : "שלח הצעה לאישור מפקד"}
            </button>
          </form>
        ) : (
          <div className="card">
            <p className="lede mb-3">רוצים להציע שינוי? התחברו תחילה.</p>
            <Link href="/login?next=/fairness" className="btn-pri btn-sm">
              התחברות
            </Link>
          </div>
        )}
      </main>
    </AppShell>
  );
}
