"use client";

import { useMemo } from "react";
import { buildBurdenHistogram } from "@/lib/burden-distribution";

type Props = {
  roster: { personName: string; fairnessPoints: number }[];
  highlightName?: string;
  /** Hide outer title/caption — for side-by-side compare layouts */
  compact?: boolean;
  missionDayCount?: number;
};

const PLOT_HEIGHT = 120;
const COUNT_HEIGHT = 16;

export function BurdenDistributionChart({
  roster,
  highlightName,
  compact = false,
  missionDayCount,
}: Props) {
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

  const maxBarHeight = PLOT_HEIGHT - COUNT_HEIGHT;

  return (
    <div className={compact ? "burden-distribution burden-distribution--compact" : "burden-distribution"}>
      <div className="burden-distribution-header">
        {!compact ? (
          <h4 className="font-display text-base">גרף התפלגות — נקודות צדק</h4>
        ) : null}
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
          {missionDayCount != null ? (
            <span>
              ימי משימה: <strong className="mono">{missionDayCount}</strong>
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="burden-distribution-chart"
        role="img"
        aria-label={`התפלגות עומס: ממוצע ${summary.mean}, חציון ${summary.median}`}
      >
        <div className="burden-distribution-scroll">
          <div
            className="burden-distribution-bars"
            style={{ minWidth: Math.max(520, summary.bins.length * 52) }}
          >
            {summary.bins.map((bin) => {
              const heightPx =
                bin.count > 0 && summary.maxCount > 0
                  ? Math.max(
                      6,
                      Math.round((bin.count / summary.maxCount) * maxBarHeight),
                    )
                  : 0;
              const title = bin.names.length
                ? `${bin.label}: ${bin.count} (${bin.names.join(", ")})`
                : `${bin.label}: ${bin.count}`;
              return (
                <div key={`${bin.min}-${bin.max}`} className="burden-distribution-bar-col">
                  <div
                    className="burden-distribution-bar-plot"
                    style={{ height: PLOT_HEIGHT }}
                  >
                    {bin.count > 0 ? (
                      <span className="burden-distribution-count mono">{bin.count}</span>
                    ) : (
                      <span className="burden-distribution-count mono" aria-hidden />
                    )}
                    <div
                      className={`burden-distribution-bar-fill${
                        bin.includesHighlight ? " burden-distribution-bar-fill--you" : ""
                      }`}
                      style={{ height: heightPx > 0 ? `${heightPx}px` : "0" }}
                      title={title}
                    />
                  </div>
                  <span className="burden-distribution-label mono">{bin.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        {!compact ? (
          <p className="burden-distribution-caption text-xs text-ink3">
            משמאל: פחות נקודות · מימין: יותר נקודות.
            {highlightName ? " העמודה המודגשת = את/ה." : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
