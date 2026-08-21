"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_BASE_WORK_SCHEDULING_RULES,
  DEFAULT_KITCHEN_SCHEDULING_RULES,
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
import {
  boardStartFromMissionStart,
  defaultMissionWindow,
  defaultSchedulingForType,
  missionTemplateComplete,
  resolveMissionPositions,
  generateGuardMissionStructure,
  STANDARD_BASE_WORK_SUMMARY,
  STANDARD_GUARD_DAY_SUMMARY,
  STANDARD_KITCHEN_SUMMARY,
  standardMissionPositions,
  guardPositionHint,
  summarizeGuardSlots,
} from "@/lib/mission-templates";

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
        ? newSlot("00:00", "00:00", 3)
        : newSlot(),
    ],
  };
}

const GUARD_KINDS: MissionPositionKind[] = [
  "guard",
  "standby_carmel_a",
  "standby_carmel_b",
  "officer_duty",
];

function formatDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MissionEditor({ missionId }: { missionId?: string }) {
  const searchParams = useSearchParams();
  const initialTypeParam = searchParams.get("type");
  const initialType =
    initialTypeParam === "guards" ||
    initialTypeParam === "kitchen" ||
    initialTypeParam === "base_work"
      ? initialTypeParam
      : null;
  const createInitDone = useRef(false);
  const templateFixDone = useRef(false);
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

  function applyStandardTemplate(
    type: MissionType,
    window: { startsAt: string; endsAt: string; missionDate: string },
    rules?: MissionSchedulingRules,
  ) {
    const isoStart = new Date(window.startsAt).toISOString();
    const isoEnd = new Date(window.endsAt).toISOString();
    let scheduling = rules ?? defaultSchedulingForType(type, isoStart);
    if (type === "guards") {
      scheduling = {
        ...scheduling,
        board_start: boardStartFromMissionStart(isoStart),
      };
    }
    setMissionType(type);
    setMissionDate(window.missionDate);
    setStartsAt(window.startsAt);
    setEndsAt(window.endsAt);
    setSchedulingRules(scheduling);
    setPositions(
      standardMissionPositions({
        missionType: type,
        startsAt: isoStart,
        endsAt: isoEnd,
        scheduling,
      }),
    );
  }

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
    const rules =
      m.scheduling_rules || defaultSchedulingForType(m.mission_type, m.starts_at);
    const needsTemplateFix =
      m.status === "draft" &&
      !templateFixDone.current &&
      !missionTemplateComplete(m.mission_type, m.positions);
    const positions = needsTemplateFix
      ? resolveMissionPositions({
          missionType: m.mission_type,
          startsAt: m.starts_at,
          endsAt: m.ends_at,
          scheduling: rules,
          clientPositions: m.positions,
          regenerateStructure: m.mission_type === "guards",
        })
      : m.positions;

    setTitle(m.title);
    setMissionType(m.mission_type);
    setMissionDate(m.mission_date);
    setStartsAt(formatDatetimeLocal(m.starts_at));
    setEndsAt(formatDatetimeLocal(m.ends_at));
    setStatus(m.status);
    setSchedulingRules(rules);
    setPositions(positions);
    setNotes(m.notes || "");
    if (needsTemplateFix) {
      templateFixDone.current = true;
      setMsg("נטענה תבנית סטנדרטית — לחצו «שמור» כדי לעדכן את יום המשימה");
    }
    setLoading(false);
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (missionId || createInitDone.current || !initialType) return;
    createInitDone.current = true;
    initCreate(initialType);
  }, [missionId, initialType]);

  function initCreate(type: MissionType) {
    const date = new Date().toISOString().slice(0, 10);
    const window = defaultMissionWindow(type, date);
    applyStandardTemplate(type, window);
    setTitle("");
  }

  function regenerateGuardStructure() {
    if (missionType !== "guards") return;
    if (
      !confirm(
        "ליצור מחדש את מבנה המשמרות לפי שעות יום המשימה? שיבוצים קיימים עלולים לא להתאים.",
      )
    ) {
      return;
    }
    setPositions(
      generateGuardMissionStructure(positions, {
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        scheduling: schedulingRules,
      }),
    );
    setMsg("מבנה המשמרות עודכן — לחצו «שמור» כדי לשמור");
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
      regenerate_structure: false,
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

    if (missionType === "guards" || !missionTemplateComplete(missionType, positions)) {
      setPositions(data.positions ?? positions);
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
    const status = data.status as string | undefined;
    const assignedSeats = data.assignedSeats ?? data.filled;
    const requiredSeats = data.requiredSeats;
    const warnings: string[] = data.warnings || [];
    const statusLine =
      status === "complete"
        ? `שיבוץ הושלם — ${assignedSeats}/${requiredSeats ?? assignedSeats} משבצות`
        : status === "infeasible"
          ? `שיבוץ לא אפשרי — ${assignedSeats}/${requiredSeats ?? "?"} משבצות בלבד`
          : status === "partial"
            ? `שיבוץ חלקי — ${assignedSeats}/${requiredSeats ?? "?"} משבצות`
            : `שובצו ${data.filled} משבצות`;
    if (warnings.length) {
      const preview = warnings.slice(0, 4).join(" · ");
      const more = warnings.length > 4 ? ` · …ועוד ${warnings.length - 4}` : "";
      setMsg(`${statusLine}. ${preview}${more}`);
    } else {
      setMsg(statusLine);
    }
  }

  function updateSlot(posId: string, slotId: string, patch: Partial<MissionSlot>) {
    if ("start_time" in patch || "end_time" in patch) {
      patch = { ...patch, starts_at: undefined, ends_at: undefined };
    }
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

  if (!missionId && !positions.length && !initialType) {
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
              onChange={(e) => {
                const value = e.target.value;
                setStartsAt(value);
                if (missionType === "guards" && value) {
                  setSchedulingRules((r) => ({
                    ...r,
                    board_start: boardStartFromMissionStart(
                      new Date(value).toISOString(),
                    ),
                  }));
                }
              }}
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
          משמשים בשיבוץ החכם — מנוחה, כלל 4-8, אורך משמרת. כרמל א/ב בטבלת הצדק.
          {schedulingRules.guard_day_bundle_id && (
            <> · יום מאוחד שמירות+עב״ס — השיבוץ מונע חפיפות (מלבד כרמל ב׳).</>
          )}
        </p>
        {schedulingRules.linked_mission_id && (
          <p className="hint text-sm">
            משימה מקושרת:{" "}
            <Link
              href={`/admin/missions/${schedulingRules.linked_mission_id}`}
              className="underline"
            >
              {missionType === "guards" ? "עריכת עב״ס" : "עריכת שמירות"}
            </Link>
          </p>
        )}
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
            <label>אורך משמרת (שעות)</label>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={schedulingRules.shift_hours ?? 4}
              onChange={(e) =>
                setSchedulingRules((r) => ({
                  ...r,
                  shift_hours: Math.max(1, +e.target.value || 4),
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
          {(missionType === "guards" || missionType === "base_work") && (
            <div className="field">
              <label>מרווח עב״ס↔שמירה (דק׳)</label>
              <input
                type="number"
                min={0}
                max={120}
                step={5}
                value={schedulingRules.duty_guard_gap_minutes ?? 30}
                onChange={(e) =>
                  setSchedulingRules((r) => ({
                    ...r,
                    duty_guard_gap_minutes: Math.max(0, +e.target.value || 0),
                  }))
                }
              />
            </div>
          )}
        </div>
        {missionType === "guards" && (
          <>
            <ul className="hint text-sm list-disc pr-5 space-y-1">
              {STANDARD_GUARD_DAY_SUMMARY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                if (
                  !confirm(
                    "לטעון מחדש את יום השמירות הסטנדרטי? כל העמדות והשעות יוחלפו לפי הפקודה ותחילת/סוף יום המשימה.",
                  )
                ) {
                  return;
                }
                applyStandardTemplate("guards", {
                  missionDate: missionDate,
                  startsAt,
                  endsAt,
                });
              }}
            >
              טען יום שמירות סטנדרטי (כל העמדות)
            </button>
          </>
        )}
        {missionType === "kitchen" && (
          <>
            <ul className="hint text-sm list-disc pr-5 space-y-1">
              {STANDARD_KITCHEN_SUMMARY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="rowf">
              <div className="field">
                <label>צוערים למשמרת</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={schedulingRules.kitchen?.seats_per_shift ?? 35}
                  onChange={(e) => {
                    const seats = Math.max(1, +e.target.value || 35);
                    setSchedulingRules((r) => ({
                      ...r,
                      kitchen: {
                        ...(r.kitchen || DEFAULT_KITCHEN_SCHEDULING_RULES),
                        seats_per_shift: seats,
                      },
                    }));
                  }}
                />
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="field">
                  <label>מנוחה משמרת {i + 1} — צוות</label>
                  <select
                    value={
                      schedulingRules.kitchen?.squad_rest_by_shift?.[i] ?? i + 1
                    }
                    onChange={(e) => {
                      const squad = +e.target.value;
                      setSchedulingRules((r) => {
                        const rest = [
                          ...(r.kitchen?.squad_rest_by_shift ||
                            DEFAULT_KITCHEN_SCHEDULING_RULES.squad_rest_by_shift),
                        ];
                        rest[i] = squad;
                        return {
                          ...r,
                          kitchen: {
                            ...(r.kitchen || DEFAULT_KITCHEN_SCHEDULING_RULES),
                            squad_rest_by_shift: rest,
                          },
                        };
                      });
                    }}
                  >
                    {[1, 2, 3, 4].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="hint text-xs">
              35 צוערים בכל משמרת. בכל משמרת צוות אחד במנוחה — אותו אדם יכול במספר משמרות.
              נקודות צדק קבועות למשמרת (לא לפי שעות).
            </p>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                if (!confirm("לטעון מחדש 4 משמרות מטבח (06–22)?")) return;
                applyStandardTemplate(
                  "kitchen",
                  { missionDate, startsAt, endsAt },
                  schedulingRules,
                );
              }}
            >
              טען משמרות מטבח (4×35)
            </button>
          </>
        )}
        {missionType === "base_work" && (
          <>
            <ul className="hint text-sm list-disc pr-5 space-y-1">
              {STANDARD_BASE_WORK_SUMMARY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="rowf">
              <div className="field">
                <label>יעד צוערים בחלון (13–15)</label>
                <input
                  type="number"
                  min={13}
                  max={15}
                  value={schedulingRules.base_work?.seats_per_shift ?? 14}
                  onChange={(e) => {
                    const seats = Math.max(13, Math.min(15, +e.target.value || 14));
                    setSchedulingRules((r) => ({
                      ...r,
                      base_work: {
                        ...(r.base_work || DEFAULT_BASE_WORK_SCHEDULING_RULES),
                        seats_per_shift: seats,
                      },
                    }));
                  }}
                />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="field">
                  <label>מנוחה חלון {i + 1} — צוות</label>
                  <select
                    value={
                      schedulingRules.base_work?.squad_rest_by_shift?.[i] ?? i + 1
                    }
                    onChange={(e) => {
                      const squad = +e.target.value;
                      setSchedulingRules((r) => {
                        const rest = [
                          ...(r.base_work?.squad_rest_by_shift ||
                            DEFAULT_BASE_WORK_SCHEDULING_RULES.squad_rest_by_shift),
                        ];
                        rest[i] = squad;
                        return {
                          ...r,
                          base_work: {
                            ...(r.base_work || DEFAULT_BASE_WORK_SCHEDULING_RULES),
                            squad_rest_by_shift: rest,
                          },
                        };
                      });
                    }}
                  >
                    {[1, 2, 3, 4].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="hint text-xs">
              בכל חלון משובץ צוות שלם (13–15). צוות אחד במנוחה לכל חלון.
            </p>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                if (!confirm("לטעון מחדש חלונות עב״ס מהפקודה?")) return;
                applyStandardTemplate(
                  "base_work",
                  { missionDate, startsAt, endsAt },
                  schedulingRules,
                );
              }}
            >
              טען חלונות עב״ס
            </button>
          </>
        )}
      </div>

      <div className="card space-y-4">
        <div className="bar spread">
          <h4 className="font-display text-base">
            {missionType === "guards" ? "עמדות וכוננות" : "משמרות"}
          </h4>
          {missionType === "guards" && !missionTemplateComplete("guards", positions) && (
            <button type="button" className="btn-sm" onClick={addPosition}>
              + עמדה נוספת
            </button>
          )}
        </div>

        {positions.map((pos) => {
          const guardHint = missionType === "guards" ? guardPositionHint(pos) : null;
          const slotSummary =
            missionType === "guards" && pos.slots.length > 1
              ? summarizeGuardSlots(pos.slots)
              : null;

          return (
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
            {guardHint && <p className="hint text-xs">{guardHint}</p>}
            {slotSummary && <p className="hint text-xs">{slotSummary}</p>}
            {missionType === "kitchen" && (
              <p className="hint text-xs">
                ערוך שעות ומספר מקומות לכל משמרת (ברירת מחדל 35).
              </p>
            )}

            {pos.slots.map((slot) => {
              const allowZeroSeats =
                missionType === "guards" && pos.name.includes("רגלי");
              return (
              <div
                key={slot.id}
                className={`rowf items-end${slot.seat_count === 0 ? " opacity-60" : ""}`}
              >
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
                    min={allowZeroSeats ? 0 : 1}
                    max={
                      missionType === "kitchen"
                        ? 60
                        : missionType === "base_work"
                          ? 15
                          : 10
                    }
                    value={slot.seat_count}
                    onChange={(e) =>
                      updateSlot(pos.id, slot.id, {
                        seat_count: Math.max(
                          allowZeroSeats ? 0 : 1,
                          +e.target.value || (allowZeroSeats ? 0 : 1),
                        ),
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
              );
            })}

            <button type="button" className="btn-sm" onClick={() => addSlot(pos.id)}>
              + משמרת / חלון שעות
            </button>
          </div>
          );
        })}
      </div>

      {err && <p className="msg-err">{err}</p>}
      {msg && <p className="msg-ok">{msg}</p>}

      <div className="bar flex-wrap gap-2">
        <button type="submit" className="btn-pri" disabled={saving}>
          {saving ? "שומר…" : "שמור"}
        </button>
        {missionType === "guards" && (
          <button
            type="button"
            className="btn"
            disabled={saving || autoAssigning}
            onClick={regenerateGuardStructure}
          >
            סנכרן מבנה משמרות
          </button>
        )}
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
