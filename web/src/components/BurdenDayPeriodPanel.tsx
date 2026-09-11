import { BurdenDistributionChart } from "@/components/BurdenDistributionChart";
import { JUSTICE_POINTS_EXPLANATION } from "@/lib/justice-points";
import { missionDayScopeLabel, missionDayScopeShort } from "@/lib/mission-scope";
import type { BurdenRosterRow } from "@/components/BurdenSummaryPanel";

type Props = {
  dayRoster: BurdenRosterRow[];
  periodRoster: BurdenRosterRow[];
  missionDateLabel: string;
  onRefresh: () => void;
  highlightName?: string;
  dayMissionDayCount?: number;
  periodMissionDayCount?: number;
};

function emptyRow(name: string): BurdenRosterRow {
  return {
    personName: name,
    totalBurden: 0,
    dutyPoints: 0,
    kitchenPoints: 0,
    guardAssignmentCount: 0,
    guardBaseBurden: 0,
    restPenalties: 0,
    guardPoints: 0,
    toranutPoints: 0,
    fairnessPoints: 0,
    otherMissionPoints: 0,
    historicalAdjustment: 0,
    totalWithHistory: 0,
  };
}

export function BurdenDayPeriodPanel({
  dayRoster,
  periodRoster,
  missionDateLabel,
  onRefresh,
  highlightName,
  dayMissionDayCount,
  periodMissionDayCount,
}: Props) {
  const periodByName = new Map(periodRoster.map((r) => [r.personName, r]));
  const rows = dayRoster.map((day) => ({
    day,
    period: periodByName.get(day.personName) ?? emptyRow(day.personName),
  }));

  const dayAssigned = dayRoster.filter((r) => r.totalBurden > 0).length;
  const periodAssigned = periodRoster.filter((r) => r.totalBurden > 0).length;
  const maxPeriodTotal = periodRoster.reduce(
    (m, r) => Math.max(m, r.totalWithHistory),
    0,
  );

  if (!dayRoster.length) {
    return (
      <section className="card mb-6">
        <div className="bar spread mb-2">
          <h3 className="font-display text-base">עומס שיבוץ</h3>
          <button type="button" className="btn-sm" onClick={onRefresh}>
            רענון
          </button>
        </div>
        <p className="hint">אין נתוני שיבוץ.</p>
      </section>
    );
  }

  const sorted = [...rows].sort(
    (a, b) => b.period.totalWithHistory - a.period.totalWithHistory,
  );

  return (
    <section className="card mb-6">
      <div className="bar spread mb-3 flex-wrap gap-2">
        <h3 className="font-display text-base">עומס שיבוץ — יום + מצטבר</h3>
        <button type="button" className="btn-sm" onClick={onRefresh}>
          רענון
        </button>
      </div>
      <p className="text-xs text-ink3 mb-2">{JUSTICE_POINTS_EXPLANATION}</p>
      <p className="text-xs text-ink3 mb-2">
        <strong>היום ({missionDateLabel})</strong> — מה ששובץ ביום המשימה הנבחר.
        {" "}
        <strong>מצטבר</strong> — נקודות צדק מכל הימים שפורסמו (בסיס לאיזון בשיבוץ
        חכם).
      </p>
      <div className="burden-scope-dual mb-3">
        {dayMissionDayCount != null ? (
          <p className="text-xs text-ink3">
            <strong>היום:</strong> {missionDayScopeLabel(dayMissionDayCount)}
          </p>
        ) : null}
        {periodMissionDayCount != null ? (
          <p className="text-xs text-ink3">
            <strong>מצטבר:</strong> {missionDayScopeLabel(periodMissionDayCount)}
          </p>
        ) : null}
      </div>

      <div className="burden-compare-charts">
        <div className="burden-compare-chart-block">
          <h4 className="burden-compare-chart-title">
            היום
            {dayMissionDayCount != null ? (
              <span className="burden-compare-chart-scope mono">
                ({missionDayScopeShort(dayMissionDayCount)})
              </span>
            ) : null}
          </h4>
          <BurdenDistributionChart
            roster={dayRoster}
            highlightName={highlightName}
            compact
            missionDayCount={dayMissionDayCount}
          />
        </div>
        <div className="burden-compare-chart-block">
          <h4 className="burden-compare-chart-title">
            מצטבר — כל הימים
            {periodMissionDayCount != null ? (
              <span className="burden-compare-chart-scope mono">
                ({missionDayScopeShort(periodMissionDayCount)})
              </span>
            ) : null}
          </h4>
          <BurdenDistributionChart
            roster={periodRoster}
            highlightName={highlightName}
            compact
            missionDayCount={periodMissionDayCount}
          />
        </div>
      </div>

      <div className="burden-roster-summary mb-2">
        <span>
          משובצים היום: <strong>{dayAssigned}</strong>
        </span>
        <span>
          משובצים מצטבר: <strong>{periodAssigned}</strong>
        </span>
        {dayMissionDayCount != null ? (
          <span>
            ימי משימה (היום): <strong className="mono">{dayMissionDayCount}</strong>
          </span>
        ) : null}
        {periodMissionDayCount != null ? (
          <span>
            ימי משימה (מצטבר): <strong className="mono">{periodMissionDayCount}</strong>
          </span>
        ) : null}
      </div>

      <div className="burden-roster-scroll" tabIndex={0} aria-label="השוואת עומס יום מול מצטבר">
        <table className="schedule-table w-full text-sm">
          <thead>
            <tr>
              <th rowSpan={2}>צוער</th>
              <th colSpan={3} className="text-center bg-paper2/50">
                היום
              </th>
              <th colSpan={3} className="text-center bg-accent-bg/40">
                מצטבר
              </th>
              <th rowSpan={2} aria-label="יחס למקסימום מצטבר" />
            </tr>
            <tr>
              <th className="bg-paper2/50">נק׳ צדק</th>
              <th className="bg-paper2/50">שמירה</th>
              <th className="bg-paper2/50">תורנות</th>
              <th className="bg-accent-bg/40">נק׳ צדק</th>
              <th className="bg-accent-bg/40">שמירה</th>
              <th className="bg-accent-bg/40">תורנות</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ day, period }) => {
              const barPct =
                maxPeriodTotal > 0
                  ? Math.round((period.totalWithHistory / maxPeriodTotal) * 100)
                  : 0;
              const idleDay = day.totalBurden <= 0;
              const mine = highlightName === day.personName;
              return (
                <tr
                  key={day.personName}
                  className={
                    mine
                      ? "burden-roster-row--you"
                      : idleDay && period.totalBurden <= 0
                        ? "burden-roster-row--idle"
                        : undefined
                  }
                >
                  <td>{day.personName}</td>
                  <td className="mono font-medium">{day.fairnessPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">{day.guardPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">{day.toranutPoints.toFixed(1)}</td>
                  <td className="mono font-medium">{period.fairnessPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">{period.guardPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">{period.toranutPoints.toFixed(1)}</td>
                  <td>
                    <div className="burden-roster-bar" title={`${barPct}% מהמקסימום המצטבר`}>
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
