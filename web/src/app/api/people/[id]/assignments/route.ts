import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getPersonById } from "@/lib/people";
import {
  assignPersonToMissionSlot,
  removePersonFromMissionSlot,
} from "@/lib/person-slot-mutate";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const person = await getPersonById(id);
  if (!person) {
    return NextResponse.json({ error: "צוער לא נמצא" }, { status: 404 });
  }

  const body = await request.json();
  const action = String(body.action || "add");
  const missionId = String(body.mission_id || body.missionId || "").trim();
  const slotId = String(body.slot_id || body.slotId || "").trim();
  const seatIndex = Number(body.seat_index ?? body.seatIndex ?? 0);

  if (!missionId || !slotId || Number.isNaN(seatIndex) || seatIndex < 0) {
    return NextResponse.json({ error: "פרטי משמרת לא תקינים" }, { status: 400 });
  }

  try {
    if (action === "remove") {
      const result = await removePersonFromMissionSlot({
        missionId,
        slotId,
        seatIndex,
        personName: person.name,
      });
      return NextResponse.json({ ok: true, warnings: result.warnings });
    }

    const result = await assignPersonToMissionSlot({
      missionId,
      slotId,
      seatIndex,
      personName: person.name,
    });
    return NextResponse.json({ ok: true, warnings: result.warnings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 400 },
    );
  }
}
