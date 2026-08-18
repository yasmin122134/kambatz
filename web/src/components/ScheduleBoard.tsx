"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ISSUE_STATUS_LABELS } from "@/lib/types";
import type { ScheduleView } from "@/lib/schedule";

type Props = {
  initial: ScheduleView;
  personName: string;
};

type Tab = "mine" | "all";

function AssigneeList({
  names,
  highlight,
}: {
  names: string[];
  highlight: string;
}) {
  if (!names.length) return <span className="text-ink3">—</span>;
  return (
    <span>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 && " · "}
          <span className={name === highlight ? "schedule-you" : undefined}>
            {name}
          </span>
        </span>
      ))}
    </span>
  );
}

export function ScheduleBoard({ initial, personName }: Props) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Tab>("mine");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const res = await fetch("/api/schedule");
    if (res.ok) {
      const data = await res.json();
      setView({
        boardReady: data.boardReady,
        boardStart: data.boardStart,
        updatedAt: data.updatedAt,
        myShifts: data.myShifts,
        allShifts: data.allShifts,
        patrols: data.patrols,
        myPatrols: data.myPatrols,
        blocks: data.blocks,
      });
    }
    setRefreshing(false);
  }, []);

  const mineCount =
    view.myShifts.length + view.myPatrols.length + view.blocks.length;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="card mb-6">
        <div className="bar spread flex-wrap gap-3">
          <div>
            <h2 className="font-display text-xl">שלום, {personName}</h2>
            <p className="lede">
              {view.boardReady
                ? `לוח פעיל · פתיחה ${view.boardStart}`
                : "עדיין אין לוח פעיל — כשהמפקד יבנה לוח, הוא יופיע כאן."}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="btn-sm"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? "מרענן…" : "רענון"}
            </button>
            <Link href="/report" className="btn-sm">
              דווח חסימה
            </Link>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          type="button"
          className={`btn-sm ${tab === "mine" ? "on" : ""}`}
          onClick={() => setTab("mine")}
        >
          המשמרות שלי
          {mineCount > 0 && (
            <span className="mr-1 opacity-80">({mineCount})</span>
          )}
        </button>
        <button
          type="button"
          className={`btn-sm ${tab === "all" ? "on" : ""}`}
          onClick={() => setTab("all")}
        >
          לוח מלא
        </button>
      </div>

      {tab === "mine" ? (
        <MineView view={view} personName={personName} />
      ) : (
        <FullBoardView view={view} personName={personName} />
      )}

      {view.updatedAt && (
        <p className="hint mt-4 text-center">
          עודכן לאחרונה:{" "}
          {new Date(view.updatedAt).toLocaleString("he-IL", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </p>
      )}
    </main>
  );
}

function MineView({
  view,
  personName,
}: {
  view: ScheduleView;
  personName: string;
}) {
  const hasAnything =
    view.myShifts.length > 0 ||
    view.myPatrols.length > 0 ||
    view.blocks.length > 0;

  if (!view.boardReady && !hasAnything) {
    return (
      <div className="card">
        <p className="hint">
          אין עדיין משמרות או חסימות. כשהמפקד יפרסם לוח — תראו כאן את השיבוצים
          שלכם.
        </p>
      </div>
    );
  }

  if (!hasAnything) {
    return (
      <div className="card">
        <p className="hint">
          אין לכם משמרות, פטרולים או חסימות בלוח הנוכחי (פתיחה{" "}
          {view.boardStart}).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {view.myShifts.length > 0 && (
        <section className="card">
          <h3 className="font-display text-base mb-3">משמרות ומשימות</h3>
          <ul className="space-y-2">
            {view.myShifts.map((row) => (
              <li
                key={row.id}
                className={`schedule-row ${row.isNow ? "schedule-now" : "schedule-mine"}`}
              >
                <span className="mono text-sm font-medium shrink-0">
                  {row.timeLabel}
                </span>
                <span className="font-semibold">{row.job}</span>
                <span className={`tag tag-${row.kind === "guard" ? "approved" : "pending"} text-xs`}>
                  {row.kindLabel}
                </span>
                {row.isNow && (
                  <span className="text-xs text-brick font-bold">עכשיו</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.myPatrols.length > 0 && (
        <section className="card">
          <h3 className="font-display text-base mb-3">פטרולים</h3>
          <ul className="space-y-2">
            {view.myPatrols.map((p) => (
              <li key={p.id} className="schedule-row schedule-mine">
                <span className="mono text-sm font-medium shrink-0">
                  {p.time || "—"}
                </span>
                <span className="font-semibold">{p.name || "פטרול"}</span>
                {p.note && (
                  <span className="text-sm text-ink2">{p.note}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.blocks.length > 0 && (
        <section className="card">
          <h3 className="font-display text-base mb-3">חסימות שעות</h3>
          <ul className="space-y-2">
            {view.blocks.map((b) => (
              <li key={b.id} className="schedule-row">
                <span className="mono text-sm font-medium shrink-0">
                  {b.time}
                </span>
                <span className="font-semibold">{b.label}</span>
                {b.note && (
                  <span className="text-sm text-ink2">{b.note}</span>
                )}
                <span className={`tag tag-${b.status} text-xs`}>
                  {ISSUE_STATUS_LABELS[b.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FullBoardView({
  view,
  personName,
}: {
  view: ScheduleView;
  personName: string;
}) {
  if (!view.boardReady || view.allShifts.length === 0) {
    return (
      <div className="card">
        <p className="hint">אין לוח לתצוגה עדיין.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card schedule-table-wrap p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="schedule-table w-full text-sm">
            <thead>
              <tr>
                <th>שעות</th>
                <th>משימה</th>
                <th>סוג</th>
                <th>משובצים</th>
              </tr>
            </thead>
            <tbody>
              {view.allShifts.map((row) => (
                <tr
                  key={row.id}
                  className={
                    row.isMine
                      ? row.isNow
                        ? "schedule-tr-now"
                        : "schedule-tr-mine"
                      : undefined
                  }
                >
                  <td className="mono whitespace-nowrap">{row.timeLabel}</td>
                  <td className="font-medium">{row.job}</td>
                  <td>
                    <span className="text-xs text-ink2">{row.kindLabel}</span>
                  </td>
                  <td>
                    <AssigneeList
                      names={row.assignees}
                      highlight={personName}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {view.patrols.length > 0 && (
        <div className="card schedule-table-wrap p-0 overflow-hidden">
          <h3 className="font-display text-base px-4 pt-4 pb-2">פטרולים</h3>
          <div className="overflow-x-auto">
            <table className="schedule-table w-full text-sm">
              <thead>
                <tr>
                  <th>שעה</th>
                  <th>פטרול</th>
                  <th>מבצעים</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {view.patrols.map((p) => (
                  <tr
                    key={p.id}
                    className={p.isMine ? "schedule-tr-mine" : undefined}
                  >
                    <td className="mono whitespace-nowrap">{p.time || "—"}</td>
                    <td className="font-medium">{p.name || "—"}</td>
                    <td>{p.who || "—"}</td>
                    <td className="text-ink2">{p.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="hint text-center">
        השורות המודגשות — המשמרות והמשימות שלך
      </p>
    </div>
  );
}
