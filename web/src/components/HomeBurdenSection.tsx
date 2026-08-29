"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BurdenSummaryPanel,
  type BurdenRosterRow,
} from "@/components/BurdenSummaryPanel";

type Props = {
  personName?: string;
  title?: string;
};

export function HomeBurdenSection({
  personName,
  title = "תפלגות עומס — נקודות צדק",
}: Props) {
  const [roster, setRoster] = useState<BurdenRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNeedsLogin(false);
    try {
      const res = await fetch("/api/missions/burden");
      if (res.status === 401) {
        setNeedsLogin(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "שגיאה בטעינת העומס");
        return;
      }
      const data = await res.json();
      setRoster(data.roster || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (needsLogin) {
    return (
      <section className="card">
        <h3 className="font-display text-lg mb-2">{title}</h3>
        <p className="lede mb-3">
          התחברו כדי לראות את תפלגות העומס לפי טבלת הצדק — לכל צוער בפלוגה.
        </p>
        <Link href="/login?next=/" className="btn-pri btn-sm">
          התחברות
        </Link>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="card">
        <p className="hint">טוען תפלגות עומס…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <p className="msg-err">{error}</p>
        <button type="button" className="btn-sm mt-2" onClick={load}>
          נסו שוב
        </button>
      </section>
    );
  }

  return (
    <BurdenSummaryPanel
      roster={roster}
      onRefresh={load}
      title={title}
      emptyMessage="אין נתוני שיבוץ בימים שפורסמו."
      assignedLabel="משובצים בתקופה"
      highlightName={personName}
    />
  );
}
