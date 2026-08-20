"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_MISSION_SCHEDULING_RULES,
  MISSION_POSITION_KIND_LABELS,
  MISSION_STATUS_LABELS,
  MISSION_TYPE_LABELS,
  type MissionDay,
  type MissionPosition,
  type MissionPositionKind,
  type MissionSchedulingRules,
  type MissionSlot,
  type MissionType,
} from "@/lib/types";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

function newPosition(
  name: string,
  opts?: { kind?: MissionPositionKind; same_room?: boolean },
): MissionPosition {
  const kind = opts?.kind;
  return {
    id: uid(),
    name,
    kind,
    same_room:
      opts?.same_room ??
      (kind === "standby_carmel_a" || kind === "standby_carmel_b"),
    slots: [
      kind === "standby_carmel_a" || kind === "standby_carmel_b"
        ? newSlot("00:00", "00:00", 4)
        : newSlot(),
    ],
  };
}

function guardDayTemplate(): MissionPosition[] {
  return [
    newPosition("כרמל א׳ (כוננות)", { kind: "standby_carmel_a", same_room: true }),
    newPosition("כרמל ב׳ (כוננות)", { kind: "standby_carmel_b", same_room: true }),
    newPosition("עמדה 1", { kind: "guard" }),
    newPosition("עמדה 2", { kind: "guard" }),
  ];
}

const GUARD_KINDS: MissionPositionKind[] = [
  "guard",
  "standby_carmel_a",
  "standby_carmel_b",
];

function formatDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MissionEditor({ missionId }: { missionId?: string }) {
  const [loading, setLoading] = useState(!!missionId);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [title, setTitle] = useState("");
  const [missionType, setMissionType] = useState<MissionType>("guards");
  const [missionDate, setMissionDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [positions, setPositions] = useState<MissionPosition[]>([]);
  const [notes, setNotes] = useState("");
  const [schedulingRules, setSchedulingRules] = useState<MissionSchedulingRules>(
    DEFAULT_MISSION_SCHEDULING_RULES,
  );
  const [autoAssigning, setAutoAssigning] = useState(false);

  const load = useCallback(async () => {
    if (!missionId) return;
    setLoading(true);
    const res = await fetch(`/api/missions/${missionId}`);
    if (!res.ok) {
      setErr("לא נטען");
      setLoading(false);
      return;
    }
    const m: MissionDay = await res.json();
    setTitle(m.title);
    setMissionType(m.mission_type);
    setMissionDate(m.mission_date);
    setStartsAt(formatDatetimeLocal(m.starts_at));
    setEndsAt(formatDatetimeLocal(m.ends_at));
    setStatus(m.status);
    setPositions(m.positions);
    setSchedulingRules(m.scheduling_rules || DEFAULT_MISSION_SCHEDULING_RULES);
    setNotes(m.notes || "");
    setLoading(false);
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load]);

  function initCreate(type: MissionType) {
    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    setMissionType(type);
    setMissionDate(date);
    setStartsAt(`${date}T08:00`);
    setEndsAt(`${date}T20:00`);
    setTitle("");
    setSchedulingRules({ ...DEFAULT_MISSION_SCHEDULING_RULES });
    setPositions(
      type === "guards"
        ? guardDayTemplate()
        : [
            newPosition(type === "kitchen" ? "משמרות מטבח" : "משמרות עב״ס", {
              kind: type === "kitchen" ? "kitchen" : "duty",
            }),
          ],
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setErr("");

    const payload = {
      title: title || `${missionDate} · ${MISSION_TYPE_LABELS[missionType]}`,
      mission_type: missionType,
      mission_date: missionDate,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      status,
      positions,
      scheduling_rules: schedulingRules,
      notes: notes || null,
    };

    const res = await fetch(missionId ? `/api/missions/${missionId}` : "/api/missions", {
      method: missionId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setErr(data.error || "שגיאה");
      return;
    }

    setMsg("נשמר");
    if (!missionId) {
      window.location.href = `/admin/missions/${data.id}`;
    }
  }

  async function runAutoAssign() {
    if (!missionId) return;
    if (!confirm("ליצור שיבוץ חכם? משבצות שכבר מלאות יישארו.")) return;
    setAutoAssigning(true);
    setErr("");
    setMsg("");
    const res = await fetch("/api/missions/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, keep_existing: true }),
    });
    const data = await res.json();
    setAutoAssigning(false);
    if (!res.ok) {
      setErr(data.error || "שגיאה בשיבוץ");
      return;
    }
    await load();
    const warnCount = (data.warnings || []).length;
    setMsg(
      warnCount
        ? `שובצו ${data.filled} משבצות. ${warnCount} לא מולאו.`
        : `שובצו ${data.filled} משבצות.`,
    );
  }

  function updateSlot(posId: string, slotId: string, patch: Partial<MissionSlot>) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id !== posId
          ? p
          : {
              ...p,
              slots: p.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
            },
      ),
    );
  }

  function addSlot(posId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id !== posId ? p : { ...p, slots: [...p.slots, newSlot()] },
      ),
    );
  }

  function removeSlot(posId: string, slotId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id !== posId
          ? p
          : { ...p, slots: p.slots.filter((s) => s.id !== slotId) },
      ),
    );
  }

  function addPosition() {
    setPositions((prev) => [
      ...prev,
      newPosition(
        missionType === "guards" ? `עמדה ${prev.filter((p) => p.kind === "guard" || !p.kind).length + 1}` : prev[0]?.name || "משמרת",
        { kind: missionType === "guards" ? "guard" : missionType === "kitchen" ? "kitchen" : "duty" },
      ),
    ]);
  }

  function updatePositionKind(posId: string, kind: MissionPositionKind) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id !== posId
          ? p
          : {
              ...p,
              kind,
              same_room:
                kind === "standby_carmel_a" || kind === "standby_carmel_b",
            },
      ),
    );
  }

  if (loading) return <p className="hint p-5">טוען…</p>;

  if (!missionId && !positions.length) {
    return (
      <div className="card space-y-4">
        <h3 className="font-display text-lg">יצירת יום משימה חדש</h3>
        <p className="lede">בחרו סוג משימה:</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["guards", "base_work", "kitchen"] as MissionType[]).map((t) => (
            <button
              key={t}
              type="button"
              className="card card-link text-right p-4"
              onClick={() => initCreate(t)}
            >
              <span className="font-display">{MISSION_TYPE_LABELS[t]}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="card space-y-4">
        <h3 className="font-display text-lg">
          {missionId ? "עריכת יום משימה" : "יום משימה חדש"}
        </h3>

        <div className="field">
          <label>כותרת</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: שמירות יום ג׳" />
        </div>

        <div className="rowf">
          <div className="field">
            <label>סוג</label>
            <select
              value={missionType}
              onChange={(e) => setMissionType(e.target.value as MissionType)}
              disabled={!!missionId}
            >
              {Object.entries(MISSION_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>תאריך</label>
            <input
              type="date"
              required
              value={missionDate}
              onChange={(e) => setMissionDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "draft" | "published")}
            >
              {Object.entries(MISSION_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rowf">
          <div className="field">
            <label>התחלה</label>
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label>סיום</label>
            <input
              type="datetime-local"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>הערות (אופציונלי)</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="card space-y-4">
        <h4 className="font-display text-base">כללי שיבוץ ליום זה</h4>
        <p className="hint text-sm">
          משמשים בשיבוץ החכם ובחיפוש מחליף — מנוחה, כלל 4-8, ומשקלי כוננות.
        </p>
        <div className="rowf">
          <div className="field">
            <label>מנוחה מינימלית (שעות)</label>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={schedulingRules.rest_hours}
              onChange={(e) =>
                setSchedulingRules((r) => ({
                  ...r,
                  rest_hours: Math.max(0, +e.target.value || 0),
                }))
              }
            />
          </div>
          <div className="field">
            <label>כלל 4-8 (יחס מרווח)</label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={schedulingRules.guard_ratio}
              onChange={(e) =>
                setSchedulingRules((r) => ({
                  ...r,
                  guard_ratio: Math.max(0, +e.target.value || 0),
                }))
              }
            />
          </div>
          <div className="field">
            <label>שעת פתיחת לוח</label>
            <input
              type="time"
              value={schedulingRules.board_start}
              onChange={(e) =>
                setSchedulingRules((r) => ({ ...r, board_start: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="rowf">
          <div className="field">
            <label>נק׳/שעה — כרמל א׳</label>
            <input
              type="number"
              min={0}
              step={0.05}
              value={schedulingRules.standby_carmel_a_weight}
              onChange={(e) =>
                setSchedulingRules((r) => ({
                  ...r,
                  standby_carmel_a_weight: Math.max(0, +e.target.value || 0),
                }))
              }
            />
          </div>
          <div className="field">
            <label>נק׳/שעה — כרמל ב׳</label>
            <input
              type="number"
              min={0}
              step={0.05}
              value={schedulingRules.standby_carmel_b_weight}
              onChange={(e) =>
                setSchedulingRules((r) => ({
                  ...r,
                  standby_carmel_b_weight: Math.max(0, +e.target.value || 0),
                }))
              }
            />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="bar spread">
          <h4 className="font-display text-base">
            {missionType === "guards" ? "עמדות וכוננות" : "משמרות"}
          </h4>
          {missionType === "guards" && (
            <button type="button" className="btn-sm" onClick={addPosition}>
              + עמדה
            </button>
          )}
        </div>

        {positions.map((pos) => (
          <div key={pos.id} className="border border-line2 rounded p-3 space-y-3">
            <div className="rowf">
              <div className="field flex-1">
                <label>שם {missionType === "guards" ? "עמדה" : "קבוצה"}</label>
                <input
                  value={pos.name}
                  onChange={(e) =>
                    setPositions((prev) =>
                      prev.map((p) =>
                        p.id === pos.id ? { ...p, name: e.target.value } : p,
                      ),
                    )
                  }
                />
              </div>
              {missionType === "guards" && (
                <div className="field">
                  <label>סוג</label>
                  <select
                    value={pos.kind || "guard"}
                    onChange={(e) =>
                      updatePositionKind(pos.id, e.target.value as MissionPositionKind)
                    }
                  >
                    {GUARD_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {MISSION_POSITION_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {(pos.kind === "standby_carmel_a" || pos.kind === "standby_carmel_b") && (
              <p className="hint text-xs">
                כוננות מאותו חדר — השיבוץ החכם יבחר חדר שלם ({pos.kind === "standby_carmel_a" ? "כרמל א׳ — קשה יותר" : "כרמל ב׳"})
              </p>
            )}

            {pos.slots.map((slot) => (
              <div key={slot.id} className="rowf items-end">
                <div className="field">
                  <label>משעה</label>
                  <input
                    type="time"
                    value={slot.start_time}
                    onChange={(e) =>
                      updateSlot(pos.id, slot.id, { start_time: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>עד</label>
                  <input
                    type="time"
                    value={slot.end_time}
                    onChange={(e) =>
                      updateSlot(pos.id, slot.id, { end_time: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>מאיישים</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={slot.seat_count}
                    onChange={(e) =>
                      updateSlot(pos.id, slot.id, {
                        seat_count: Math.max(1, +e.target.value || 1),
                      })
                    }
                  />
                </div>
                {pos.slots.length > 1 && (
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => removeSlot(pos.id, slot.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            <button type="button" className="btn-sm" onClick={() => addSlot(pos.id)}>
              + משמרת / חלון שעות
            </button>
          </div>
        ))}
      </div>

      {err && <p className="msg-err">{err}</p>}
      {msg && <p className="msg-ok">{msg}</p>}

      <div className="bar flex-wrap gap-2">
        <button type="submit" className="btn-pri" disabled={saving}>
          {saving ? "שומר…" : "שמור"}
        </button>
        {missionId && (
          <button
            type="button"
            className="btn-pri"
            disabled={autoAssigning || saving}
            onClick={runAutoAssign}
          >
            {autoAssigning ? "משבץ…" : "שיבוץ חכם"}
          </button>
        )}
        <Link href="/admin/missions" className="btn">
          חזרה לרשימה
        </Link>
        <Link href="/board" className="btn">
          צפייה בלוח
        </Link>
      </div>
    </form>
  );
}
