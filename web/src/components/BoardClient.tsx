"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AddToCalendarLink } from "@/components/AddToCalendarLink";
import {
  BurdenSummaryPanel,
  type BurdenRosterRow,
} from "@/components/BurdenSummaryPanel";
import { IssueEditor } from "@/components/IssueEditor";
import { NameCombobox } from "@/components/NameCombobox";
import {
  ISSUE_STATUS_LABELS,
  ISSUE_TYPE_LABELS,
  PERSONAL_FLAG_LABELS,
  type Issue,
  type MissionDay,
  type ProfileRequest,
  type FairnessRuleRequest,
  DEFAULT_FAIRNESS_RULES,
  type FairnessRules,
} from "@/lib/types";
import { formatFairnessRulesDiff } from "@/lib/fairness-display";
import { getGuardBaseBurden } from "@/lib/guard-burden";
import { DUTY_OFFICER_NAMES } from "@/lib/officers";
import { collectRosterWarnings } from "@/lib/scheduling-engine";
import type { ReplacementApplyOption } from "@/lib/replacement-apply";
import { calendarEventFromFlatSlot } from "@/lib/calendar-ics";
import { virtualBaseWorkMission, effectiveBoardStartMin, flattenMissionSlots, isGuardKind, isBaseWorkPosition } from "@/lib/mission-utils";
import { getBaseWorkSlotLeader, isBaseWorkFlatSlot } from "@/lib/base-work-template";
import { findCarmelASlot, inferRoomFromAssignees } from "@/lib/carmel-room-sync";
import { patrolAssigneeRole, patrolAssigneeRoleLabel } from "@/lib/patrol-day-template";
import { resolvePatrolAssigneeName } from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import {
  kitchenShiftHandoffsFromSlots,
  kitchenShiftRosterViews,
  kitchenShiftWindowKey,
  type KitchenShiftHandoff,
  type KitchenShiftRosterView,
} from "@/lib/kitchen-handoffs";
import type { Person } from "@/lib/types";

type Props = {
  personName: string;
  canAssign?: boolean;
  viewerEmail?: string;
  initialMissions: MissionDay[];
  isAdmin: boolean;
  initialPeople?: Person[];
  initialApprovedIssues?: Issue[];
};

type SwapMode = "take" | "swap" | null;

/** Skip legacy linked base_work mission when ABAS is already embedded in the guard day. */
function missionsForRosterWarnings(missions: MissionDay[]): MissionDay[] {
  const guardsWithEmbeddedAbas = missions.find(
    (m) => m.mission_type === "guards" && (m.positions || []).some(isBaseWorkPosition),
  );
  if (!guardsWithEmbeddedAbas) return missions;
  const linkedId = guardsWithEmbeddedAbas.scheduling_rules?.linked_mission_id;
  if (!linkedId) return missions;
  return missions.filter((m) => m.id !== linkedId);
}

function peopleByNameFromList(people: Person[]): Record<string, Person> {
  return Object.fromEntries(people.map((person) => [person.name, person]));
}

