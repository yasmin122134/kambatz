"use client";

import { useMemo } from "react";
import { buildBurdenHistogram } from "@/lib/burden-distribution";

type Props = {
  roster: { personName: string; fairnessPoints: number }[];
  highlightName?: string;
};

const CHART_HEIGHT = 160;

export function BurdenDistributionChart({ roster, highlightName }: Props) {
  const summary = useMemo(
    () =>
      buildBurdenHistogram(
        roster.map((r) => ({
          personName: r.personName,
          fairnessPoints: r.fairnessPoints,
        })),
        { highlightName },
      ),
    [roster, highlightName],
  );

  if (!summary.bins.length) {
    return null;
  }

  return (
    <div className="burden-distribution">
      <div className="burden-distribution-header">
        <h4 className="font-display text-base">גרף התפלגות — נקודות צדק</h4>
        <div className="burden-distribution-stats">
          <span>
            ממוצע: <strong className="mono">{summary.mean.toFixed(1)}</strong>
          </span>
          <span>
            חציון: <strong className="mono">{summary.median.toFixed(1)}</strong>
          </span>
          <span>
            משובצים: <strong>{summary.assignedCount}</strong>
          </span>
        </div>
      </div>

      <div
        className="burden-distribution-chart"
        role="img"
        aria-label={`התפלגות עומס: ממוצע ${summary.mean}, חציון ${summary.median}`}
      >
        <div className="burden-distribution-bars" style={{ height: CHART_HEIGHT }}>
          {summary.bins.map((bin) => {
            const heightPct =
              summary.maxCount > 0
                ? Math.round((bin.count / summary.maxCount) * 100)
                : 0;
            const title = bin.names.length
              ? `${bin.label}: ${bin.count} (${bin.names.join(", ")})`
              : `${bin.label}: ${bin.count}`;
            return (
              <div key={bin.label} className="burden-distribution-bar-col">
                <div className="burden-distribution-bar-stack">
                  <span className="burden-distribution-count mono">{bin.count || ""}</span>
                  <div
                    className={`burden-distribution-bar-fill${
                      bin.includesHighlight ? " burden-distribution-bar-fill--you" : ""
                    }`}
                    style={{
                      height: bin.count > 0 ? `max(${heightPct}%, 4px)` : "0",
                    }}
                    title={title}
                  />
                </div>
                <span className="burden-distribution-label mono">{bin.label}</span>
              </div>
            );
          })}
        </div>
        <p className="burden-distribution-caption text-xs text-ink3">
          כמה צוערים בכל טווח נקודות צדק.
          {highlightName ? " העמודה המודגשת = את/ה." : ""}
        </p>
      </div>
    </div>
  );
}
