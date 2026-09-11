"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BurdenDistributionChart } from "@/components/BurdenDistributionChart";
import { missionDayScopeLabel } from "@/lib/mission-scope";
import type { MissionEditorFairnessResult } from "@/lib/mission-editor-fairness";

type SortKey = "name" | "history" | "current" | "balanced";

type Props = {
  missionId: string;
  /** Refetch after auto-assign / save */
  refreshKey?: number;
  title?: string;
};

function sortRows(
  rows: MissionEditorFairnessResult["rows"],
  key: SortKey,
  asc: boolean,
) {
  const dir = asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") {
      return dir * a.personName.localeCompare(b.personName, "he");
    }
    const av =
      key === "history"
        ? a.historyGuardPoints
        : key === "current"
          ? a.currentPoints
          : a.balancedTotal;
    const bv =
      key === "history"
        ? b.historyGuardPoints
        : key === "current"
          ? b.currentPoints
          : b.balancedTotal;
    if (av !== bv) return dir * (av - bv);
    return a.personName.localeCompare(b.personName, "he");
  });
}

function SortButton({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`text-inherit font-inherit bg-transparent border-0 p-0 cursor-pointer hover:text-accent ${
        active ? "text-accent font-semibold" : ""
      }`}
      onClick={onClick}
    >
      {label}
      {active ? (asc ? " ↑" : " ↓") : ""}
    </button>
  );
}

export function MissionFairnessPanel({
  missionId,
  refreshKey = 0,
  title = "ניקוד צדק לשיבוץ",
}: Props) {
  const [data, setData] = useState<MissionEditorFairnessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("balanced");
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/missions/${missionId}/fairness-roster`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "שגיאה בטעינת ניקוד");
        setData(null);
        return;
      }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const sorted = useMemo(
    () => (data ? sortRows(data.rows, sortKey, sortAsc) : []),
    [data, sortKey, sortAsc],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  }

  const historyChartRoster = sorted.map((r) => ({
    personName: r.personName,
    fairnessPoints: r.historyGuardPoints,
  }));
  const currentChartRoster = sorted.map((r) => ({
    personName: r.personName,
    fairnessPoints: r.currentPoints,
  }));
  const balancedChartRoster = sorted.map((r) => ({
    personName: r.personName,
    fairnessPoints: r.balancedTotal,
  }));

  const maxBalanced = sorted.reduce(
    (m, r) => Math.max(m, r.balancedTotal),
    0,
  );

  if (loading && !data) {
    return (
      <section className="card space-y-2">
        <h4 className="font-display text-base">{title}</h4>
        <p className="hint text-sm">טוען…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card space-y-2">
        <h4 className="font-display text-base">{title}</h4>
        <p className="msg-err text-sm">{error}</p>
        <button type="button" className="btn-sm" onClick={load}>
          נסו שוב
        </button>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="card space-y-4">
      <div className="bar spread flex-wrap gap-2">
        <h4 className="font-display text-base">{title}</h4>
        <button type="button" className="btn-sm" onClick={load} disabled={loading}>
          {loading ? "מרענן…" : "רענון"}
        </button>
      </div>

      <p className="text-xs text-ink3 leading-relaxed">
        <strong>היסטוריה</strong> — נקודות שמירה מימים מפורסמים אחרים (
        {missionDayScopeLabel(data.historyMissionDayCount)}).{" "}
        <strong>היום</strong> — נקודות צדק רק ב־{data.missionDate} (
        {missionDayScopeLabel(data.currentMissionDayCount)}).{" "}
        <strong>מצטבר</strong> — היום + היסטוריה + התאמת ניקוד קודם (ממוצע{" "}
        {data.meanPrior}).
      </p>

      <div className="burden-compare-charts burden-compare-charts--triple">
        <div className="burden-compare-chart-block">
          <h5 className="burden-compare-chart-title">היסטוריה</h5>
          <BurdenDistributionChart roster={historyChartRoster} compact />
        </div>
        <div className="burden-compare-chart-block">
          <h5 className="burden-compare-chart-title">היום</h5>
          <BurdenDistributionChart roster={currentChartRoster} compact />
        </div>
        <div className="burden-compare-chart-block">
          <h5 className="burden-compare-chart-title">מצטבר</h5>
          <BurdenDistributionChart roster={balancedChartRoster} compact />
        </div>
      </div>

      <div className="burden-roster-scroll" tabIndex={0}>
        <table className="schedule-table w-full text-sm">
          <thead>
            <tr>
              <th>
                <SortButton
                  label="צוער"
                  active={sortKey === "name"}
                  asc={sortAsc}
                  onClick={() => toggleSort("name")}
                />
              </th>
              <th>
                <SortButton
                  label="היסטוריה"
                  active={sortKey === "history"}
                  asc={sortAsc}
                  onClick={() => toggleSort("history")}
                />
              </th>
              <th>
                <SortButton
                  label="היום"
                  active={sortKey === "current"}
                  asc={sortAsc}
                  onClick={() => toggleSort("current")}
                />
              </th>
              <th>
                <SortButton
                  label="מצטבר"
                  active={sortKey === "balanced"}
                  asc={sortAsc}
                  onClick={() => toggleSort("balanced")}
                />
              </th>
              <th className="text-ink3">התאמת ניקוד</th>
              <th aria-label="יחס למקסימום" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const barPct =
                maxBalanced > 0
                  ? Math.round((row.balancedTotal / maxBalanced) * 100)
                  : 0;
              return (
                <tr key={row.personName}>
                  <td>{row.personName}</td>
                  <td className="mono">{row.historyGuardPoints.toFixed(1)}</td>
                  <td className="mono">
                    {row.currentPoints.toFixed(1)}
                    {row.currentGuardPoints > 0 &&
                    row.currentGuardPoints !== row.currentPoints ? (
                      <span className="block text-[10px] text-ink3">
                        שמירה {row.currentGuardPoints.toFixed(1)}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono font-medium">
                    {row.balancedTotal.toFixed(1)}
                  </td>
                  <td className="mono text-ink3 text-xs">
                    {row.historicalAdjustment >= 0 ? "+" : ""}
                    {row.historicalAdjustment.toFixed(1)}
                  </td>
                  <td>
                    <div className="burden-roster-bar">
                      <div className="burden-roster-bar-track">
                        <div
                          className="burden-roster-bar-fill"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