export function BoardClient({
  personName,
  canAssign = true,
  viewerEmail,
  initialMissions,
  isAdmin,
  initialPeople = [],
  initialApprovedIssues = [],
}: Props) {
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
  const [approvedIssues, setApprovedIssues] = useState<Issue[]>(initialApprovedIssues);
  const [peopleByName, setPeopleByName] = useState<Record<string, Person>>(() =>
    peopleByNameFromList(initialPeople),
  );
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
  const [showBurden, setShowBurden] = useState(false);
  const [burdenRoster, setBurdenRoster] = useState<BurdenRosterRow[]>([]);
  const [dutyOfficerNames, setDutyOfficerNames] = useState<string[]>([
    ...DUTY_OFFICER_NAMES,
  ]);

  const activeRosterNames = useMemo(
    () =>
      Object.values(peopleByName)
        .filter((p) => p.active !== false)
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b, "he")),
    [peopleByName],
  );

  const dormRooms = useMemo(() => {
    const rooms = new Set<string>();
    for (const person of Object.values(peopleByName)) {
      const room = person.room?.trim();
      if (room) rooms.add(room);
    }
    return [...rooms].sort((a, b) => a.localeCompare(b, "he", { numeric: true }));
  }, [peopleByName]);

  const dayMissions = useMemo(
    () => missions.filter((m) => m.mission_date === activeDate),
    [missions, activeDate],
  );

  const guardsMission = dayMissions.find((m) => m.mission_type === "guards");
  const linkedBaseWorkId = guardsMission?.scheduling_rules?.linked_mission_id;
  const visibleDayMissions = useMemo(
    () =>
      linkedBaseWorkId
        ? dayMissions.filter((m) => m.id !== linkedBaseWorkId)
        : dayMissions,
    [dayMissions, linkedBaseWorkId],
  );
  const baseMission =
    (guardsMission && virtualBaseWorkMission(guardsMission)) ||
    visibleDayMissions.find((m) => m.mission_type === "base_work") ||
    null;
  const baseWorkMissionId = baseMission?.id ?? guardsMission?.id;
  const kitchenMission = dayMissions.find((m) => m.mission_type === "kitchen");

  const rosterWarnings = useMemo(() => {
    if (!isAdminUser || !dayMissions.length) return [];
    if (Object.keys(peopleByName).length === 0) return [];
    return collectRosterWarnings({
      missions: missionsForRosterWarnings(dayMissions),
      peopleByName,
      issues: approvedIssues,
    });
  }, [isAdminUser, dayMissions, peopleByName, approvedIssues]);

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
    const [i, approved, p, f, rulesRes, peopleRes] = await Promise.all([
      fetch("/api/issues?status=pending").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/issues?status=approved").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/profile-requests?status=pending").then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/fairness/requests?status=pending").then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/fairness").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/people").then((r) => (r.ok ? r.json() : [])),
    ]);
    setIssues(i);
    if (Array.isArray(approved)) {
      setApprovedIssues(approved);
    }
    setProfileRequests(p);
    setFairnessRequests(f);
    if (rulesRes?.rules) setPublishedRules(rulesRes.rules);
    if (Array.isArray(peopleRes) && peopleRes.length > 0) {
      const people = peopleRes as Person[];
      setPeopleByName(peopleByNameFromList(people));
      const officers = people
        .filter((person) => person.is_officer)
        .map((person) => person.name);
      if (officers.length) setDutyOfficerNames(officers);
    }
  }, [isAdminUser]);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setIsAdminUser(!!d.admin))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/fairness")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.rules) setPublishedRules(data.rules);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, isAdminUser]);

  const loadBurden = useCallback(async () => {
    if (!activeDate) return;
    const res = await fetch(`/api/missions/burden?mission_date=${activeDate}`);
    if (res.ok) {
      const data = await res.json();
      setBurdenRoster(data.roster || []);
    }
  }, [activeDate]);

  useEffect(() => {
    if (showBurden) loadBurden();
  }, [showBurden, loadBurden]);

  async function patchAssignment(
    missionId: string,
    body: Record<string, unknown>,
  ) {
    setMsg("");

    if (body.action === "admin_set" && typeof body.slot_id === "string") {
      const slotId = body.slot_id;
      const seatIndex = Number(body.seat_index);
      const nextName = String(body.name ?? "").trim();
      setMissions((prev) =>
        prev.map((mission) => {
          if (mission.id !== missionId) return mission;
          const seats = [...(mission.assignments[slotId] || [])];
          if (Number.isNaN(seatIndex) || seatIndex < 0) return mission;
          seats[seatIndex] = nextName;
          return {
            ...mission,
            assignments: { ...mission.assignments, [slotId]: seats },
          };
        }),
      );
    }

    const res = await fetch(`/api/missions/${missionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      await loadMissions();
      return null;
    }
    await loadMissions();
    if (Array.isArray(data.warnings) && data.warnings.length) {
      setMsg(`נשמר · אזהרה: ${data.warnings.join(" · ")}`);
      return (data.mission ?? data) as MissionDay;
    }
    return (data.mission ?? data) as MissionDay;
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

  async function applyReplacement(
    missionId: string,
    slotId: string,
    seatIndex: number,
    removeName: string,
    option: ReplacementApplyOption,
  ): Promise<boolean> {
    setMsg("");
    const res = await fetch(`/api/missions/${missionId}/replacements/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_id: slotId,
        seat_index: seatIndex,
        remove_name: removeName,
        option,
        force: option.type === "manual",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה בשמירת החלפה");
      return false;
    }
    await loadMissions();
    if (Array.isArray(data.warnings) && data.warnings.length) {
      setMsg(`ההחלפה נשמרה · אזהרה: ${data.warnings.join(" · ")}`);
    } else {
      setMsg("ההחלפה נשמרה");
    }
    return true;
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

  async function setBaseWorkLeader(
    missionId: string,
    slotId: string,
    leaderName: string,
  ) {
    await patchAssignment(missionId, {
      action: "set_base_work_leader",
      slot_id: slotId,
      name: leaderName,
    });
  }

  async function handleSwapCarmelARoom(missionId: string, targetRoom: string) {
    if (
      !confirm(
        `להחליף את כרמל א׳ לחדר ${targetRoom} ולסנכרן את כל השיבוצים של החדר הישן ביום זה?`,
      )
    ) {
      return;
    }
    setMsg("");
    const res = await fetch(`/api/missions/${missionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "swap_carmel_a_room",
        target_room: targetRoom,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה בהחלפת חדר כרמל א׳");
      return;
    }
    await loadMissions();
    setMsg(`כרמל א׳ הוחלף לחדר ${targetRoom} — השמירות סונכרנו`);
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

  async function runAutoAssign(keepExisting: boolean) {
    if (!activeDate) return;
    const confirmed = keepExisting
      ? confirm("ליצור שיבוץ חכם ליום זה? משבצות שכבר מלאות יישארו.")
      : confirm(
          "לשבץ מחדש את כל היום מאפס?\n\n" +
            "כל השיבוצים הקיימים יימחקו ויחולקו מחדש לפי האלגוריתם המעודכן (כולל איזון עומס נפרד למטבח ולשמירה+עב״ס).",
        );
    if (!confirmed) return;

    setAutoAssigning(true);
    setMsg("");
    const res = await fetch("/api/missions/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_date: activeDate, keep_existing: keepExisting }),
    });
    const data = await res.json();
    setAutoAssigning(false);
    if (!res.ok) {
      setMsg(data.error || "שגיאה בשיבוץ");
      return;
    }
    await loadMissions();
    const status = data.status as string | undefined;
    const assignedSeats = data.assignedSeats ?? (data.results || []).reduce(
      (sum: number, r: { filled: number; skipped?: number }) => sum + r.filled + (r.skipped ?? 0),
      0,
    );
    const requiredSeats = data.requiredSeats;
    const warnings: string[] = data.warnings || [];
    const statusLine =
      status === "complete"
        ? `${keepExisting ? "שיבוץ" : "שיבוץ מחדש"} הושלם — ${assignedSeats}/${requiredSeats ?? assignedSeats} משבצות`
        : status === "infeasible"
          ? `שיבוץ לא אפשרי — ${assignedSeats}/${requiredSeats ?? "?"} משבצות בלבד`
          : `שיבוץ חלקי — ${assignedSeats}/${requiredSeats ?? "?"} משבצות`;
    if (warnings.length) {
      const preview = warnings.slice(0, 4).join(" · ");
      const more = warnings.length > 4 ? ` · …ועוד ${warnings.length - 4}` : "";
      setMsg(`${statusLine}. ${preview}${more}`);
    } else {
      setMsg(statusLine);
    }
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
    return formatFairnessRulesDiff(publishedRules, req.proposed_rules);
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
          <button
            type="button"
            className={`btn-sm ${showBurden ? "on" : ""}`}
            onClick={() => setShowBurden((v) => !v)}
          >
            עומס שיבוץ
          </button>
          {isAdminUser && (
            <>
              <button
                type="button"
                className="btn-pri btn-sm"
                disabled={autoAssigning || !activeDate}
                onClick={() => runAutoAssign(true)}
              >
                {autoAssigning ? "משבץ…" : "שיבוץ חכם ליום"}
              </button>
              <button
                type="button"
                className="btn-sm"
                disabled={autoAssigning || !activeDate}
                onClick={() => runAutoAssign(false)}
                title="מוחק שיבוצים קיימים ומחלק מחדש את כל היום"
              >
                {autoAssigning ? "משבץ…" : "שיבוץ מחדש"}
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

      {!canAssign && (
        <div className="mb-4 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--color-line2)", background: "var(--color-accent-bg)" }}>
          <b>צפייה בלבד</b>
          {viewerEmail && (
            <span className="hint mr-2">
              {" "}
              ({viewerEmail})
            </span>
          )}
          <span className="hint block text-xs mt-1">
            אפשר לצפות בשיבוצים — לא ניתן לקחת משמרות או להחליף.
          </span>
        </div>
      )}

      {isAdminUser && rosterWarnings.length > 0 && (
        <section className="roster-warnings" role="alert">
          <h3>אזהרות שיבוץ — {formatDate(activeDate)}</h3>
          <ul>
            {rosterWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {showConstraints && isAdminUser && (
        <ConstraintsPanel
          issues={issues}
          profileRequests={profileRequests}
          fairnessRequests={fairnessRequests}
          onIssue={setIssueStatus}
          onReload={loadAdminData}
          onProfile={setProfileStatus}
          onFairness={setFairnessStatus}
          formatFairnessDiff={formatFairnessDiff}
        />
      )}

      {showBurden && (
        <BurdenSummaryPanel
          roster={burdenRoster}
          onRefresh={loadBurden}
          emptyMessage="אין נתוני שיבוץ ליום זה."
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
              canAssign={canAssign}
              isAdmin={isAdminUser}
              fairnessRules={publishedRules}
              dutyOfficerNames={dutyOfficerNames}
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
              onApplyReplacement={applyReplacement}
              onSwapCarmelRoom={handleSwapCarmelARoom}
              dormRooms={dormRooms}
              peopleByName={peopleByName}
              onCancelSwap={() => {
                setSwapTarget(null);
                setSwapMode(null);
              }}
            />
          )}
        </PanelSection>

        <PanelSection title="עבודות בסיס" mission={baseMission ?? undefined} empty="אין עב״ס ביום זה">
          {baseMission && baseWorkMissionId && (
            <MissionPanel
              mission={baseMission}
              personName={personName}
              canAssign={canAssign}
              isAdmin={isAdminUser}
              fairnessRules={publishedRules}
              mySlots={mySlots}
              swapTarget={swapTarget}
              swapMode={swapMode}
              onStartSwap={(slotId, seatIndex, label) => {
                setSwapTarget({
                  missionId: baseWorkMissionId,
                  slotId,
                  seatIndex,
                  label,
                });
                setSwapMode(null);
              }}
              onSwapMode={setSwapMode}
              onTake={(slotId, seatIndex) =>
                handleTake(baseWorkMissionId, slotId, seatIndex)
              }
              onSwap={(toSlotId, toSeatIndex) => {
                if (!swapTarget) return;
                handleSwap(
                  baseWorkMissionId,
                  { slotId: swapTarget.slotId, seatIndex: swapTarget.seatIndex },
                  { slotId: toSlotId, seatIndex: toSeatIndex },
                );
              }}
              onAdminSet={adminSetName}
              onSetBaseWorkLeader={setBaseWorkLeader}
              onApplyReplacement={applyReplacement}
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
              canAssign={canAssign}
              isAdmin={isAdminUser}
              fairnessRules={publishedRules}
              rosterNames={activeRosterNames}
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
              onApplyReplacement={applyReplacement}
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
  onReload,
  onProfile,
  onFairness,
  formatFairnessDiff,
}: {
  issues: Issue[];
  profileRequests: ProfileRequest[];
  fairnessRequests: FairnessRuleRequest[];
  onIssue: (id: string, s: "approved" | "rejected") => void;
  onReload: () => void;
  onProfile: (id: string, s: "approved" | "rejected") => void;
  onFairness: (id: string, s: "approved" | "rejected") => void;
  formatFairnessDiff: (req: FairnessRuleRequest) => string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

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
              {editingId === iss.id ? (
                <IssueEditor
                  issue={iss}
                  onSaved={() => {
                    setEditingId(null);
                    onReload();
                  }}
                  onCancel={() => setEditingId(null)}
                  onDeleted={() => {
                    setEditingId(null);
                    onReload();
                  }}
                />
              ) : (
                <>
                  <div>
                    <b>{iss.person_name}</b>
                    <span className="mono mx-2">
                      {iss.constraint_date} · {iss.start_time}–{iss.end_time}
                    </span>
                    <span>{ISSUE_TYPE_LABELS[iss.issue_type]}</span>
                    {iss.note && <span className="text-ink2 mr-2"> — {iss.note}</span>}
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button type="button" className="btn-pri btn-sm" onClick={() => onIssue(iss.id, "approved")}>
                      אשר
                    </button>
                    <button type="button" className="btn-sm" onClick={() => onIssue(iss.id, "rejected")}>
                      דחה
                    </button>
                    <button type="button" className="btn-sm" onClick={() => setEditingId(iss.id)}>
                      ערוך
                    </button>
                  </div>
                </>
              )}
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

function missionBoardStartMin(mission: MissionDay): number {
  return effectiveBoardStartMin(mission);
}

const TIMELINE_CYCLE_MIN = 1440;
const TIMELINE_HEIGHT_PX = 960;
const TIMELINE_TICK_STEP_MIN = 120;

function formatWallTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function cyclicToPx(cyclicMin: number): number {
  return (cyclicMin / TIMELINE_CYCLE_MIN) * TIMELINE_HEIGHT_PX;
}

function durationToPx(durationMin: number): number {
  return Math.max((durationMin / TIMELINE_CYCLE_MIN) * TIMELINE_HEIGHT_PX, 32);
}

function CarmelARoomSwap({
  missionId,
  currentRoom,
  rooms,
  onSwap,
}: {
  missionId: string;
  currentRoom: string | null;
  rooms: string[];
  onSwap: (missionId: string, room: string) => Promise<void>;
}) {
  const [targetRoom, setTargetRoom] = useState("");
  const [busy, setBusy] = useState(false);

  const options = rooms.filter((room) => room !== currentRoom);

  return (
    <div className="carmel-room-swap mt-1 space-y-1 rounded border border-line2 bg-accent-bg/40 p-2 text-xs">
      <div className="text-ink2">
        {currentRoom ? (
          <>חדר נוכחי: <b>{currentRoom}</b></>
        ) : (
          <>כרמל א׳ — לא משובץ מחדר</>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select
          className="min-w-[5rem] flex-1 rounded border px-2 py-1 text-sm"
          value={targetRoom}
          onChange={(e) => setTargetRoom(e.target.value)}
          disabled={busy || options.length === 0}
        >
          <option value="">בחר חדר…</option>
          {options.map((room) => (
            <option key={room} value={room}>
              חדר {room}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-sm btn-pri"
          disabled={busy || !targetRoom}
          onClick={async () => {
            setBusy(true);
            await onSwap(missionId, targetRoom);
            setBusy(false);
            setTargetRoom("");
          }}
        >
          {busy ? "מסנכרן…" : "החלף וסנכרן"}
        </button>
      </div>
      <p className="hint text-[10px] leading-snug">
        מחליף ראש-בראש את כל השיבוצים בין החדר הנוכחי לחדר שנבחר (כרמל א׳ + שאר היום).
      </p>
    </div>
  );
}

function GuardTimeline({
  mission,
  slots,
  boardStartMin,
  personName,
  canAssign,
  isAdmin,
  fairnessRules,
  dutyOfficerNames,
  swapTarget,
  swapMode,
  mySlotIds,
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onAdminSet,
  onApplyReplacement,
  onCancelSwap,
  onSwapCarmelRoom,
  dormRooms = [],
  peopleByName = {},
}: {
  mission: MissionDay;
  slots: FlatSlot[];
  boardStartMin: number;
  personName: string;
  canAssign: boolean;
  isAdmin: boolean;
  fairnessRules: FairnessRules;
  dutyOfficerNames?: string[];
  swapTarget: { missionId: string; slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  mySlotIds: Set<string>;
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onAdminSet: (missionId: string, slotId: string, seatIndex: number, name: string) => void;
  onApplyReplacement: (
    missionId: string,
    slotId: string,
    seatIndex: number,
    removeName: string,
    option: ReplacementApplyOption,
  ) => Promise<boolean>;
  onCancelSwap: () => void;
  onSwapCarmelRoom?: (missionId: string, room: string) => Promise<void>;
  dormRooms?: string[];
  peopleByName?: Record<string, Person>;
}) {
  const carmelASlot = findCarmelASlot(mission);
  const carmelRoom = carmelASlot
    ? inferRoomFromAssignees(
        (mission.assignments[carmelASlot.slotId] || []).filter(Boolean),
        peopleByName,
      )
    : null;
  const positions = mission.positions || [];
  const hourStepPx = TIMELINE_HEIGHT_PX / 24;
  const ticks = Array.from(
    { length: TIMELINE_CYCLE_MIN / TIMELINE_TICK_STEP_MIN + 1 },
    (_, i) => i * TIMELINE_TICK_STEP_MIN,
  );

  const timelineStyle = {
    ["--timeline-height" as string]: `${TIMELINE_HEIGHT_PX}px`,
    ["--timeline-hour-step" as string]: `${hourStepPx}px`,
  };

  return (
    <div className="guard-timeline-wrap">
      <div className="guard-timeline" style={timelineStyle}>
        <div className="guard-timeline-axis" aria-hidden>
          {ticks.map((cyclicMin) => (
            <div
              key={cyclicMin}
              className="guard-timeline-tick"
              style={{ top: `${cyclicToPx(cyclicMin)}px` }}
            >
              {formatWallTime((boardStartMin + cyclicMin) % TIMELINE_CYCLE_MIN)}
            </div>
          ))}
        </div>
        <div className="guard-timeline-cols">
          {positions.map((pos) => {
            const posSlots = slots.filter((s) => s.positionId === pos.id);
            return (
              <div key={pos.id} className="guard-timeline-col">
                <div className="guard-timeline-col-header">
                  <div>{pos.name}</div>
                  {pos.kind === "standby_carmel_a" && isAdmin && onSwapCarmelRoom && (
                    <CarmelARoomSwap
                      missionId={mission.id}
                      currentRoom={carmelRoom}
                      rooms={dormRooms}
                      onSwap={onSwapCarmelRoom}
                    />
                  )}
                </div>
                <div className="guard-timeline-col-body">
                  {posSlots.map((slot) => (
                    <div
                      key={slot.slotId}
                      className="guard-timeline-slot"
                      style={{
                        top: `${cyclicToPx(slot.cyclicStart)}px`,
                        height: `${durationToPx(slot.durationMinutes)}px`,
                      }}
                    >
                      <SlotCard
                        mission={mission}
                        missionId={mission.id}
                        slot={slot}
                        personName={personName}
                        canAssign={canAssign}
                        isAdmin={isAdmin}
                        fairnessRules={fairnessRules}
                        dutyOfficerNames={dutyOfficerNames}
                        swapTarget={swapTarget}
                        swapMode={swapMode}
                        mySlotIds={mySlotIds}
                        variant="timeline"
                        onStartSwap={onStartSwap}
                        onSwapMode={onSwapMode}
                        onTake={onTake}
                        onSwap={onSwap}
                        onAdminSet={onAdminSet}
                        onApplyReplacement={onApplyReplacement}
                        onCancelSwap={onCancelSwap}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MissionPanel({
  mission,
  personName,
  canAssign,
  isAdmin,
  fairnessRules,
  dutyOfficerNames,
  rosterNames = [],
  mySlots,
  swapTarget,
  swapMode,
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onAdminSet,
  onSetBaseWorkLeader,
  onApplyReplacement,
  onCancelSwap,
  onSwapCarmelRoom,
  dormRooms,
  peopleByName,
}: {
  mission: MissionDay;
  personName: string;
  canAssign: boolean;
  isAdmin: boolean;
  fairnessRules: FairnessRules;
  dutyOfficerNames?: string[];
  rosterNames?: string[];
  mySlots: ReturnType<typeof flattenMissionSlots>;
  swapTarget: { missionId: string; slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onAdminSet: (missionId: string, slotId: string, seatIndex: number, name: string) => void;
  onSetBaseWorkLeader?: (missionId: string, slotId: string, leaderName: string) => void;
  onApplyReplacement: (
    missionId: string,
    slotId: string,
    seatIndex: number,
    removeName: string,
    option: ReplacementApplyOption,
  ) => Promise<boolean>;
  onCancelSwap: () => void;
  onSwapCarmelRoom?: (missionId: string, room: string) => Promise<void>;
  dormRooms?: string[];
  peopleByName?: Record<string, Person>;
}) {
  const boardStartMin = missionBoardStartMin(mission);
  const slots = flattenMissionSlots(mission, boardStartMin);

  if (mission.mission_type === "kitchen") {
    const handoffs = kitchenShiftHandoffsFromSlots(slots);
    const rosterViews = kitchenShiftRosterViews(slots, rosterNames);
    const viewsByWindow = new Map(rosterViews.map((v) => [v.windowKey, v]));
    const firstSlotIndexByWindow = new Map<string, number>();
    slots.forEach((slot, i) => {
      if (slot.kitchenShiftIndex == null) return;
      const key = kitchenShiftWindowKey(slot);
      if (!firstSlotIndexByWindow.has(key)) firstSlotIndexByWindow.set(key, i);
    });

    return (
      <div className="space-y-3 max-w-xl">
        {slots.map((slot, index) => {
          const windowKey = kitchenShiftWindowKey(slot);
          const rosterView = viewsByWindow.get(windowKey);
          const showAbsent =
            slot.kitchenShiftIndex != null &&
            rosterView != null &&
            firstSlotIndexByWindow.get(windowKey) === index;

          return (
          <Fragment key={slot.slotId}>
            <SlotCard
              mission={mission}
              missionId={mission.id}
              slot={slot}
              personName={personName}
              canAssign={canAssign}
              isAdmin={isAdmin}
              fairnessRules={fairnessRules}
              swapTarget={swapTarget}
              swapMode={swapMode}
              mySlotIds={new Set(mySlots.map((s) => s.slotId))}
              onStartSwap={onStartSwap}
              onSwapMode={onSwapMode}
              onTake={onTake}
              onSwap={onSwap}
              onAdminSet={onAdminSet}
              onApplyReplacement={onApplyReplacement}
              onCancelSwap={onCancelSwap}
            />
            {showAbsent && (
              <KitchenShiftAbsentBar view={rosterView} personName={personName} />
            )}
            {index < handoffs.length && (
              <KitchenHandoffBar handoff={handoffs[index]} personName={personName} />
            )}
          </Fragment>
          );
        })}
      </div>
    );
  }

  if (mission.mission_type === "guards") {
    return (
      <GuardTimeline
        mission={mission}
        slots={slots}
        boardStartMin={boardStartMin}
        personName={personName}
        canAssign={canAssign}
        isAdmin={isAdmin}
        fairnessRules={fairnessRules}
        dutyOfficerNames={dutyOfficerNames}
        swapTarget={swapTarget}
        swapMode={swapMode}
        mySlotIds={new Set(mySlots.map((s) => s.slotId))}
        onStartSwap={onStartSwap}
        onSwapMode={onSwapMode}
        onTake={onTake}
        onSwap={onSwap}
        onAdminSet={onAdminSet}
        onApplyReplacement={onApplyReplacement}
        onCancelSwap={onCancelSwap}
        onSwapCarmelRoom={onSwapCarmelRoom}
        dormRooms={dormRooms}
        peopleByName={peopleByName}
      />
    );
  }

  return (
    <div className="space-y-3 max-w-xl">
      {slots.map((slot) => (
          <SlotCard
            key={slot.slotId}
            mission={mission}
            missionId={mission.id}
            slot={slot}
            personName={personName}
            canAssign={canAssign}
            isAdmin={isAdmin}
            fairnessRules={fairnessRules}
            swapTarget={swapTarget}
            swapMode={swapMode}
            mySlotIds={new Set(mySlots.map((s) => s.slotId))}
            onStartSwap={onStartSwap}
            onSwapMode={onSwapMode}
            onTake={onTake}
            onSwap={onSwap}
            onAdminSet={onAdminSet}
            onSetBaseWorkLeader={onSetBaseWorkLeader}
            onApplyReplacement={onApplyReplacement}
            onCancelSwap={onCancelSwap}
          />
        ))}
    </div>
  );
}

function KitchenShiftAbsentBar({
  view,
  personName,
}: {
  view: KitchenShiftRosterView;
  personName: string;
}) {
  const { absentNames, assignedCount, rosterSize, timeLabel } = view;

  function nameChip(name: string) {
    const mine = name === personName;
    return (
      <span
        key={name}
        className={`inline-block rounded px-1.5 py-0.5 text-xs bg-slate-50 text-slate-800 ${
          mine ? "font-semibold ring-1 ring-[var(--color-accent)]" : ""
        }`}
      >
        {name}
      </span>
    );
  }

  return (
    <div
      className="rounded border px-3 py-2 text-sm"
      style={{ borderColor: "var(--color-line2)", background: "var(--color-bg)" }}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium">בחוץ · {timeLabel}</span>
        <span className="hint text-xs">
          {absentNames.length} מתוך {rosterSize} צוערים ({assignedCount} במשמרת)
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {absentNames.length > 0 ? (
          absentNames.map((name) => nameChip(name))
        ) : (
          <span className="hint text-xs">כולם משובצים</span>
        )}
      </div>
    </div>
  );
}

function KitchenHandoffBar({
  handoff,
  personName,
}: {
  handoff: KitchenShiftHandoff;
  personName: string;
}) {
  const { boundaryTime, leaving, entering, stayingCount, fromAssignedCount, toAssignedCount, fromSeatCapacity, toSeatCapacity } = handoff;
  const noChange = leaving.length === 0 && entering.length === 0;

  function nameChip(name: string, kind: "leave" | "enter") {
    const mine = name === personName;
    return (
      <span
        key={name}
        className={`inline-block rounded px-1.5 py-0.5 text-xs ${
          kind === "leave" ? "bg-red-50 text-red-900" : "bg-green-50 text-green-900"
        } ${mine ? "font-semibold ring-1 ring-[var(--color-accent)]" : ""}`}
      >
        {name}
      </span>
    );
  }

  return (
    <div
      className="rounded border border-dashed px-3 py-2 text-sm"
      style={{ borderColor: "var(--color-line2)", background: "var(--color-accent-bg)" }}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium">חילוף {boundaryTime.slice(0, 5)}</span>
        <span className="hint text-xs">
          {handoff.fromTimeLabel} ({fromAssignedCount}/{fromSeatCapacity}) → {handoff.toTimeLabel} ({toAssignedCount}/{toSeatCapacity})
        </span>
      </div>
      {!noChange && (
        <p className="hint text-xs mb-1.5">
          {stayingCount} נשארים · {leaving.length} יוצאים · {entering.length} נכנסים
          {fromAssignedCount < fromSeatCapacity && (
            <span> · חסרים {fromSeatCapacity - fromAssignedCount} במשמרת הקודמת</span>
          )}
          {toAssignedCount < toSeatCapacity && (
            <span> · חסרים {toSeatCapacity - toAssignedCount} במשמרת הבאה</span>
          )}
        </p>
      )}
      {noChange ? (
        <p className="hint text-xs">אין שינוי בצוות ({stayingCount} נשארים)</p>
      ) : (
        <div className="space-y-1.5">
          <div>
            <span className="hint text-xs">יוצאים ({leaving.length})</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {leaving.length > 0 ? (
                leaving.map((name) => nameChip(name, "leave"))
              ) : (
                <span className="hint text-xs">—</span>
              )}
            </div>
          </div>
          <div>
            <span className="hint text-xs">נכנסים ({entering.length})</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {entering.length > 0 ? (
                entering.map((name) => nameChip(name, "enter"))
              ) : (
                <span className="hint text-xs">—</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReplacementPicker({
  missionId,
  slotId,
  seatIndex,
  currentName,
  isKitchenSlot,
  onApply,
}: {
  missionId: string;
  slotId: string;
  seatIndex: number;
  currentName: string;
  isKitchenSlot?: boolean;
  onApply: (option: ReplacementApplyOption) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"replace" | "swap" | "manual">("replace");
  const [manualName, setManualName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<
    {
      type: "direct" | "swap";
      personName: string;
      label: string;
      swapMissionId?: string;
      swapSlotId?: string;
      swapSeatIndex?: number;
    }[]
  >([]);

  async function load(nextMode: "replace" | "swap") {
    setMode(nextMode);
    setLoading(true);
    setOpen(true);
    setManualName("");
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
            <button
              type="button"
              className={`btn-sm ${mode === "manual" ? "on" : ""}`}
              onClick={() => {
                setMode("manual");
                setOpen(true);
                setOptions([]);
                setManualName("");
              }}
            >
              בחר מהרשימה
            </button>
          </div>
          {isKitchenSlot && mode !== "manual" && (
            <p className="hint text-xs mb-2">במטבch מותרות משמרות רצופות — מנוחה יומית לא חוסמת.</p>
          )}
          {mode === "manual" ? (
            <div className="space-y-2">
              <p className="hint text-xs">
                שיבוץ ידני — מתבצע גם אם נשברים כללים; משמרות אחרות של אותו אדם נשארות, תוצג אזהרה.
              </p>
              <NameCombobox
                value={manualName}
                onChange={setManualName}
                placeholder="שם מהרשימה…"
                className="w-full"
              />
              <button
                type="button"
                className="btn-pri btn-sm w-full"
                disabled={saving || !manualName.trim() || manualName.trim() === currentName}
                onClick={async () => {
                  setSaving(true);
                  const ok = await onApply({
                    type: "manual",
                    personName: manualName.trim(),
                  });
                  setSaving(false);
                  if (ok) setOpen(false);
                }}
              >
                {saving ? "שומר…" : "החלף"}
              </button>
            </div>
          ) : loading ? (
            <p className="hint">מחפש…</p>
          ) : options.length === 0 ? (
            <p className="hint">אין מחליף שעומד בכללים</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {options.map((o) => (
                <li key={`${o.type}-${o.personName}-${o.swapSlotId || ""}`}>
                  <button
                    type="button"
                    className="btn-sm w-full text-right"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      let ok = false;
                      if (o.type === "direct") {
                        ok = await onApply({ type: "direct", personName: o.personName });
                      } else if (
                        o.swapMissionId &&
                        o.swapSlotId != null &&
                        o.swapSeatIndex != null
                      ) {
                        ok = await onApply({
                          type: "swap",
                          swapMissionId: o.swapMissionId,
                          swapSlotId: o.swapSlotId,
                          swapSeatIndex: o.swapSeatIndex,
                        });
                      }
                      setSaving(false);
                      if (ok) setOpen(false);
                    }}
                  >
                    {saving ? "שומר…" : o.label}
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
  mission,
  missionId,
  slot,
  personName,
  canAssign,
  isAdmin,
  fairnessRules,
  dutyOfficerNames,
  swapTarget,
  swapMode,
  mySlotIds,
  variant = "stack",
  onStartSwap,
  onSwapMode,
  onTake,
  onSwap,
  onAdminSet,
  onSetBaseWorkLeader,
  onApplyReplacement,
  onCancelSwap,
}: {
  mission: MissionDay;
  missionId: string;
  slot: FlatSlot;
  personName: string;
  canAssign: boolean;
  isAdmin: boolean;
  fairnessRules: FairnessRules;
  dutyOfficerNames?: string[];
  swapTarget: { missionId: string; slotId: string; seatIndex: number; label: string } | null;
  swapMode: SwapMode;
  mySlotIds: Set<string>;
  variant?: "stack" | "timeline";
  onStartSwap: (slotId: string, seatIndex: number, label: string) => void;
  onSwapMode: (m: SwapMode) => void;
  onTake: (slotId: string, seatIndex: number) => void;
  onSwap: (slotId: string, seatIndex: number) => void;
  onAdminSet: (missionId: string, slotId: string, seatIndex: number, name: string) => void;
  onSetBaseWorkLeader?: (missionId: string, slotId: string, leaderName: string) => void;
  onApplyReplacement: (
    missionId: string,
    slotId: string,
    seatIndex: number,
    removeName: string,
    option: ReplacementApplyOption,
  ) => Promise<boolean>;
  onCancelSwap: () => void;
}) {
  const isMine = canAssign && slot.assignees.includes(personName);
  const calendarEvent = isMine ? calendarEventFromFlatSlot(mission, slot) : null;
  const isSwapPicking =
    swapTarget &&
    swapMode === "swap" &&
    swapTarget.slotId !== slot.slotId;
  const isBaseWork = isBaseWorkFlatSlot(slot);
  const slotLeaderName = isBaseWork ? getBaseWorkSlotLeader(mission, slot.slotId) : null;

  const assigneeList = (
    <ul className={variant === "timeline" ? "space-y-0.5" : "mt-2 space-y-1"}>
      {Array.from({ length: slot.seatCount }, (_, seatIndex) => {
        const name = slot.assignees[seatIndex] || "";
        const isEmpty = !name;
        const isMySeat = name === personName;
        const isLeader = Boolean(name && slotLeaderName === name);

        return (
          <li key={seatIndex} className="flex flex-wrap items-center gap-1 text-sm">
            {isAdmin ? (
              <>
                <NameCombobox
                  value={name}
                  onChange={(v) => onAdminSet(missionId, slot.slotId, seatIndex, v)}
                  placeholder={
                    slot.positionKind === "officer_duty"
                      ? "קצין תורן…"
                      : slot.positionKind === "patrol"
                        ? "מבצע…"
                        : "שם"
                  }
                  allowedNames={
                    slot.positionKind === "officer_duty" ||
                    (slot.positionKind === "patrol" &&
                      patrolAssigneeRole(slot.startTime, slot.endTime) === "duty_officer")
                      ? dutyOfficerNames
                      : undefined
                  }
                  className="flex-1 min-w-[100px]"
                />
                {name && isBaseWork && onSetBaseWorkLeader && !isLeader && (
                  <button
                    type="button"
                    className="btn-sm"
                    title="סמן כאחראי/ת קבוצת עב״ס"
                    onClick={() => onSetBaseWorkLeader(missionId, slot.slotId, name)}
                  >
                    ☆ אחראי/ת
                  </button>
                )}
                {name && (
                  <ReplacementPicker
                    missionId={missionId}
                    slotId={slot.slotId}
                    seatIndex={seatIndex}
                    currentName={name}
                    isKitchenSlot={
                      slot.missionType === "kitchen" && slot.positionKind === "kitchen"
                    }
                    onApply={(option) =>
                      onApplyReplacement(missionId, slot.slotId, seatIndex, name, option)
                    }
                  />
                )}
              </>
            ) : (
              <span className={isMySeat ? "schedule-you font-semibold" : ""}>
                {name || "— פנוי —"}
                {isLeader && (
                  <span className="abas-leader-badge mr-1">★ אחראי/ת קבוצה</span>
                )}
              </span>
            )}
            {!isAdmin && canAssign && (isEmpty || isMySeat) && (
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
  );

  if (variant === "timeline") {
    return (
      <div className={`slot-card ${isMine ? "mine" : ""}`}>
        <div className="slot-card-time">{slot.startTime}</div>
        <div className="slot-card-body">
          {isGuardKind(slot.positionKind) && (
            <div className="text-[10px] text-ink3 mb-0.5" title={guardSlotBurdenTitle(slot, fairnessRules)}>
              {guardSlotBurdenLabel(slot, fairnessRules)}
            </div>
          )}
          <PatrolAssigneeHint mission={mission} slot={slot} compact />
          {assigneeList}
          {calendarEvent && (
            <div className="mt-1">
              <AddToCalendarLink event={calendarEvent} className="btn-sm" />
            </div>
          )}
        </div>
        <div className="slot-card-time slot-card-time-end">{slot.endTime}</div>
      </div>
    );
  }

  return (
    <div className={`slot-card ${isMine ? "mine" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-sm font-medium">{slot.timeLabel}</div>
        {calendarEvent && <AddToCalendarLink event={calendarEvent} className="btn-sm" />}
      </div>
      {isGuardKind(slot.positionKind) && (
        <div className="text-xs text-ink3 mt-0.5" title={guardSlotBurdenTitle(slot, fairnessRules)}>
          {guardSlotBurdenLabel(slot, fairnessRules)}
        </div>
      )}
      {missionId && slot.positionName && (
        <div className="text-xs text-ink2">{slot.positionName}</div>
      )}
      {slot.slotLabel && (
        <div className="text-xs text-ink2">{slot.slotLabel}</div>
      )}
      <PatrolAssigneeHint mission={mission} slot={slot} />
      {isBaseWork && slotLeaderName && (
        <div className="text-xs text-ink2 mt-0.5">
          אחראי/ת קבוצה:{" "}
          <span className="abas-leader-badge">{slotLeaderName}</span>
        </div>
      )}
      {assigneeList}
    </div>
  );
}

function PatrolAssigneeHint({
  mission,
  slot,
  compact = false,
}: {
  mission: MissionDay;
  slot: FlatSlot;
  compact?: boolean;
}) {
  if (slot.positionKind !== "patrol") return null;
  const role = patrolAssigneeRole(slot.startTime, slot.endTime);
  if (!role) return null;
  const name = resolvePatrolAssigneeName(mission, slot);
  return (
    <div className={`${compact ? "text-[10px]" : "text-xs"} text-ink2 ${compact ? "mb-0.5" : "mt-0.5"}`}>
      מזומן: <span className="font-medium">{patrolAssigneeRoleLabel(role)}</span>
      {name ? (
        <>
          {" "}
          — <span className="font-semibold text-ink">{name}</span>
        </>
      ) : null}
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

function guardSlotBurdenLabel(
  slot: ReturnType<typeof flattenMissionSlots>[0],
  rules: FairnessRules,
): string {
  const solo = slot.seatCount <= 1;
  const base = getGuardBaseBurden(slot.startTime, slot.endTime, slot.seatCount, rules);
  return `עומס בסיס: ${base} (${solo ? "סולו" : "זוג"})`;
}

function guardSlotBurdenTitle(
  slot: ReturnType<typeof flattenMissionSlots>[0],
  rules: FairnessRules,
): string {
  const solo = slot.seatCount <= 1;
  const base = getGuardBaseBurden(slot.startTime, slot.endTime, slot.seatCount, rules);
  return `${slot.timeLabel} — ${solo ? "סולו" : "זוג"}\nעומס בסיס: ${base}\n(עונש מנוחה מחושב לפי משימות קודמות/הבאות)`;
}
