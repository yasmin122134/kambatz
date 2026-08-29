"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { JUSTICE_POINTS_EXPLANATION } from "@/lib/justice-points";
import type { PlatoonFairnessRow } from "@/app/api/platoon/fairness/route";

function squadLabel(squad: number | null): string {
  if (squad == null) return "ללא מחלקה";
  return `מחלקה ${squad}`;
}

export default function PlatoonPage() {
  const router = useRouter();
  const [roster, setRoster] = useState<PlatoonFairnessRow[]>([]);
  const [myName, setMyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [meRes, rosterRes] = await Promise.all([
      fetch("/api/me"),
      fetch("/api/platoon/fairness"),
    ]);
    if (meRes.status === 401 || rosterRes.status === 401) {
      router.replace("/login?next=/pluga");
      return;
    }
    if (!rosterRes.ok) {
      const data = await rosterRes.json().catch(() => ({}));
      setError(data.error || "שגיאה בטעינה");
      setLoading(false);
      return;
    }
    if (meRes.ok) {
      const me = await meRes.json();
      setMyName(me.name || "");
    }
    const data = await rosterRes.json();
    setRoster(data.roster || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const bySquad = useMemo(() => {
    const groups = new Map<string, PlatoonFairnessRow[]>();
    for (const row of roster) {
      const key = squadLabel(row.squad);
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "he"));
  }, [roster]);

  return (
    <AppShell title="פלוגה">
      <main className="mx-auto max-w-3xl px-5 py-8 space-y-5">
        <div className="card space-y-2">
          <h2 className="font-display text-xl">נקודות צדק — הפלוגה</h2>
          <p className="text-sm text-ink2">{JUSTICE_POINTS_EXPLANATION}</p>
          <p className="hint text-xs">
            מחושב מכל הימים שפורסמו. לפרטים אישיים —{" "}
            <Link href="/profile" className="text-brick hover:underline">
              הפרופיל שלי
            </Link>
            .
          </p>
        </div>

        {loading ? (
          <div className="card">
            <p className="hint">טוען…</p>
          </div>
        ) : error ? (
          <div className="card">
            <p className="msg-err">{error}</p>
          </div>
        ) : roster.length === 0 ? (
          <div className="card">
            <p className="hint">אין צוערים פעילים.</p>
          </div>
        ) : (
          bySquad.map(([squadName, members]) => (
            <section key={squadName} className="card space-y-3">
              <h3 className="font-display text-base">{squadName}</h3>
              <ul className="platoon-fairness-list">
                {members.map((row) => {
                  const mine = row.personName === myName;
                  return (
                    <li
                      key={row.personName}
                      className={`platoon-fairness-row ${mine ? "is-you" : ""}`}
                    >
                      <div className="platoon-fairness-name">
                        {row.personName}
                        {mine && (
                          <span className="text-[10px] text-accent mr-1">(את/ה)</span>
                        )}
                      </div>
                      <div className="platoon-fairness-points">
                        <span className="platoon-fairness-main">
                          {row.justicePoints.toFixed(1)}
                        </span>
                        <span className="hint text-[10px]">נק׳ צדק</span>
                      </div>
                      <div className="platoon-fairness-breakdown text-xs text-ink2">
                        <span title="שמירות + עב״ס + כוננות">
                          שמירה {row.guardPoints.toFixed(1)}
                        </span>
                        <span aria-hidden> · </span>
                        <span title="מטבch וחמגשיות">
                          תורנות {row.toranutPoints.toFixed(1)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        <div className="text-center">
          <Link href="/fairness" className="text-sm text-brick hover:underline">
            טבלת צדק מלאה →
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
