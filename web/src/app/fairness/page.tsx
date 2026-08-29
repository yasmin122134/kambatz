"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  BurdenSummaryPanel,
  type BurdenRosterRow,
} from "@/components/BurdenSummaryPanel";
import { FairnessRulesPanel } from "@/components/FairnessRulesPanel";
import {
  EDITABLE_FAIRNESS_FIELDS,
  FAIRNESS_INTRO,
  mergeProposedFairnessRules,
  pairGuardDayRate,
  pairGuardNightRate,
} from "@/lib/fairness-display";
import { REST_PENALTY_TIERS } from "@/lib/guard-burden";
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

function currentFieldValue(
  rules: FairnessRules,
  field: (typeof EDITABLE_FAIRNESS_FIELDS)[number],
): number {
  if (field.kind === "hourly") return rules.hourly_rates[field.key];
  if (field.kind === "pair") return rules.pair;
  return rules.hist;
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
  const [authenticated, setAuthenticated] = useState(false);
  const [burdenRoster, setBurdenRoster] = useState<BurdenRosterRow[]>([]);
  const [burdenLoading, setBurdenLoading] = useState(false);

  const loadBurden = useCallback(async () => {
    setBurdenLoading(true);
    try {
      const res = await fetch("/api/missions/burden");
      if (res.ok) {
        const data = await res.json();
        setBurdenRoster(data.roster || []);
      }
    } finally {
      setBurdenLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/fairness").then((r) => r.json()),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/me/role").then((r) => r.json()),
    ])
      .then(([fair, me, role]) => {
        const r = cloneRules(fair.rules || DEFAULT_FAIRNESS_RULES);
        setRules(r);
        setProposed(cloneRules(r));
        setLoggedIn(!!me?.name);
        setAuthenticated(!!role?.authenticated);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authenticated) loadBurden();
  }, [authenticated, loadBurden]);

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

  function setProposedField(
    field: (typeof EDITABLE_FAIRNESS_FIELDS)[number],
    value: number,
  ) {
    setProposed((p) => {
      if (field.kind === "hourly") {
        return { ...p, hourly_rates: { ...p.hourly_rates, [field.key]: value } };
      }
      if (field.kind === "pair") {
        return { ...p, pair: value };
      }
      return { ...p, hist: value };
    });
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

  return (
    <AppShell title="טבלת צדק">
      <main className="mx-auto max-w-3xl px-5 py-8 space-y-6">
        <div className="card space-y-2">
          <h2 className="font-display text-xl">איך מחושב עומס?</h2>
          <p className="text-sm text-ink2">{FAIRNESS_INTRO.lead}</p>
          <p className="text-sm text-ink2">{FAIRNESS_INTRO.categories}</p>
          <p className="text-sm font-medium">{FAIRNESS_INTRO.formula(rules.hist)}</p>
        </div>

        {authenticated ? (
          burdenLoading && !burdenRoster.length ? (
            <div className="card">
              <p className="hint">טוען טבלת עומס…</p>
            </div>
          ) : (
            <>
              <BurdenSummaryPanel
                roster={burdenRoster}
                onRefresh={loadBurden}
                title="עומס שיבוץ — כל הימים שפורסמו"
                emptyMessage="אין נתוני שיבוץ בימים שפורסמו."
                assignedLabel="משובצים בתקופה"
              />
              <p className="text-xs text-ink3 -mt-4 mb-6">
                לעומס לפי יום בודד —{" "}
                <Link href="/board" className="text-brick hover:underline">
                  רשימה מלאה → עומס שיבוץ
                </Link>
              </p>
            </>
          )
        ) : (
          <div className="card">
            <h3 className="font-display text-lg mb-2">עומס שיבוץ לפי צוער</h3>
            <p className="lede mb-3">
              טבלת העומסים זמינה לכל צוער מחובר.
            </p>
            <Link href="/login?next=/fairness" className="btn-pri btn-sm">
              התחברות לצפייה
            </Link>
          </div>
        )}

        <FairnessRulesPanel rules={rules} showIntro={false} />

        {loggedIn ? (
          <form onSubmit={submit} className="card space-y-5">
            <div>
              <h3 className="font-display text-base mb-3">הצעת שינוי — תעריפים</h3>
              <div className="schedule-table-wrap overflow-x-auto">
                <table className="schedule-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>פרמטר</th>
                      <th className="w-28">מוצע</th>
                      <th className="w-28">נוכחי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EDITABLE_FAIRNESS_FIELDS.map((field) => (
                      <tr key={field.label}>
                        <td>{field.label}</td>
                        <td>
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            className="w-full"
                            value={currentFieldValue(proposed, field)}
                            onChange={(e) =>
                              setProposedField(field, parseFloat(e.target.value) || 0)
                            }
                          />
                        </td>
                        <td className="mono text-ink2">
                          {currentFieldValue(rules, field)}
                          {field.kind === "pair" ? (
                            <span className="block text-[10px] text-ink3">
                              יום: {pairGuardDayRate(proposed).toFixed(2)} · לילה:{" "}
                              {pairGuardNightRate(proposed).toFixed(2)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-display text-base mb-3">הצעת שינוי — עונש מנוחה</h3>
              <div className="schedule-table-wrap overflow-x-auto">
                <table className="schedule-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>פער מנוחה</th>
                      <th className="w-28">מוצע</th>
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
                            className="w-full"
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
