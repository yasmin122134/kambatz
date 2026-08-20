"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  MISSION_STATUS_LABELS,
  MISSION_TYPE_LABELS,
  type MissionDay,
  type MissionPosition,
  type MissionSlot,
  type MissionType,
} from "@/lib/types";

function uid() {
  return crypto.randomUUID();
}

function newSlot(start = "08:00", end = "10:00", seats = 1): MissionSlot {
  return { id: uid(), start_time: start, end_time: end, seat_count: seats };
}

function newPosition(name: string): MissionPosition {
  return { id: uid(), name, slots: [newSlot()] };
}

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
    setPositions(
      type === "guards"
        ? [newPosition("עמדה 1"), newPosition("עמדה 2")]
        : [newPosition(type === "kitchen" ? "משמרות מטבח" : "משמרות עב״ס")],
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
        missionType === "guards" ? `עמדה ${prev.length + 1}` : prev[0]?.name || "משמרת",
      ),
    ]);
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
        <div className="bar spread">
          <h4 className="font-display text-base">
            {missionType === "guards" ? "עמדות שמירה" : "משמרות"}
          </h4>
          {missionType === "guards" && (
            <button type="button" className="btn-sm" onClick={addPosition}>
              + עמדה
            </button>
          )}
        </div>

        {positions.map((pos) => (
          <div key={pos.id} className="border border-line2 rounded p-3 space-y-3">
            <div className="field">
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

      <div className="bar">
        <button type="submit" className="btn-pri" disabled={saving}>
          {saving ? "שומר…" : "שמור"}
        </button>
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
