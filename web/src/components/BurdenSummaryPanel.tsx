import { JUSTICE_POINTS_EXPLANATION } from "@/lib/justice-points";

export type BurdenRosterRow = {
  personName: string;
  totalBurden: number;
  dutyPoints: number;
  kitchenPoints: number;
  guardAssignmentCount: number;
  guardBaseBurden: number;
  restPenalties: number;
  guardPoints: number;
  toranutPoints: number;
  fairnessPoints: number;
  otherMissionPoints: number;
  historicalAdjustment: number;
  totalWithHistory: number;
};

type Props = {
  roster: BurdenRosterRow[];
  onRefresh: () => void;
  title?: string;
  emptyMessage?: string;
  assignedLabel?: string;
  highlightName?: string;
};

export function BurdenSummaryPanel({
  roster,
  onRefresh,
  title = "עומס שיבוץ — יום נבחר",
  emptyMessage = "אין נתוני שיבוץ.",
  assignedLabel = "משובצים ביום",
  highlightName,
}: Props) {
  const assignedCount = roster.filter((r) => r.totalBurden > 0).length;
  const maxTotal = roster.reduce((m, r) => Math.max(m, r.totalWithHistory), 0);
  const assignedBurden = roster
    .filter((r) => r.totalBurden > 0)
    .reduce((s, r) => s + r.totalBurden, 0);
  const avgAssignedBurden =
    assignedCount > 0 ? Math.round((assignedBurden / assignedCount) * 10) / 10 : 0;

  if (!roster.length) {
    return (
      <section className="card mb-6">
        <div className="bar spread mb-2">
          <h3 className="font-display text-base">{title}</h3>
          <button type="button" className="btn-sm" onClick={onRefresh}>
            רענון
          </button>
        </div>
        <p className="hint">{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section className="card mb-6">
      <div className="bar spread mb-3 flex-wrap gap-2">
        <h3 className="font-display text-base">{title}</h3>
        <button type="button" className="btn-sm" onClick={onRefresh}>
          רענון
        </button>
      </div>
      <p className="text-xs text-ink3 mb-2">{JUSTICE_POINTS_EXPLANATION}</p>
      <p className="text-xs text-ink3 mb-2">ממוין לפי סה״כ+היסטוריה (גבוה → נמוך).</p>
      <div className="burden-roster-summary">
        <span>
          <strong>{roster.length}</strong> צוערים פעילים
        </span>
        <span>
          <strong>{assignedCount}</strong> {assignedLabel}
        </span>
        <span>
          ממוצע עומס (משובצים): <strong>{avgAssignedBurden.toFixed(1)}</strong>
        </span>
        <span>
          מקס׳ סה״כ+היסט׳: <strong>{maxTotal.toFixed(1)}</strong>
        </span>
      </div>
      <div className="burden-roster-scroll" tabIndex={0} aria-label="רשימת עומס — ניתן לגלול">
        <table className="schedule-table w-full text-sm">
          <thead>
            <tr>
              <th>צוער</th>
              <th title="נקודות צדק — סה״כ">נק׳ צדק</th>
              <th title="עומס + התאמת ניקוד קודם — לשיבוץ חכם">סה״כ+היסט׳</th>
              <th aria-label="יחס לעומס המקסימלי" />
              <th>#</th>
              <th title="מימי שמירות + עב״ס">נק׳ שמירה</th>
              <th title="מימי מטבח">נק׳ תורנות</th>
              <th title="התאמת ניקוד קודם">היסט׳</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row) => {
              const barPct =
                maxTotal > 0
                  ? Math.round((row.totalWithHistory / maxTotal) * 100)
                  : 0;
              const idle = row.totalBurden <= 0;
              const mine = highlightName === row.personName;
              return (
                <tr
                  key={row.personName}
                  className={
                    mine
                      ? "burden-roster-row--you"
                      : idle
                        ? "burden-roster-row--idle"
                        : undefined
                  }
                >
                  <td>{row.personName}</td>
                  <td className="mono font-medium">{row.fairnessPoints.toFixed(1)}</td>
                  <td className="mono font-medium">{row.totalWithHistory.toFixed(1)}</td>
                  <td>
                    <div className="burden-roster-bar" title={`${barPct}% מהמקסימום`}>
                      <div className="burden-roster-bar-track">
                        <div
                          className="burden-roster-bar-fill"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="mono">{row.guardAssignmentCount}</td>
                  <td className="mono text-ink2">{row.guardPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">{row.toranutPoints.toFixed(1)}</td>
                  <td className="mono text-ink2">
                    {row.historicalAdjustment >= 0 ? "+" : ""}
                    {row.historicalAdjustment.toFixed(1)}
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
