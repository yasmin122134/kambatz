import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  clearManualFairnessPoints,
  setManualFairnessPoints,
} from "@/lib/fairness-persistence";
import { getPersonById } from "@/lib/people";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const person = await getPersonById(id);
  if (!person) {
    return NextResponse.json({ error: "צוער לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const missionId = String(body.mission_id || body.missionId || "").trim();
  const slotId = String(body.slot_id || body.slotId || "").trim();

  if (!missionId || !slotId) {
    return NextResponse.json({ error: "חסר מזהה משימה או משמרת" }, { status: 400 });
  }

  try {
    if (body.reset === true) {
      await clearManualFairnessPoints({
        personName: person.name,
        missionId,
        slotId,
      });
      return NextResponse.json({ ok: true, reset: true });
    }

    const points = Number(body.points);
    if (Number.isNaN(points)) {
      return NextResponse.json({ error: "נקודות לא תקינות" }, { status: 400 });
    }

    await setManualFairnessPoints({
      personName: person.name,
      missionId,
      slotId,
      points,
    });
    return NextResponse.json({ ok: true, points: Math.round(points * 100) / 100 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 400 },
    );
  }
}
