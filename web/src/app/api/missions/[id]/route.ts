import { NextResponse } from "next/server";
import { consolidateGuardDayMission } from "@/lib/guard-day-bundle";
import { isAdmin } from "@/lib/auth";
import {
  defaultSchedulingForType,
  resolveMissionPositions,
} from "@/lib/mission-templates";
import {
  deleteMissionDay,
  getMissionDay,
  normalizeSchedulingRules,
  saveMissionDay,
  syncAssignmentSeats,
} from "@/lib/missions";
import { formatCalendarInviteMessage } from "@/lib/calendar-invites";
import { fetchActivePeople } from "@/lib/people";
import { loadApprovedIssues } from "@/lib/issues";
import { canAssignKind, blockedByIssue, issueBlockMessage } from "@/lib/scheduling-engine";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { createClient } from "@/lib/supabase/server";
import { getSessionPerson } from "@/lib/session";
import type { Person } from "@/lib/types";

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
  const regenerateStructure = body.regenerate_structure === true;
  const positions = resolveMissionPositions({
    missionType: mission_type,
    startsAt: starts_at,
    endsAt: ends_at,
    scheduling:
      scheduling_rules ?? defaultSchedulingForType(mission_type, starts_at),
    clientPositions,
    regenerateStructure,
  });

  const assignments = syncAssignmentSeats(
    positions,
    body.assignments ?? existing.assignments,
  );

  try {
    const { mission: saved, calendarInvites } = await saveMissionDay({
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
      mission_type === "guards"
        ? await consolidateGuardDayMission(saved)
        : saved;
    const inviteMsg = calendarInvites
      ? formatCalendarInviteMessage(calendarInvites)
      : null;
    return NextResponse.json({
      ...out,
      calendar_invites: calendarInvites,
      calendar_invite_message: inviteMsg,
    });
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
  const session = await getSessionPerson();
  if (!session) {
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
  const personName = session.person.name;
  const peopleByName = await peopleByNameMap();
  const issues = await loadApprovedIssues();

  let updated = mission;

  if (action === "take") {
    const slot = slotById(mission, slot_id);
    const err = assertCanAssign(session.person, slot, personName, issues);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const assignees = [...(mission.assignments[slot_id] || [])];
    if (assignees[seat_index] && assignees[seat_index] !== personName) {
      return NextResponse.json({ error: "המשבצת תפוסה" }, { status: 400 });
    }
    assignees[seat_index] = personName;
    updated = {
      ...mission,
      assignments: { ...mission.assignments, [slot_id]: assignees },
    };
  } else if (action === "swap") {
    const srcSlot = slotById(mission, slot_id);
    const dstSlot = slotById(mission, target_slot_id);
    const src = [...(mission.assignments[slot_id] || [])];
    const dst = [...(mission.assignments[target_slot_id] || [])];
    const srcName = src[seat_index];
    const dstName = dst[target_seat_index];
    if (srcName !== personName && !admin) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    if (!dstName) {
      return NextResponse.json({ error: "אין עם מי להחליף" }, { status: 400 });
    }
    const srcErr = assertCanAssign(peopleByName[dstName], srcSlot, dstName, issues);
    if (srcErr) {
      return NextResponse.json({ error: srcErr }, { status: 400 });
    }
    const dstErr = assertCanAssign(peopleByName[srcName], dstSlot, srcName, issues);
    if (dstErr) {
      return NextResponse.json({ error: dstErr }, { status: 400 });
    }
    src[seat_index] = dstName;
    dst[target_seat_index] = srcName;
    updated = {
      ...mission,
      assignments: {
        ...mission.assignments,
        [slot_id]: src,
        [target_slot_id]: dst,
      },
    };
  } else if (action === "admin_set" && admin) {
    const slot = slotById(mission, slot_id);
    const nextName = String(name || "").trim();
    if (nextName) {
      const err = assertCanAssign(peopleByName[nextName], slot, nextName, issues);
      if (err) {
        return NextResponse.json({ error: err }, { status: 400 });
      }
    }
    const seats = [...(mission.assignments[slot_id] || [])];
    seats[seat_index] = String(name || "").trim();
    updated = {
      ...mission,
      assignments: { ...mission.assignments, [slot_id]: seats },
    };
  } else {
    return NextResponse.json({ error: "פעולה לא תקינה" }, { status: 400 });
  }

  try {
    const { mission: saved } = await saveMissionDay({ ...updated, id: mission.id });
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
