import { NextResponse } from "next/server";
import { consolidateGuardDayMission } from "@/lib/guard-day-bundle";
import { isAdmin } from "@/lib/auth";
import {
  defaultSchedulingForType,
  resolveMissionPositions,
  shouldRegenerateGuardStructure,
} from "@/lib/mission-templates";
import { getFairnessRules } from "@/lib/fairness";
import {
  deleteMissionDay,
  getMissionDay,
  listMissionDays,
  normalizeSchedulingRules,
  saveMissionDay,
  syncAssignmentSeats,
} from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { loadApprovedIssues } from "@/lib/issues";
import {
  canAssignKind,
  blockedByIssue,
  issueBlockMessage,
  canAssignPersonToSlot,
  canSwapReplacementAssignments,
} from "@/lib/scheduling-engine";
import { sameDayMissionsFor } from "@/lib/replacement-apply";
import {
  flattenMissionSlots,
  reconcileAssignmentsOnStructureChange,
  resolveMissionForSlot,
} from "@/lib/mission-utils";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";
import type { Person } from "@/lib/types";
import {
  isBaseWorkFlatSlot,
  withBaseWorkSlotLeader,
} from "@/lib/base-work-template";

type Params = { params: Promise<{ id: string }> };

async function peopleByNameMap(): Promise<Record<string, Person>> {
  const supabase = await createClient();
  try {
    const people = await fetchActivePeople(supabase);
    return Object.fromEntries(people.map((p) => [p.name, p]));
  } catch {
    return {};
  }
}

function slotById(mission: Awaited<ReturnType<typeof getMissionDay>>, slotId: string) {
  if (!mission) return undefined;
  return flattenMissionSlots(mission).find((s) => s.slotId === slotId);
}

