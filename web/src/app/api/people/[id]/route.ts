import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getPersonFairnessStats } from "@/lib/fairness";
import { countDistinctMissionDates } from "@/lib/mission-scope";
import { listMissionDays } from "@/lib/missions";
import { getPersonById } from "@/lib/people";
import {
  collectPersonAssignmentRows,
  listAvailableAssignmentSlots,
} from "@/lib/person-assignments";
import { createClient } from "@/lib/supabase/server";
import { buildPeopleAdminPatch, getAuthSession } from "@/lib/session";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleFlags,
  probePeopleOfficer,
} from "@/lib/people";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const { id } = await params;
  const person = await getPersonById(id);
  if (!person || person.active === false) {
    return NextResponse.json({ error: "צוער לא נמצא" }, { status: 404 });
  }

  const admin = await isAdmin();
  try {
    const missions = await listMissionDays(!admin);
    const [fairness, assignments, availableSlots] = await Promise.all([
      getPersonFairnessStats(person.name, person.prior_score || 0),
      Promise.resolve(collectPersonAssignmentRows(person.name, missions)),
      admin
        ? Promise.resolve(listAvailableAssignmentSlots(missions))
        : Promise.resolve([]),
    ]);

    const pointsBySlot = new Map(
      fairness.history.map((h) => [
        `${h.missionId}:${h.slotId ?? h.id.split(":")[1]}`,
        h,
      ]),
    );

    const assignmentRows = assignments.map((row) => {
      const history = pointsBySlot.get(`${row.missionId}:${row.slotId}`);
      return {
        ...row,
        points: history?.points,
        pointsManual: history?.pointsManual,
        bucket: history?.bucket,
        hours: history?.hours,
        burdenBase: history?.burdenBase,
        burdenRest: history?.burdenRest,
        burdenIsSolo: history?.burdenIsSolo,
      };
    });

    return NextResponse.json({
      person,
      fairness: {
        ...fairness,
        missionDayCount: countDistinctMissionDates(missions),
      },
      assignments: assignmentRows,
      availableSlots,
      canEdit: admin,
      isSelf: session.person?.id === person.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await getPersonById(id);
  if (!existing) {
    return NextResponse.json({ error: "צוער לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);
  const withOfficer = await probePeopleOfficer(supabase);
  const result = buildPeopleAdminPatch(body, { withFlags, withOfficer });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const selectCols = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}${withOfficer ? ",is_officer,is_admin" : ""}`
    : `${PEOPLE_BASE_SELECT}${withOfficer ? ",is_officer,is_admin" : ""}`;

  const { data, error } = await supabase
    .from("people")
    .update(result.patch)
    .eq("id", id)
    .select(selectCols)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
