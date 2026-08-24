"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  BASE_WORK_SCORING_EXPLANATION,
  FAIRNESS_OVERVIEW,
  FAIRNESS_POINT_CATEGORIES,
  GUARD_SCORING_EXPLANATION,
  HOURLY_RATE_ROWS,
  hourlyRateRows,
  mergeProposedFairnessRules,
  REST_PENALTY_EXPLANATION,
  SQUAD_EXPLANATION,
} from "@/lib/fairness-display";
import { REST_PENALTY_TIERS, restPenaltyTiersFromRules } from "@/lib/guard-burden";
import {
  DEFAULT_FAIRNESS_RULES,
  type FairnessHourlyRates,
  type FairnessRules,
} from "@/lib/types";

function cloneRules(rules: FairnessRules): FairnessRules {
  return {
    ...rules,
    guard_bands: rules.guard_bands.map((band) => ({ ...band })),
    rest_penalties: [...rules.rest_penalties],
    hourly_rates: { ...rules.hourly_rates },
  };
}

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
        const r = cloneRules(fair.rules || DEFAULT_FAIRNESS_RULES);
        setRules(r);
        setProposed(cloneRules(r));
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

  function setHourlyRate(key: keyof FairnessHourlyRates, value: number) {
    setProposed((p) => ({
      ...p,
      hourly_rates: { ...p.hourly_rates, [key]: value },
    }));
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

  const rateRows = hourlyRateRows(rules);
  const restTiers = restPenaltyTiersFromRules(rules);

  return (
    <AppShell title="טבלת צדק">
      <main className="mx-auto max-w-3xl px-5 py-8 space-y-6">
        <div className="card">
          <h2 className="font-display text-xl mb-2">איך מחושב עומס?</h2>
          <p className="lede mb-3">
            השיבוץ החכם בוחר את מי שציון העומס שלו הכי נמוך. הציון מחולק לשלוש
            קטגוריות:
          </p>
          <ul className="text-sm space-y-2 mb-3">
            {FAIRNESS_POINT_CATEGORIES.map((cat) => (
              <li key={cat.title}>
                <span className="font-medium">{cat.title}</span>
                <span className="text-ink2"> — {cat.description}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium mb-1">
            ציון לשיבוץ = נקודות צדק בתקופה + (ניקוד_קודם − ממוצע) × {rules.hist}
          </p>
          <ul className="text-sm text-ink2 space-y-1 list-disc list-inside">
            {FAIRNESS_OVERVIEW.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="card space-y-4">
          <div>
            <h3 className="font-display text-lg mb-1">טבלת נקודות לשעה</h3>
            <ul className="text-sm text-ink2 space-y-1 list-disc list-inside mb-3">
              {GUARD_SCORING_EXPLANATION.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="schedule-table-wrap overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>סוג משימה</th>
                  <th>נק׳ לשעה</th>
                  <th>הסבר</th>
                </tr>
              </thead>
              <tbody>
                {rateRows.map((row) => (
                  <tr key={row.key}>
                    <td className="font-medium">{row.label}</td>
                    <td className="mono font-bold text-accent">{row.value}</td>
                    <td className="text-ink2 text-xs">{row.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-display text-lg">עבודות בסיס (ABAS)</h3>
          <ul className="text-sm text-ink2 space-y-1 list-disc list-inside">
            {BASE_WORK_SCORING_EXPLANATION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-sm">
            דוגמה: חלון 3 שעות ={" "}
            <span className="mono font-bold">
              {(rules.hourly_rates.base_work * 3).toFixed(2)}
            </span>{" "}
            נק׳ תורנות
          </p>
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
                  <th>עונש (נק׳ שמירה)</th>
                </tr>
              </thead>
              <tbody>
                {restTiers.map((tier) => (
                  <tr key={tier.restHoursLabel}>
                    <td>{tier.restHoursLabel}</td>
                    <td className="mono font-bold text-accent">+{tier.penalty}</td>
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
          <form onSubmit={submit} className="card space-y-6">
            <div>
              <h3 className="font-display text-base mb-3">הצעת שינוי — תעריפים לשעה</h3>
              <div className="space-y-3">
                {HOURLY_RATE_ROWS.map((row) => (
                  <div key={row.key} className="rowf items-end">
                    <div className="field flex-[2]">
                      <label>{row.label}</label>
                      <input
                        type="number"
                        step="0.05"
                        min={0}
                        value={proposed.hourly_rates[row.key]}
                        onChange={(e) =>
                          setHourlyRate(row.key, parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <p className="hint text-xs flex-1 pb-2">
                      נוכחי: {rules.hourly_rates[row.key]}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-display text-base mb-3">הצעת שינוי — עונש מנוחה</h3>
              <div className="schedule-table-wrap overflow-x-auto">
                <table className="schedule-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>פער מנוחה</th>
                      <th>עונש מוצע</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REST_PENALTY_TIERS.map((tier) => (
                      <tr key={tier.restHoursLabel}>
                        <td>{tier.restHoursLabel}</td>
                        <td>
                          <input
                            type="number"
                            step="0.5"
                            min={0}
                            className="w-20"
                            value={proposed.rest_penalties[tier.index]}
                            onChange={(e) =>
                              setProposed((p) => ({
                                ...p,
                                rest_penalties: p.rest_penalties.map((value, j) =>
                                  j === tier.index
                                    ? parseFloat(e.target.value) || 0
                                    : value,
                                ),
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

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

            <div className="field">
              <label htmlFor="fair-note">הסבר לשינוי</label>
              <textarea
                id="fair-note"
                rows={2}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="למשל: להעלות לילה ל-1.3"
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
