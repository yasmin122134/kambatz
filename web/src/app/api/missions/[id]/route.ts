import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  defaultSchedulingForType,
  missionTemplateComplete,
  standardMissionPositions,
} from "@/lib/mission-templates";
import {
  deleteMissionDay,
  emptyAssignments,
  getMissionDay,
  normalizeSchedulingRules,
  saveMissionDay,
  syncAssignmentSeats,
} from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const mission = await getMissionDay(id);
    if (!mission) {
      return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    }
    const admin = await isAdmin();
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
  const positions =
    clientPositions?.length && missionTemplateComplete(mission_type, clientPositions)
      ? clientPositions
      : standardMissionPositions({
          missionType: mission_type,
          startsAt: starts_at,
          endsAt: ends_at,
          scheduling: scheduling_rules ?? defaultSchedulingForType(mission_type, starts_at),
        });

  const templateWasIncomplete =
    !clientPositions?.length || !missionTemplateComplete(mission_type, clientPositions);
  const assignments = syncAssignmentSeats(
    positions,
    templateWasIncomplete && !body.assignments
      ? emptyAssignments(positions)
      : (body.assignments ?? existing.assignments),
  );

  try {
    const saved = await saveMissionDay({
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
    return NextResponse.json(saved);
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

  let updated = mission;

  if (action === "take") {
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
    const saved = await saveMissionDay({ ...updated, id: mission.id });
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
