import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { autoAssignDate, autoAssignMission } from "@/lib/auto-assign";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const missionId = body.mission_id ? String(body.mission_id) : "";
  const missionDate = body.mission_date ? String(body.mission_date).slice(0, 10) : "";
  const keepExisting = body.keep_existing !== false;
  const includeSameDay = body.include_same_day !== false;

  try {
    if (missionId) {
      const result = await autoAssignMission(missionId, { keepExisting, includeSameDay });
      return NextResponse.json(result);
    }

    if (missionDate) {
      const result = await autoAssignDate(missionDate, { keepExisting });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "ציינו mission_id או mission_date" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה בשיבוץ" },
      { status: 500 },
    );
  }
}
