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
  const [swapTarget, setSwapTarget] = useState<{
    missionId: string;
    slotId: string;
    seatIndex: number;
    label: string;
  } | null>(null);
  const [swapMode, setSwapMode] = useState<SwapMode>(null);
  const [msg, setMsg] = useState("");

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
    const res = await fetch("/api/missions?published=1");
    if (res.ok) {
      const data = await res.json();
      setMissions(data);
      const nextDates = [...new Set(data.map((m: MissionDay) => m.mission_date))].sort();
      if (activeDate && !nextDates.includes(activeDate) && nextDates[0]) {
        setActiveDate(String(nextDates[0]));
      }
    }
  }, [activeDate]);

  const loadAdminData = useCallback(async () => {
    if (!isAdminUser) return;
    const [i, p] = await Promise.all([
      fetch("/api/issues?status=pending").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/profile-requests?status=pending").then((r) =>
        r.ok ? r.json() : [],
      ),
    ]);
    setIssues(i);
    setProfileRequests(p);
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
                className={`btn-sm ${showConstraints ? "on" : ""}`}
                onClick={() => setShowConstraints((v) => !v)}
              >
                אילוצים
                {(issues.length + profileRequests.length) > 0 && (
                  <span className="mr-1">({issues.length + profileRequests.length})</span>
                )}
              </button>
              <Link href="/admin/missions" className="btn-sm">
                ניהול ימי משימה
              </Link>
            </>
          )}
        </div>
      </div>

      {msg && <p className="msg-err mb-3">{msg}</p>}

      {showConstraints && isAdminUser && (
        <ConstraintsPanel
          issues={issues}
          profileRequests={profileRequests}
          onIssue={setIssueStatus}
          onProfile={setProfileStatus}
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
  onIssue,
  onProfile,
}: {
  issues: Issue[];
  profileRequests: ProfileRequest[];
  onIssue: (id: string, s: "approved" | "rejected") => void;
  onProfile: (id: string, s: "approved" | "rejected") => void;
}) {
  return (
    <section className="card mb-6">
      <h3 className="font-display text-base mb-3">אילוצים ממתינים</h3>
      {issues.length === 0 && profileRequests.length === 0 ? (
        <p className="hint">אין אילוצים ממתינים.</p>
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
            onCancelSwap={onCancelSwap}
          />
        ))}
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
                <NameCombobox
                  value={name}
                  onChange={(v) => onAdminSet(missionId, slot.slotId, seatIndex, v)}
                  placeholder="שם"
                  className="flex-1 min-w-[140px]"
                />
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
