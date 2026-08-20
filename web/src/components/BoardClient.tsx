"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NameCombobox } from "@/components/NameCombobox";
import {
  ISSUE_STATUS_LABELS,
  ISSUE_TYPE_LABELS,
  PERSONAL_FLAG_LABELS,
  type Issue,
  type MissionDay,
  type ProfileRequest,
  type FairnessRuleRequest,
  FAIRNESS_BUCKET_LABELS,
  DEFAULT_FAIRNESS_RULES,
} from "@/lib/types";
import { flattenMissionSlots } from "@/lib/mission-utils";

type Props = {
  personName: string;
  initialMissions: MissionDay[];
  isAdmin: boolean;
};

type SwapMode = "take" | "swap" | null;

export function BoardClient({ personName, initialMissions, isAdmin }: Props) {
  const [missions, setMissions] = useState(initialMissions);
  const dates = useMemo(
    () => [...new Set(missions.map((m) => m.mission_date))].sort(),
    [missions],
  );
  const [activeDate, setActiveDate] = useState(
    initialMissions[0]?.mission_date || "",
  );
  const [isAdminUser, setIsAdminUser] = useState(isAdmin);
  const [showConstraints, setShowConstraints] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [fairnessRequests, setFairnessRequests] = useState<FairnessRuleRequest[]>([]);
  const [publishedRules, setPublishedRules] = useState(DEFAULT_FAIRNESS_RULES);
  const [swapTarget, setSwapTarget] = useState<{
    missionId: string;
    slotId: string;
    seatIndex: number;
    label: string;
  } | null>(null);
  const [swapMode, setSwapMode] = useState<SwapMode>(null);
  const [msg, setMsg] = useState("");
  const [autoAssigning, setAutoAssigning] = useState(false);

  const dayMissions = useMemo(
    () => missions.filter((m) => m.mission_date === activeDate),
    [missions, activeDate],
  );

  const guardsMission = dayMissions.find((m) => m.mission_type === "guards");
  const baseMission = dayMissions.find((m) => m.mission_type === "base_work");
  const kitchenMission = dayMissions.find((m) => m.mission_type === "kitchen");

  const mySlots = useMemo(() => {
    return dayMissions.flatMap((m) =>
      flattenMissionSlots(m).filter((s) => s.assignees.includes(personName)),
    );
  }, [dayMissions, personName]);

  const loadMissions = useCallback(async () => {
    const url = isAdminUser ? "/api/missions" : "/api/missions?published=1";
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setMissions(data);
      const nextDates = [...new Set(data.map((m: MissionDay) => m.mission_date))].sort();
      if (activeDate && !nextDates.includes(activeDate) && nextDates[0]) {
        setActiveDate(String(nextDates[0]));
      }
    }
  }, [activeDate, isAdminUser]);

  const loadAdminData = useCallback(async () => {
    if (!isAdminUser) return;
    const [i, p, f, rulesRes] = await Promise.all([
      fetch("/api/issues?status=pending").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/profile-requests?status=pending").then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/fairness/requests?status=pending").then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/fairness").then((r) => (r.ok ? r.json() : null)),
    ]);
    setIssues(i);
    setProfileRequests(p);
    setFairnessRequests(f);
    if (rulesRes?.rules) setPublishedRules(rulesRes.rules);
  }, [isAdminUser]);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setIsAdminUser(!!d.admin))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, isAdminUser]);

  async function patchAssignment(
    missionId: string,
    body: Record<string, unknown>,
  ) {
    setMsg("");
    const res = await fetch(`/api/missions/${missionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      return null;
    }
    setMissions((prev) => prev.map((m) => (m.id === data.id ? data : m)));
    return data as MissionDay;
  }

  async function handleTake(missionId: string, slotId: string, seatIndex: number) {
    await patchAssignment(missionId, {
      action: "take",
      slot_id: slotId,
      seat_index: seatIndex,
    });
    setSwapTarget(null);
    setSwapMode(null);
  }

  async function handleSwap(
    missionId: string,
    from: { slotId: string; seatIndex: number },
    to: { slotId: string; seatIndex: number },
  ) {
    await patchAssignment(missionId, {
      action: "swap",
      slot_id: from.slotId,
      seat_index: from.seatIndex,
      target_slot_id: to.slotId,
      target_seat_index: to.seatIndex,
    });
    setSwapTarget(null);
    setSwapMode(null);
  }

  async function adminSetName(
    missionId: string,
    slotId: string,
    seatIndex: number,
    name: string,
  ) {
    await patchAssignment(missionId, {
      action: "admin_set",
      slot_id: slotId,
      seat_index: seatIndex,
      name,
    });
  }

  async function adminReplacementSwap(
    missionId: string,
    slotId: string,
    seatIndex: number,
    targetSlotId: string,
    targetSeatIndex: number,
  ) {
    await patchAssignment(missionId, {
      action: "swap",
      slot_id: slotId,
      seat_index: seatIndex,
      target_slot_id: targetSlotId,
      target_seat_index: targetSeatIndex,
    });
  }

  async function setIssueStatus(id: string, status: "approved" | "rejected") {
    await fetch("/api/issues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadAdminData();
  }

  async function setProfileStatus(id: string, status: "approved" | "rejected") {
    await fetch("/api/profile-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadAdminData();
  }

  async function runAutoAssign() {
    if (!activeDate || !confirm("ליצור שיבוץ חכם ליום זה? משבצות שכבר מלאות יישארו.")) {
      return;
    }
    setAutoAssigning(true);
    setMsg("");
    const res = await fetch("/api/missions/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_date: activeDate, keep_existing: true }),
    });
    const data = await res.json();
    setAutoAssigning(false);
    if (!res.ok) {
      setMsg(data.error || "שגיאה בשיבוץ");
      return;
    }
    await loadMissions();
    const filled = (data.results || []).reduce(
      (sum: number, r: { filled: number }) => sum + r.filled,
      0,
    );
    const warnCount = (data.warnings || []).length;
    setMsg(
      warnCount
        ? `שובצו ${filled} משבצות. ${warnCount} משבצות לא מולאו — אין מספיק צוערים פנויים.`
        : `שובצו ${filled} משבצות בהצלחה.`,
    );
  }

  async function setFairnessStatus(id: string, status: "approved" | "rejected") {
    await fetch("/api/fairness/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadAdminData();
  }

  function formatFairnessDiff(req: FairnessRuleRequest) {
    return (Object.keys(FAIRNESS_BUCKET_LABELS) as (keyof typeof FAIRNESS_BUCKET_LABELS)[])
      .map((k) => {
        if (req.proposed_rules[k] === publishedRules[k]) return null;
        return `${FAIRNESS_BUCKET_LABELS[k]}: ${publishedRules[k]}→${req.proposed_rules[k]}`;
      })
      .filter(Boolean)
      .join(" · ");
  }

  function formatDate(d: string) {
    return new Date(d + "T12:00:00").toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  if (!missions.length) {
    return (
      <div className="card mx-5 mt-6 max-w-4xl">
        <p className="hint mb-4">אין ימי משימה שפורסמו עדיין.</p>
        {isAdminUser && (
          <Link href="/admin/missions" className="btn-pri btn-sm">
            צור יום משימה
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="bar spread mb-4 flex-wrap gap-3">
        <h2 className="font-display text-xl">רשימה מלאה</h2>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn-sm" onClick={loadMissions}>
            רענון
          </button>
          {isAdminUser && (
            <>
              <button
                type="button"
                className="btn-pri btn-sm"
                disabled={autoAssigning || !activeDate}
                onClick={runAutoAssign}
              >
                {autoAssigning ? "משבץ…" : "שיבוץ חכם ליום"}
              </button>
              <button
                type="button"
                className={`btn-sm ${showConstraints ? "on" : ""}`}
                onClick={() => setShowConstraints((v) => !v)}
              >
                אילוצים
                {(issues.length + profileRequests.length + fairnessRequests.length) > 0 && (
                  <span className="mr-1">({issues.length + profileRequests.length + fairnessRequests.length})</span>
                )}
              </button>
              <Link href="/admin/missions" className="btn-sm">
                ניהול ימי משימה
              </Link>
            </>
          )}
        </div>
      </div>

      {msg && (
        <p className={`mb-3 ${msg.includes("שובצו") ? "msg-ok" : "msg-err"}`}>{msg}</p>
      )}

      {showConstraints && isAdminUser && (
        <ConstraintsPanel
          issues={issues}
          profileRequests={profileRequests}
          fairnessRequests={fairnessRequests}
          onIssue={setIssueStatus}
          onProfile={setProfileStatus}
          onFairness={setFairnessStatus}
          formatFairnessDiff={formatFairnessDiff}
        />
      )}

      <div className="day-tabs mb-6">
        {dates.map((d, i) => (
          <button
            key={d}
            type="button"
            className={`day-tab ${d === activeDate ? "on" : ""}`}
            onClick={() => setActiveDate(d)}
          >
            {i > 0 && <span className="day-tab-sep" aria-hidden>›</span>}
            <span className="day-tab-date">{formatDate(d)}</span>
          </button>
        ))}
      </div>

      <div className="board-panels space-y-6">
        <PanelSection title="שמירות" mission={guardsMission} empty="אין יום שמירות ביום זה">
          {guardsMission && (
            <MissionPanel
              mission={guardsMission}
              personName={personName}
              isAdmin={isAdminUser}
              mySlots={mySlots}
              swapTarget={swapTarget}
              swapMode={swapMode}
              onStartSwap={(slotId, seatIndex, label) => {
                setSwapTarget({
                  missionId: guardsMission.id,
                  slotId,
                  seatIndex,
                  label,
                });
                setSwapMode(null);
              }}
              onSwapMode={setSwapMode}
              onTake={(slotId, seatIndex) =>
                handleTake(guardsMission.id, slotId, seatIndex)
              }
              onSwap={(toSlotId, toSeatIndex) => {
                if (!swapTarget) return;
                handleSwap(
                  guardsMission.id,
                  { slotId: swapTarget.slotId, seatIndex: swapTarget.seatIndex },
                  { slotId: toSlotId, seatIndex: toSeatIndex },
                );
              }}
              onAdminSet={adminSetName}
              onAdminReplacementSwap={adminReplacementSwap}
              onCancelSwap={() => {
                setSwapTarget(null);
                setSwapMode(null);
              }}
            />
          )}
        </PanelSection>

        <PanelSection title="עבודות בסיס" mission={baseMission} empty="אין עב״ס ביום זה">
          {baseMission && (
            <MissionPanel
              mission={baseMission}
              personName={personName}
              isAdmin={isAdminUser}
              mySlots={mySlots}
              swapTarget={swapTarget}
              swapMode={swapMode}
              onStartSwap={(slotId, seatIndex, label) => {
                setSwapTarget({
                  missionId: baseMission.id,
                  slotId,
                  seatIndex,
                  label,
                });
                setSwapMode(null);
              }}
              onSwapMode={setSwapMode}
              onTake={(slotId, seatIndex) =>
                handleTake(baseMission.id, slotId, seatIndex)
              }
              onSwap={(toSlotId, toSeatIndex) => {
                if (!swapTarget) return;
                handleSwap(
                  baseMission.id,
                  { slotId: swapTarget.slotId, seatIndex: swapTarget.seatIndex },
                  { slotId: toSlotId, seatIndex: toSeatIndex },
                );
              }}
              onAdminSet={adminSetName}
              onAdminReplacementSwap={adminReplacementSwap}
              onCancelSwap={() => {
                setSwapTarget(null);
                setSwapMode(null);
              }}
            />
          )}
        </PanelSection>

        <PanelSection title="מטבח" mission={kitchenMission} empty="אין תורנות מטבח ביום זה">
          {kitchenMission && (
            <MissionPanel
              mission={kitchenMission}
              personName={personName}
              isAdmin={isAdminUser}
              mySlots={mySlots}
              swapTarget={swapTarget}
              swapMode={swapMode}
              onStartSwap={(slotId, seatIndex, label) => {
                setSwapTarget({
                  missionId: kitchenMission.id,
                  slotId,
                  seatIndex,
                  label,
                });
                setSwapMode(null);
              }}
              onSwapMode={setSwapMode}
              onTake={(slotId, seatIndex) =>
                handleTake(kitchenMission.id, slotId, seatIndex)
              }
              onSwap={(toSlotId, toSeatIndex) => {
                if (!swapTarget) return;
                handleSwap(
                  kitchenMission.id,
                  { slotId: swapTarget.slotId, seatIndex: swapTarget.seatIndex },
                  { slotId: toSlotId, seatIndex: toSeatIndex },
                );
              }}
              onAdminSet={adminSetName}
              onAdminReplacementSwap={adminReplacementSwap}
              onCancelSwap={() => {
                setSwapTarget(null);
                setSwapMode(null);
              }}
            />
          )}
        </PanelSection>
      </div>
    </div>
  );
}

function PanelSection({
  title,
  mission,
  empty,
  children,
}: {
  title: string;
  mission?: MissionDay;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <h3 className="font-display text-lg mb-3">{title}</h3>
      {!mission ? <p className="hint">{empty}</p> : children}
    </section>
  );
}

function ConstraintsPanel({
  issues,
  profileRequests,
  fairnessRequests,
  onIssue,
  onProfile,
  onFairness,
  formatFairnessDiff,
}: {
  issues: Issue[];
  profileRequests: ProfileRequest[];
  fairnessRequests: FairnessRuleRequest[];
  onIssue: (id: string, s: "approved" | "rejected") => void;
  onProfile: (id: string, s: "approved" | "rejected") => void;
  onFairness: (id: string, s: "approved" | "rejected") => void;
  formatFairnessDiff: (req: FairnessRuleRequest) => string;
}) {
  const empty =
    issues.length === 0 &&
    profileRequests.length === 0 &&
    fairnessRequests.length === 0;

  return (
    <section className="card mb-6">
      <h3 className="font-display text-base mb-3">אילוצים והצעות ממתינים</h3>
      {empty ? (
        <p className="hint">אין פריטים ממתינים.</p>
      ) : (
        <ul className="space-y-3">
          {issues.map((iss) => (
            <li key={iss.id} className="issue-row">
              <div>
                <b>{iss.person_name}</b>
                <span className="mono mx-2">
                  {iss.start_time}–{iss.end_time}
                </span>
                <span>{ISSUE_TYPE_LABELS[iss.issue_type]}</span>
                {iss.note && <span className="text-ink2 mr-2"> — {iss.note}</span>}
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn-pri btn-sm" onClick={() => onIssue(iss.id, "approved")}>
                  אשר
                </button>
                <button type="button" className="btn-sm" onClick={() => onIssue(iss.id, "rejected")}>
                  דחה
                </button>
              </div>
            </li>
          ))}
          {profileRequests.map((req) => (
            <li key={req.id} className="issue-row">
              <div>
                <b>{req.person_name}</b>
                <span className="text-ink2 mr-2">
                  —{" "}
                  {(Object.keys(PERSONAL_FLAG_LABELS) as (keyof typeof PERSONAL_FLAG_LABELS)[])
                    .filter((k) => req[k])
                    .map((k) => PERSONAL_FLAG_LABELS[k])
                    .join(" · ") || "ללא סימונים"}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn-pri btn-sm" onClick={() => onProfile(req.id, "approved")}>
                  אשר
                </button>
                <button type="button" className="btn-sm" onClick={() => onProfile(req.id, "rejected")}>
                  דחה
                </button>
              </div>
            </li>
          ))}
          {fairnessRequests.map((req) => (
            <li key={req.id} className="issue-row">
              <div>
                <b>{req.person_name}</b>
                <span className="text-ink2 mr-2"> — הצעת שינוי לטבלת צדק</span>
                <p className="text-sm text-ink2 mt-1">{formatFairnessDiff(req) || "שינוי משקלים"}</p>
                {req.note && <p className="text-sm text-ink3 mt-1">{req.note}</p>}
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn-pri btn-sm" onClick={() => onFairness(req.id, "approved")}>
                  אשר
                </button>
                <button type="button" className="btn-sm" onClick={() => onFairness(req.id, "rejected")}>
                  דחה
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MissionPanel({
  mission,
  personName,
  isAdmin,
  mySlots,
  swapTarget,
  swapMode,
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onAdminSet,
  onAdminReplacementSwap,
  onCancelSwap,
}: {
  mission: MissionDay;
  personName: string;
  isAdmin: boolean;
  mySlots: ReturnType<typeof flattenMissionSlots>;
  swapTarget: { missionId: string; slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onAdminSet: (missionId: string, slotId: string, seatIndex: number, name: string) => void;
  onAdminReplacementSwap: (
    missionId: string,
    slotId: string,
    seatIndex: number,
    targetSlotId: string,
    targetSeatIndex: number,
  ) => void;
  onCancelSwap: () => void;
}) {
  const slots = flattenMissionSlots(mission);

  if (mission.mission_type === "guards") {
    const positions = mission.positions || [];
    return (
      <div className="guard-grid">
          {positions.map((pos) => {
            const posSlots = slots.filter((s) => s.positionId === pos.id);
            return (
              <div key={pos.id} className="guard-col">
                <h4 className="font-display text-sm mb-3 text-center">{pos.name}</h4>
                <div className="space-y-3">
                  {posSlots.map((slot) => (
                    <SlotCard
                      key={slot.slotId}
                      missionId={mission.id}
                      slot={slot}
                      personName={personName}
                      isAdmin={isAdmin}
                      swapTarget={swapTarget}
                      swapMode={swapMode}
                      mySlotIds={new Set(mySlots.map((s) => s.slotId))}
                      onStartSwap={onStartSwap}
                      onSwapMode={onSwapMode}
                      onTake={onTake}
                      onSwap={onSwap}
                      onAdminSet={onAdminSet}
                      onAdminReplacementSwap={onAdminReplacementSwap}
                      onCancelSwap={onCancelSwap}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-xl">
      {slots.map((slot) => (
          <SlotCard
            key={slot.slotId}
            missionId={mission.id}
            slot={slot}
            personName={personName}
            isAdmin={isAdmin}
            swapTarget={swapTarget}
            swapMode={swapMode}
            mySlotIds={new Set(mySlots.map((s) => s.slotId))}
            onStartSwap={onStartSwap}
            onSwapMode={onSwapMode}
            onTake={onTake}
            onSwap={onSwap}
            onAdminSet={onAdminSet}
            onAdminReplacementSwap={onAdminReplacementSwap}
            onCancelSwap={onCancelSwap}
          />
        ))}
    </div>
  );
}

function ReplacementPicker({
  missionId,
  slotId,
  seatIndex,
  currentName,
  onDirect,
  onSwap,
}: {
  missionId: string;
  slotId: string;
  seatIndex: number;
  currentName: string;
  onDirect: (name: string) => void;
  onSwap: (targetSlotId: string, targetSeatIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"replace" | "swap">("replace");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<
    {
      type: "direct" | "swap";
      personName: string;
      label: string;
      swapSlotId?: string;
      swapSeatIndex?: number;
    }[]
  >([]);

  async function load(nextMode: "replace" | "swap") {
    setMode(nextMode);
    setLoading(true);
    setOpen(true);
    const res = await fetch(`/api/missions/${missionId}/replacements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_id: slotId,
        seat_index: seatIndex,
        remove_name: currentName,
        mode: nextMode,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setOptions(data.options || []);
    else setOptions([]);
  }

  if (!currentName) return null;

  return (
    <div className="relative">
      <button type="button" className="btn-sm" onClick={() => load("replace")}>
        מחליף
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[260px] max-w-sm card shadow-lg p-3 text-sm right-0">
          <div className="bar spread mb-2">
            <b>מחליף ל{currentName}</b>
            <button type="button" className="btn-sm" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="flex gap-1 mb-2">
            <button
              type="button"
              className={`btn-sm ${mode === "replace" ? "on" : ""}`}
              onClick={() => load("replace")}
            >
              הסר + מחליף
            </button>
            <button
              type="button"
              className={`btn-sm ${mode === "swap" ? "on" : ""}`}
              onClick={() => load("swap")}
            >
              החלפה ראש בראש
            </button>
          </div>
          {loading ? (
            <p className="hint">מחפש…</p>
          ) : options.length === 0 ? (
            <p className="hint">אין מחליף שעומד בכללים</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {options.map((o) => (
                <li key={`${o.type}-${o.personName}-${o.swapSlotId || ""}`}>
                  <button
                    type="button"
                    className="btn-sm w-full text-right"
                    onClick={() => {
                      if (o.type === "direct") onDirect(o.personName);
                      else if (o.swapSlotId != null && o.swapSeatIndex != null) {
                        onSwap(o.swapSlotId, o.swapSeatIndex);
                      }
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SlotCard({
  missionId,
  slot,
  personName,
  isAdmin,
  swapTarget,
  swapMode,
  mySlotIds,
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onAdminSet,
  onAdminReplacementSwap,
  onCancelSwap,
}: {
  missionId: string;
  slot: ReturnType<typeof flattenMissionSlots>[0];
  personName: string;
  isAdmin: boolean;
  swapTarget: { missionId: string; slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  mySlotIds: Set<string>;
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onAdminSet: (missionId: string, slotId: string, seatIndex: number, name: string) => void;
  onAdminReplacementSwap: (
    missionId: string,
    slotId: string,
    seatIndex: number,
    targetSlotId: string,
    targetSeatIndex: number,
  ) => void;
  onCancelSwap: () => void;
}) {
  const isMine = slot.assignees.includes(personName);
  const isSwapPicking =
    swapTarget &&
    swapMode === "swap" &&
    swapTarget.slotId !== slot.slotId;

  return (
    <div className={`slot-card ${isMine ? "mine" : ""}`}>
      <div className="mono text-sm font-medium">{slot.timeLabel}</div>
      {missionId && slot.positionName && (
        <div className="text-xs text-ink2">{slot.positionName}</div>
      )}
      <ul className="mt-2 space-y-1">
        {Array.from({ length: slot.seatCount }, (_, seatIndex) => {
          const name = slot.assignees[seatIndex] || "";
          const isEmpty = !name;
          const isMySeat = name === personName;

          return (
            <li key={seatIndex} className="flex flex-wrap items-center gap-2 text-sm">
              {isAdmin ? (
                <>
                  <NameCombobox
                    value={name}
                    onChange={(v) => onAdminSet(missionId, slot.slotId, seatIndex, v)}
                    placeholder="שם"
                    className="flex-1 min-w-[140px]"
                  />
                  {name && (
                    <ReplacementPicker
                      missionId={missionId}
                      slotId={slot.slotId}
                      seatIndex={seatIndex}
                      currentName={name}
                      onDirect={(n) => onAdminSet(missionId, slot.slotId, seatIndex, n)}
                      onSwap={(targetSlotId, targetSeatIndex) =>
                        onAdminReplacementSwap(
                          missionId,
                          slot.slotId,
                          seatIndex,
                          targetSlotId,
                          targetSeatIndex,
                        )
                      }
                    />
                  )}
                </>
              ) : (
                <span className={isMySeat ? "schedule-you font-semibold" : ""}>
                  {name || "— פנוי —"}
                </span>
              )}
              {!isAdmin && (isEmpty || isMySeat) && (
                <SwapButtons
                  slotId={slot.slotId}
                  seatIndex={seatIndex}
                  label={`${slot.timeLabel} · ${slot.positionName}`}
                  swapTarget={swapTarget}
                  swapMode={swapMode}
                  mySlotIds={mySlotIds}
                  hasMyOtherSlot={mySlotIds.size > 0}
                  onStartSwap={onStartSwap}
                  onSwapMode={onSwapMode}
                  onTake={onTake}
                  onSwap={onSwap}
                  onCancelSwap={onCancelSwap}
                  isSwapPicking={!!isSwapPicking}
                  canPickThis={
                    !!isSwapPicking && mySlotIds.has(slot.slotId) === false && !!name
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SwapButtons({
  slotId,
  seatIndex,
  label,
  swapTarget,
  swapMode,
  mySlotIds,
  hasMyOtherSlot,
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onCancelSwap,
  isSwapPicking,
  canPickThis,
}: {
  slotId: string;
  seatIndex: number;
  label: string;
  swapTarget: { slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  mySlotIds: Set<string>;
  hasMyOtherSlot: boolean;
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onCancelSwap: () => void;
  isSwapPicking: boolean;
  canPickThis: boolean;
}) {
  if (swapTarget?.slotId === slotId && swapTarget.seatIndex === seatIndex) {
    return (
      <div className="flex gap-1 flex-wrap">
        <button type="button" className="btn-sm" onClick={() => onTake(slotId, seatIndex)}>
          קח/י משמרת
        </button>
        {hasMyOtherSlot && (
          <button
            type="button"
            className="btn-sm"
            onClick={() => onSwapMode("swap")}
          >
            החלפה ראש בראש
          </button>
        )}
        <button type="button" className="btn-sm" onClick={onCancelSwap}>
          ביטול
        </button>
      </div>
    );
  }

  if (swapMode === "swap" && swapTarget) {
    if (canPickThis) {
      return (
        <button
          type="button"
          className="btn-pri btn-sm"
          onClick={() => onSwap(slotId, seatIndex)}
        >
          החלף עם {label}
        </button>
      );
    }
    return null;
  }

  return (
    <button
      type="button"
      className="btn-sm"
      onClick={() => onStartSwap(slotId, seatIndex, label)}
    >
      החלפה
    </button>
  );
}
