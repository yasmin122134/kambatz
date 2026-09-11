"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MissionDayScopeNote } from "@/components/MissionDayScopeNote";
import {
  assignmentBucketLabel,
  explainAssignmentPoints,
} from "@/lib/fairness-display";
import {
  MISSION_TYPE_LABELS,
  type FairnessBucket,
  type Person,
  type PersonFairnessStats,
} from "@/lib/types";
import type { AvailableAssignmentSlot, PersonAssignmentRow } from "@/lib/person-assignments";
import {
  JUSTICE_POINTS_EXPLANATION,
  formatJusticePoints,
  justicePoints,
} from "@/lib/justice-points";

type AssignmentRow = PersonAssignmentRow & {
  points?: number;
  pointsManual?: boolean;
  bucket?: string;
  hours?: number;
  burdenBase?: number;
  burdenRest?: number;
  burdenIsSolo?: boolean;
};

type PersonDetailResponse = {
  person: Person;
  fairness: PersonFairnessStats & { missionDayCount?: number };
  assignments: AssignmentRow[];
  availableSlots: AvailableAssignmentSlot[];
  canEdit: boolean;
  isSelf: boolean;
};

function slotKey(slot: { missionId: string; slotId: string; seatIndex: number }) {
  return `${slot.missionId}:${slot.slotId}:${slot.seatIndex}`;
}

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const personId = params.id;

  const [data, setData] = useState<PersonDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [priorScore, setPriorScore] = useState("");
  const [savingPrior, setSavingPrior] = useState(false);
  const [addSlotKey, setAddSlotKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pointEdits, setPointEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/people/${personId}`);
    if (res.status === 401) {
      router.replace(`/login?next=/people/${personId}`);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "שגיאה בטעינה");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as PersonDetailResponse;
    setData(json);
    setPriorScore(String(json.person.prior_score ?? 0));
    setPointEdits(
      Object.fromEntries(
        json.assignments.map((row) => [
          slotKey(row),
          row.points != null ? String(row.points) : "",
        ]),
      ),
    );
    setLoading(false);
  }, [personId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const guards = useMemo(
    () => data?.assignments.filter((a) => a.missionType === "guards") ?? [],
    [data],
  );
  const toranut = useMemo(
    () =>
      data?.assignments.filter(
        (a) => a.missionType === "kitchen" || a.missionType === "base_work",
      ) ?? [],
    [data],
  );

  async function savePriorScore(e: FormEvent) {
    e.preventDefault();
    if (!data?.canEdit) return;
    setSavingPrior(true);
    setMessage("");
    setError("");
    const res = await fetch(`/api/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: personId, prior_score: Number(priorScore) }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPrior(false);
    if (!res.ok) {
      setError(body.error || "שגיאה בשמירה");
      return;
    }
    setMessage("ניקוד קודם עודכן");
    await load();
  }

  async function removeAssignment(row: AssignmentRow) {
    if (!data?.canEdit) return;
    if (
      !confirm(
        `להסיר את ${data.person.name} מ־${row.positionName} (${row.timeLabel})?\nהמשבצת תישאר ריקה.`,
      )
    ) {
      return;
    }
    const key = slotKey(row);
    setBusyKey(key);
    setError("");
    setMessage("");
    const res = await fetch(`/api/people/${personId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        mission_id: row.missionId,
        slot_id: row.slotId,
        seat_index: row.seatIndex,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyKey(null);
    if (!res.ok) {
      setError(body.error || "שגיאה בהסרה");
      return;
    }
    setMessage("השיבוץ הוסר");
    await load();
  }

  async function addAssignment(e: FormEvent) {
    e.preventDefault();
    if (!data?.canEdit || !addSlotKey) return;
    const slot = data.availableSlots.find(
      (s) => `${s.missionId}:${s.slotId}:${s.seatIndex}` === addSlotKey,
    );
    if (!slot) return;

    setAdding(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/people/${personId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        mission_id: slot.missionId,
        slot_id: slot.slotId,
        seat_index: slot.seatIndex,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) {
      setError(body.error || "שגיאה בהוספה");
      return;
    }
    if (body.warnings?.length) {
      setMessage(`שובץ — אזהרות: ${body.warnings.join(" · ")}`);
    } else {
      setMessage("שיבוץ נוסף");
    }
    setAddSlotKey("");
    await load();
  }

  async function savePoints(row: AssignmentRow) {
    if (!data?.canEdit) return;
    const key = slotKey(row);
    const points = Number(pointEdits[key]);
    if (Number.isNaN(points)) {
      setError("נקודות לא תקינות");
      return;
    }
    setBusyKey(`pts:${key}`);
    setError("");
    const res = await fetch(`/api/people/${personId}/fairness-points`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mission_id: row.missionId,
        slot_id: row.slotId,
        points,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyKey(null);
    if (!res.ok) {
      setError(body.error || "שגיאה בעדכון נקודות");
      return;
    }
    setMessage("נקודות עודכנו");
    await load();
  }

  async function resetPoints(row: AssignmentRow) {
    if (!data?.canEdit || !row.pointsManual) return;
    setBusyKey(`rst:${slotKey(row)}`);
    const res = await fetch(`/api/people/${personId}/fairness-points`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mission_id: row.missionId,
        slot_id: row.slotId,
        reset: true,
      }),
    });
    setBusyKey(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "שגיאה");
      return;
    }
    setMessage("נקודות חזרו לחישוב אוטומטי");
    await load();
  }

  function renderAssignmentTable(rows: AssignmentRow[], emptyLabel: string) {
    if (!rows.length) {
      return <p className="hint text-sm">{emptyLabel}</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-right text-xs text-ink3 border-b border-line2">
              <th className="py-2 pl-2">תאריך</th>
              <th className="py-2 pl-2">שעות</th>
              <th className="py-2 pl-2">תפקיד</th>
              <th className="py-2 pl-2">סוג</th>
              <th className="py-2 pl-2">נק׳ ופירוט</th>
              {data?.canEdit && <th className="py-2">פעולות</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = slotKey(row);
              const busy = busyKey === key || busyKey === `pts:${key}` || busyKey === `rst:${key}`;
              return (
                <tr key={key} className="border-b border-line2/60 align-top">
                  <td className="py-2 pl-2 mono text-xs whitespace-nowrap">
                    {row.missionDate.slice(0, 10)}
                  </td>
                  <td className="py-2 pl-2 mono text-xs whitespace-nowrap">{row.timeLabel}</td>
                  <td className="py-2 pl-2">
                    <div>{row.positionName}</div>
                    <Link
                      href={`/board?date=${row.missionDate.slice(0, 10)}`}
                      className="text-[10px] text-brick hover:underline"
                    >
                      לוח היום
                    </Link>
                  </td>
                  <td className="py-2 pl-2 text-xs text-ink2">
                    {MISSION_TYPE_LABELS[row.missionType]}
                    {row.bucket && (
                      <span className="block text-ink3">
                        {assignmentBucketLabel({
                          positionName: row.positionName,
                          timeLabel: row.timeLabel,
                          hours: row.hours ?? 0,
                          points: row.points ?? 0,
                          bucket: row.bucket as FairnessBucket,
                          burdenBase: row.burdenBase,
                          burdenRest: row.burdenRest,
                          burdenIsSolo: row.burdenIsSolo,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-2 min-w-[10rem]">
                    {data?.canEdit ? (
                      <div className="flex flex-col gap-1 min-w-[5rem]">
                        <input
                          type="number"
                          step="0.1"
                          className="w-20 text-sm px-2 py-1 border border-line2 rounded-lg"
                          value={pointEdits[key] ?? ""}
                          onChange={(e) =>
                            setPointEdits((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                        {row.pointsManual && (
                          <span className="text-[10px] text-amber-700">ידני</span>
                        )}
                      </div>
                    ) : (
                      <span className="font-semibold text-accent">
                        {row.points != null ? `+${row.points}` : "—"}
                      </span>
                    )}
                    {explainAssignmentPoints({
                      positionName: row.positionName,
                      timeLabel: row.timeLabel,
                      hours: row.hours ?? 0,
                      points: row.points ?? 0,
                      bucket: (row.bucket as FairnessBucket | undefined) ?? "solo",
                      burdenBase: row.burdenBase,
                      burdenRest: row.burdenRest,
                      burdenIsSolo: row.burdenIsSolo,
                    }).map((line) => (
                      <span key={line} className="block text-[10px] text-ink3 leading-snug mt-0.5">
                        {line}
                      </span>
                    ))}
                  </td>
                  {data?.canEdit && (
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={busy}
                          onClick={() => savePoints(row)}
                        >
                          נק׳
                        </button>
                        {row.pointsManual && (
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={busy}
                            onClick={() => resetPoints(row)}
                          >
                            אוטו
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-sm text-red-800"
                          disabled={busy}
                          onClick={() => removeAssignment(row)}
                        >
                          הסר
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (loading) {
    return (
      <AppShell title="פרופיל צוער">
        <main className="mx-auto max-w-4xl px-5 py-8">
          <p className="hint">טוען…</p>
        </main>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="פרופיל צוער">
        <main className="mx-auto max-w-4xl px-5 py-8">
          <div className="card">
            <p className="msg-err">{error || "לא נמצא"}</p>
            <Link href="/pluga" className="text-brick text-sm hover:underline">
              ← חזרה לפלוגה
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const { person, fairness, canEdit, isSelf } = data;

  return (
    <AppShell title={person.name}>
      <main className="mx-auto max-w-4xl px-5 py-8 space-y-5">
        <div className="card space-y-2">
          <div className="bar spread flex-wrap gap-2">
            <div>
              <Link href="/pluga" className="text-sm text-brick hover:underline">
                ← פלוגה
              </Link>
              <h2 className="font-display text-xl mt-1">{person.name}</h2>
              {isSelf && (
                <p className="text-xs text-accent">
                  זה את/ה ·{" "}
                  <Link href="/profile" className="underline">
                    הפרופיל שלי
                  </Link>
                </p>
              )}
            </div>
            <div className="text-sm text-ink2 text-left">
              {person.squad != null && <p>מחלקה {person.squad}</p>}
              {person.room && <p>חדר {person.room}</p>}
            </div>
          </div>
          {canEdit && (
            <p className="hint text-xs">
              מצב מנהל — ניתן להוסיף/להסיר שיבוצים (גם בדיעבד, גם אם נשארות משבצות ריקות) ולערוך
              נקודות.
            </p>
          )}
        </div>

        {error && <p className="msg-err">{error}</p>}
        {message && <p className="msg-ok">{message}</p>}

        <div className="card space-y-3">
          <p className="font-display text-sm">נקודות צדק</p>
          <p className="text-xs text-ink3">{JUSTICE_POINTS_EXPLANATION}</p>
          {fairness.missionDayCount != null && (
            <MissionDayScopeNote count={fairness.missionDayCount} />
          )}
          <div className="text-center py-2">
            <p className="hint text-xs mb-1">סה״כ נקודות צדק (שמירה + תורנות)</p>
            <p className="font-display text-3xl text-accent">
              {formatJusticePoints(justicePoints(fairness.burden, fairness.periodPoints))}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-sm border-t border-line2 pt-2">
            <div>
              <p className="hint text-xs">שמירה</p>
              <p className="font-display">{fairness.burden?.guardPoints?.toFixed(1) ?? "—"}</p>
            </div>
            <div>
              <p className="hint text-xs">תורנות</p>
              <p className="font-display">{fairness.burden?.toranutPoints?.toFixed(1) ?? "—"}</p>
            </div>
            <div>
              <p className="hint text-xs">ניקוד קודם</p>
              {canEdit ? (
                <form onSubmit={savePriorScore} className="flex flex-col items-center gap-1 mt-1">
                  <input
                    type="number"
                    step="0.1"
                    className="w-20 text-center text-sm px-2 py-1 border border-line2 rounded-lg"
                    value={priorScore}
                    onChange={(e) => setPriorScore(e.target.value)}
                  />
                  <button type="submit" className="btn-sm" disabled={savingPrior}>
                    {savingPrior ? "…" : "שמור"}
                  </button>
                </form>
              ) : (
                <p className="font-display">{fairness.priorScore}</p>
              )}
            </div>
            <div>
              <p className="hint text-xs">סה״כ + היסטוריה</p>
              <p className="font-display">{fairness.totalPoints}</p>
            </div>
          </div>
          {(fairness.burden?.guardBaseBurden != null ||
            fairness.burden?.restPenalties != null) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-xs border-t border-line2/60 pt-2">
              <div>
                <p className="hint text-[10px]">מתוכם — בסיס שמירות</p>
                <p>{fairness.burden?.guardBaseBurden?.toFixed(1) ?? "—"}</p>
              </div>
              <div>
                <p className="hint text-[10px]">עונשי חוסר מנוחה</p>
                <p>{fairness.burden?.restPenalties?.toFixed(1) ?? "—"}</p>
              </div>
              {(fairness.burden?.otherMissionPoints ?? 0) > 0 && (
                <div>
                  <p className="hint text-[10px]">עב״ס / כוננות</p>
                  <p>{fairness.burden?.otherMissionPoints?.toFixed(1)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <section className="card space-y-3">
          <h3 className="font-display text-base">שמירות ומשימות שמירה</h3>
          <p className="hint text-xs">ימי שמירות — לפי שעה ועמדה.</p>
          {renderAssignmentTable(guards, "אין שמירות מפורסמות.")}
        </section>

        <section className="card space-y-3">
          <h3 className="font-display text-base">תורנויות (מטבח · עב״ס)</h3>
          {renderAssignmentTable(toranut, "אין תורנויות מפורסמות.")}
        </section>

        {canEdit && (
          <section className="card space-y-3">
            <h3 className="font-display text-base">הוספת שיבוץ</h3>
            <p className="hint text-xs">
              בוחרים משבצת ריקה ממשימה מפורסמת. אפשר גם אם יש אזהרות (חפיפה, מנוחה וכו׳).
            </p>
            {data.availableSlots.length === 0 ? (
              <p className="hint text-sm">אין משבצות ריקות במשימות מפורסמות.</p>
            ) : (
              <form onSubmit={addAssignment} className="rowf items-end flex-wrap gap-2">
                <div className="field flex-1 min-w-[14rem]">
                  <label>משבצת פנויה</label>
                  <select
                    value={addSlotKey}
                    onChange={(e) => setAddSlotKey(e.target.value)}
                    required
                  >
                    <option value="">— בחרו —</option>
                    {data.availableSlots.map((slot) => (
                      <option
                        key={`${slot.missionId}:${slot.slotId}:${slot.seatIndex}`}
                        value={`${slot.missionId}:${slot.slotId}:${slot.seatIndex}`}
                      >
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn-pri" disabled={adding || !addSlotKey}>
                  {adding ? "מוסיף…" : "הוסף שיבוץ"}
                </button>
              </form>
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}
