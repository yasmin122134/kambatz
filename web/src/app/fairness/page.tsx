"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  EDITABLE_FAIRNESS_BUCKETS,
  editableBucketHelp,
  editableBucketLabel,
  FAIRNESS_OVERVIEW,
  guardBandRows,
  GUARD_SCORING_EXPLANATION,
  mergeProposedFairnessRules,
  MISSION_TO_BUCKET,
  REST_PENALTY_EXPLANATION,
  SOLO_PAIR_DEFINITION,
  SQUAD_EXPLANATION,
} from "@/lib/fairness-display";
import { REST_PENALTY_TIERS } from "@/lib/guard-burden";
import {
  DEFAULT_FAIRNESS_RULES,
  type FairnessRules,
} from "@/lib/types";

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
      body: JSON.stringify({
        proposed_rules: mergeProposedFairnessRules(rules, proposed),
        note,
      }),
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
        <main className="mx-auto max-w-3xl px-5 py-8">
          <p className="hint">טוען…</p>
        </main>
      </AppShell>
    );
  }

  const guardBands = guardBandRows();

  return (
    <AppShell title="טבלת צדק">
      <main className="mx-auto max-w-3xl px-5 py-8 space-y-6">
        <div className="card">
          <h2 className="font-display text-xl mb-2">איך מחושב עומס?</h2>
          <p className="lede mb-3">
            השיבוץ החכם בוחר את מי שציון העומס שלו הכי נמוך. הציון משקף את מה שכבר
            שובץ בתקופה, בתוספת התאמה מהניקוד הקודם של הצוער.
          </p>
          <p className="text-sm font-medium mb-1">
            ציון לשיבוץ = עומס בתקופה + (ניקוד_קודם − ממוצע) × {rules.hist}
          </p>
          <ul className="text-sm text-ink2 space-y-1 list-disc list-inside">
            {FAIRNESS_OVERVIEW.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="card space-y-4">
          <div>
            <h3 className="font-display text-lg mb-1">שמירות — טבלת שעות</h3>
            <p className="text-sm text-ink2 mb-2">
              קבועה בקוד (לא ניתנת לעריכה דרך הטבלה). זו הטבלה שבאמת קובעת עומס
              שמירה.
            </p>
            <ul className="text-sm text-ink2 space-y-1 list-disc list-inside mb-3">
              {GUARD_SCORING_EXPLANATION.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="text-sm bg-surface2 rounded-lg p-3 space-y-1">
            <p>
              <span className="font-medium">סולו:</span> {SOLO_PAIR_DEFINITION.solo}
            </p>
            <p>
              <span className="font-medium">זוג+:</span> {SOLO_PAIR_DEFINITION.pair}
            </p>
          </div>

          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>רצועת 4 שעות</th>
                  <th>סולו (נק׳)</th>
                  <th>זוג+ (נק׳)</th>
                  <th>הערה</th>
                </tr>
              </thead>
              <tbody>
                {guardBands.map((row) => (
                  <tr key={row.label}>
                    <td className="font-medium mono">{row.label}</td>
                    <td className="mono font-bold text-accent">{row.solo}</td>
                    <td className="mono font-bold">{row.pair}</td>
                    <td className="text-ink2 text-xs">{row.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-display text-lg">עונש מנוחה בין משימות (שמירות)</h3>
          <ul className="text-sm text-ink2 space-y-1 list-disc list-inside">
            {REST_PENALTY_EXPLANATION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>פער מנוחה בין משימות</th>
                  <th>עונש (נק׳)</th>
                </tr>
              </thead>
              <tbody>
                {REST_PENALTY_TIERS.map((tier) => (
                  <tr key={tier.restHoursLabel}>
                    <td>{tier.restHoursLabel}</td>
                    <td className="mono font-bold text-accent">+{tier.penalty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-display text-lg">משימות אחרות — נקודות לשעה / למשמרת</h3>
          <p className="text-sm text-ink2">
            ערכים אלה ניתנים להצעת שינוי (לאחר אישור מפקד). ברירת המחדל מוצגת
            בעמודה «נוכחי».
          </p>
          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>סוג</th>
                  <th>איך מחושב</th>
                  <th>נוכחי</th>
                  <th>הסבר</th>
                </tr>
              </thead>
              <tbody>
                {EDITABLE_FAIRNESS_BUCKETS.map((bucket) => (
                  <tr key={bucket}>
                    <td className="font-medium">{editableBucketLabel(bucket)}</td>
                    <td className="text-ink2 text-xs">
                      {bucket === "kitchen" ? "קבוע לכל משמרת" : "× שעות המשמרת"}
                    </td>
                    <td className="mono font-bold text-accent">{rules[bucket]}</td>
                    <td className="text-ink2 text-xs">{editableBucketHelp(bucket)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">משקל ניקוד קודם (hist)</td>
                  <td className="text-ink2 text-xs">× (ניקוד_קודם − ממוצע)</td>
                  <td className="mono font-bold text-accent">{rules.hist}</td>
                  <td className="text-ink2 text-xs">
                    כמה לספור נקודות מימים/תקופות קודמות באיזון השיבוץ
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-display text-lg">מיפוי משימה → חישוב</h3>
          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>משימה</th>
                  <th>איך נמדד עומס</th>
                  <th>ניתן לערוך?</th>
                </tr>
              </thead>
              <tbody>
                {MISSION_TO_BUCKET.map((row) => (
                  <tr key={row.mission}>
                    <td className="font-medium">{row.mission}</td>
                    <td>{row.scoring}</td>
                    <td>{row.editable ? "כן — בטבלה למעלה" : "לא — קבוע בקוד"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-2">
          <h3 className="font-display text-lg">חלוקה לצוותים (1–4)</h3>
          <ul className="text-sm text-ink2 space-y-1 list-disc list-inside">
            {SQUAD_EXPLANATION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {loggedIn ? (
          <form onSubmit={submit} className="card space-y-4">
            <h3 className="font-display text-base">הצעת שינוי לערכים הניתנים לעריכה</h3>
            <p className="hint text-sm">
              ניתן לערוך רק כרמל א/ב, עב״ס/עתודה, מטבch ומשקל hist. טבלת השעות
              לשמירות ועונש המנוחה קבועים בקוד.
            </p>

            <div className="space-y-3">
              {EDITABLE_FAIRNESS_BUCKETS.map((bucket) => (
                <div key={bucket} className="rowf items-end">
                  <div className="field flex-[2]">
                    <label>{editableBucketLabel(bucket)}</label>
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
                  <p className="hint text-xs flex-1 pb-2">נוכחי: {rules[bucket]}</p>
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
                <p className="hint text-xs mt-1">נוכחי: {rules.hist}</p>
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
                placeholder="למשל: להעלות כרמל א׳ ל-0.5 כי הכוננות קשה יותר"
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
