import { NextResponse } from "next/server";
import { consolidateGuardDayMission } from "@/lib/guard-day-bundle";
import { isAdmin } from "@/lib/auth";
import {
  defaultSchedulingForType,
  resolveMissionPositions,
  shouldRegenerateGuardStructure,
} from "@/lib/mission-templates";
import {
  deleteMissionDay,
  getMissionDay,
  normalizeSchedulingRules,
  saveMissionDay,
  syncAssignmentSeats,
} from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { loadApprovedIssues } from "@/lib/issues";
import { canAssignKind, blockedByIssue, issueBlockMessage, canAssignPersonToSlot, canSwapReplacementAssignments } from "@/lib/scheduling-engine";
import { flattenMissionSlots, reconcileAssignmentsOnStructureChange } from "@/lib/mission-utils";
import { createClient } from "@/lib/supabase/server";
import { getSessionPerson } from "@/lib/session";
import { getFairnessRules } from "@/lib/fairness";
import { listMissionDays } from "@/lib/missions";
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
  context?: {
    sameDayMissions: Awaited<ReturnType<typeof listMissionDays>>;
    rules: Awaited<ReturnType<typeof getFairnessRules>>;
    missionId: string;
    seatIndex: number;
    peopleByName: Record<string, Person>;
    replaceName?: string | null;
  },
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
  if (context) {
    const check = canAssignPersonToSlot({
      missions: context.sameDayMissions,
      rules: context.rules,
      missionId: context.missionId,
      slot,
      seatIndex: context.seatIndex,
      person,
      issues,
      peopleByName: context.peopleByName,
      replaceName: context.replaceName,
    });
    if (!check.ok) return check.reason;
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
      mission_type === "guards"
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
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const mission = await getMissionDay(id);
  if (!mission || (mission.status !== "published" && !(await isAdmin()))) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const {
    action,
    slot_id,
    seat_index,
    target_mission_id,
    target_slot_id,
    target_seat_index,
    name,
  } = body;

  const admin = await isAdmin();
  const personName = session.person.name;
  const peopleByName = await peopleByNameMap();
  const issues = await loadApprovedIssues();
  const [allMissions, rules] = await Promise.all([
    listMissionDays(false),
    getFairnessRules(),
  ]);
  const sameDayMissions = allMissions.filter(
    (m) => m.mission_date === mission.mission_date,
  );
  const assignContext = {
    sameDayMissions,
    rules,
    missionId: mission.id,
    peopleByName,
  };

  let updated = mission;

  if (action === "take") {
    const slot = slotById(mission, slot_id);
    const err = assertCanAssign(session.person, slot, personName, issues, {
      ...assignContext,
      seatIndex: seat_index,
      replaceName: null,
    });
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
    const targetMissionId = String(target_mission_id || mission.id);
    const targetMission =
      targetMissionId === mission.id
        ? mission
        : sameDayMissions.find((m) => m.id === targetMissionId);
    if (!targetMission) {
      return NextResponse.json({ error: "משימת יעד לא נמצאה" }, { status: 404 });
    }

    const srcSlot = slotById(mission, slot_id);
    const dstSlot = slotById(targetMission, target_slot_id);
    if (!srcSlot || !dstSlot) {
      return NextResponse.json({ error: "משמרת לא נמצאה" }, { status: 400 });
    }

    const src = [...(mission.assignments[slot_id] || [])];
    const dst = [...(targetMission.assignments[target_slot_id] || [])];
    const srcName = src[seat_index];
    const dstName = dst[target_seat_index];
    if (srcName !== personName && !admin) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    if (!dstName) {
      return NextResponse.json({ error: "אין עם מי להחליף" }, { status: 400 });
    }
    const swapCheck = canSwapReplacementAssignments({
      missions: sameDayMissions,
      rules,
      missionId: mission.id,
      slot: srcSlot,
      seatIndex: seat_index,
      removeName: srcName,
      swapMissionId: targetMissionId,
      swapSlot: dstSlot,
      swapSeatIndex: target_seat_index,
      swapPerson: peopleByName[dstName]!,
      issues,
      peopleByName,
    });
    if (!swapCheck.ok) {
      return NextResponse.json({ error: swapCheck.reason }, { status: 400 });
    }
    src[seat_index] = dstName;
    dst[target_seat_index] = srcName;

    try {
      if (targetMissionId === mission.id && slot_id === target_slot_id) {
        const seats = [...(mission.assignments[slot_id] || [])];
        while (seats.length <= Math.max(seat_index, target_seat_index)) seats.push("");
        seats[seat_index] = dstName;
        seats[target_seat_index] = srcName;
        const updatedSame = {
          ...mission,
          assignments: { ...mission.assignments, [slot_id]: seats },
        };
        const { mission: saved } = await saveMissionDay({
          ...updatedSame,
          id: mission.id,
        });
        return NextResponse.json(saved);
      }

      if (targetMissionId === mission.id) {
        const updatedSame = {
          ...mission,
          assignments: {
            ...mission.assignments,
            [slot_id]: src,
            [target_slot_id]: dst,
          },
        };
        const { mission: saved } = await saveMissionDay({
          ...updatedSame,
          id: mission.id,
        });
        return NextResponse.json(saved);
      }

      const updatedSrc = {
        ...mission,
        assignments: { ...mission.assignments, [slot_id]: src },
      };
      const updatedDst = {
        ...targetMission,
        assignments: { ...targetMission.assignments, [target_slot_id]: dst },
      };
      const [{ mission: savedSrc }, { mission: savedDst }] = await Promise.all([
        saveMissionDay({ ...updatedSrc, id: mission.id }),
        saveMissionDay({ ...updatedDst, id: targetMission.id }),
      ]);
      return NextResponse.json({ missions: [savedSrc, savedDst] });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "שגיאה" },
        { status: 500 },
      );
    }
  } else if (action === "admin_set" && admin) {
    const slot = slotById(mission, slot_id);
    const nextName = String(name || "").trim();
    if (nextName) {
      const err = assertCanAssign(peopleByName[nextName], slot, nextName, issues, {
        ...assignContext,
        seatIndex: seat_index,
        replaceName: mission.assignments[slot_id]?.[seat_index] || null,
      });
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