function assertCanAssign(
  person: Person | undefined,
  slot: ReturnType<typeof flattenMissionSlots>[0] | undefined,
  personName: string,
  issues: Awaited<ReturnType<typeof loadApprovedIssues>>,
): string | null {
  if (!slot) return "משמרת לא נמצאה";
  if (!person) return `${personName}: לא נמצא במחזור`;
  if (!canAssignKind(person, slot.positionKind, {
    positionName: slot.positionName,
    missionType: slot.missionType,
  })) {
    if (slot.positionKind === "officer_duty") {
      return `${personName}: רק קצין תורן יכול לשמש בתפקיד זה`;
    }
    return `${personName}: לא זכאי לתפקיד זה`;
  }
  if (blockedByIssue(personName, slot, issues)) {
    return issueBlockMessage(personName, slot);
  }
  return null;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    let mission = await getMissionDay(id);
    if (!mission) {
      return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    }
    const admin = await isAdmin();
    if (
      admin &&
      mission.mission_type === "guards" &&
      mission.scheduling_rules?.linked_mission_id
    ) {
      mission = await consolidateGuardDayMission(mission);
    }
    if (mission.status !== "published" && !admin) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }
    return NextResponse.json(mission);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await getMissionDay(id);
  if (!existing) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const mission_type = body.mission_type ?? existing.mission_type;
  const starts_at = body.starts_at ?? existing.starts_at;
  const ends_at = body.ends_at ?? existing.ends_at;
  const scheduling_rules = body.scheduling_rules
    ? normalizeSchedulingRules(body.scheduling_rules)
    : existing.scheduling_rules;

  const clientPositions = body.positions ?? existing.positions;
  const regenerateStructure =
    mission_type === "guards" &&
    shouldRegenerateGuardStructure(
      existing,
      { starts_at, ends_at, scheduling_rules },
      body.regenerate_structure === true,
    );
  const positions = resolveMissionPositions({
    missionType: mission_type,
    startsAt: starts_at,
    endsAt: ends_at,
    scheduling:
      scheduling_rules ?? defaultSchedulingForType(mission_type, starts_at),
    clientPositions,
    regenerateStructure,
  });

  const rawAssignments = body.assignments ?? existing.assignments;
  const assignments =
    regenerateStructure && mission_type === "guards"
      ? reconcileAssignmentsOnStructureChange(
          existing.positions,
          positions,
          rawAssignments,
        )
      : syncAssignmentSeats(positions, rawAssignments);

  try {
    const { mission: saved } = await saveMissionDay({
      id,
      title: body.title ?? existing.title,
      mission_type,
      mission_date: body.mission_date ?? existing.mission_date,
      starts_at,
      ends_at,
      status: body.status ?? existing.status,
      positions,
      assignments,
      scheduling_rules,
      notes: body.notes ?? existing.notes,
    });
    const out =
      mission_type === "guards" && existing.scheduling_rules?.linked_mission_id
        ? await consolidateGuardDayMission(saved)
        : saved;
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await deleteMissionDay(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const authSession = await getAuthSession();
  if (!authSession) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const mission = await getMissionDay(id);
  if (!mission || (mission.status !== "published" && !(await isAdmin()))) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const { action, slot_id, seat_index, target_slot_id, target_seat_index, name } =
    body;

  const admin = await isAdmin();
  if ((action === "take" || action === "swap") && !authSession.person) {
    return NextResponse.json(
      { error: "צפייה בלבד — אין הרשאת שיבוץ" },
      { status: 403 },
    );
  }

  const personName = authSession.person?.name ?? "";
  const peopleByName = await peopleByNameMap();
  const issues = await loadApprovedIssues();
  const [allMissions, rules] = await Promise.all([
    listMissionDays(false),
    getFairnessRules(),
  ]);
  const sameDay = sameDayMissionsFor(mission, allMissions);
  const hostMission =
    resolveMissionForSlot(sameDay, mission.id, String(slot_id || "")) ?? mission;

  let updated = hostMission;

  if (action === "take") {
    const slot = slotById(hostMission, slot_id);
    const err = assertCanAssign(authSession.person ?? undefined, slot, personName, issues);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const assignees = [...(hostMission.assignments[slot_id] || [])];
    if (assignees[seat_index] && assignees[seat_index] !== personName) {
      return NextResponse.json({ error: "המשבצת תפוסה" }, { status: 400 });
    }
    assignees[seat_index] = personName;
    updated = {
      ...hostMission,
      assignments: { ...hostMission.assignments, [slot_id]: assignees },
    };
  } else if (action === "swap") {
    const swapHostMission =
      resolveMissionForSlot(sameDay, hostMission.id, String(target_slot_id || "")) ??
      hostMission;
    const srcSlot = slotById(hostMission, slot_id);
    const dstSlot = slotById(swapHostMission, target_slot_id);
    const src = [...(hostMission.assignments[slot_id] || [])];
    const dst = [...(swapHostMission.assignments[target_slot_id] || [])];
    const srcName = src[seat_index];
    const dstName = dst[target_seat_index];
    if (srcName !== personName && !admin) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    if (!dstName || !srcName) {
      return NextResponse.json({ error: "אין עם מי להחליף" }, { status: 400 });
    }
    const swapPerson = peopleByName[dstName];
    if (!srcSlot || !dstSlot || !swapPerson) {
      return NextResponse.json({ error: "משמרת או צוער לא נמצאו" }, { status: 400 });
    }
    const swapCheck = canSwapReplacementAssignments({
      missions: sameDay,
      rules,
      missionId: hostMission.id,
      slot: srcSlot,
      seatIndex: seat_index,
      removeName: srcName,
      swapMissionId: swapHostMission.id,
      swapSlot: dstSlot,
      swapSeatIndex: target_seat_index,
      swapPerson,
      issues,
      peopleByName,
    });
    if (!swapCheck.ok) {
      return NextResponse.json({ error: swapCheck.reason }, { status: 400 });
    }
    src[seat_index] = dstName;
    dst[target_seat_index] = srcName;
    if (hostMission.id === swapHostMission.id) {
      updated = {
        ...hostMission,
        assignments: {
          ...hostMission.assignments,
          [slot_id]: src,
          [target_slot_id]: dst,
        },
      };
    } else {
      const [{ mission: savedSrc }, { mission: savedDst }] = await Promise.all([
        saveMissionDay(
          {
            ...hostMission,
            assignments: { ...hostMission.assignments, [slot_id]: src },
            id: hostMission.id,
          },
          { validateAssignments: false },
        ),
        saveMissionDay(
          {
            ...swapHostMission,
            assignments: { ...swapHostMission.assignments, [target_slot_id]: dst },
            id: swapHostMission.id,
          },
          { validateAssignments: false },
        ),
      ]);
      return NextResponse.json(savedSrc);
    }
  } else if (action === "admin_set" && admin) {
    const slot = slotById(hostMission, slot_id);
    if (!slot) {
      return NextResponse.json({ error: "משמרת לא נמצאה" }, { status: 400 });
    }
    const nextName = String(name || "").trim();
    const currentName = String((hostMission.assignments[slot_id] || [])[seat_index] || "").trim();
    if (nextName) {
      const person = peopleByName[nextName];
      if (!person) {
        return NextResponse.json({ error: `${nextName}: לא נמצא במחזור` }, { status: 400 });
      }
      const check = canAssignPersonToSlot({
        missions: sameDay,
        rules,
        missionId: hostMission.id,
        slot,
        seatIndex: seat_index,
        person,
        issues,
        peopleByName,
        replaceName: currentName || null,
      });
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }
    const seats = [...(hostMission.assignments[slot_id] || [])];
    seats[seat_index] = String(name || "").trim();
    updated = {
      ...hostMission,
      assignments: { ...hostMission.assignments, [slot_id]: seats },
    };
  } else if (action === "set_base_work_leader" && admin) {
    const slot = slotById(hostMission, slot_id);
    if (!slot || !isBaseWorkFlatSlot(slot)) {
      return NextResponse.json({ error: "משמרת עב״ס לא נמצאה" }, { status: 400 });
    }
    const leaderName = String(name || "").trim();
    if (leaderName) {
      const seats = (hostMission.assignments[slot_id] || []).filter(Boolean);
      if (!seats.includes(leaderName)) {
        return NextResponse.json(
          { error: `${leaderName}: חייב/ת להיות משובצ/ת בחלון עב״ס` },
          { status: 400 },
        );
      }
    }
    updated = withBaseWorkSlotLeader(hostMission, slot_id, leaderName || null);
  } else {
    return NextResponse.json({ error: "פעולה לא תקינה" }, { status: 400 });
  }

  try {
    const { mission: saved } = await saveMissionDay(
      { ...updated, id: updated.id },
      { validateAssignments: false },
    );
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
