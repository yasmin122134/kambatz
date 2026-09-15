import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { publishMissionDays } from "@/lib/missions";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mission_ids = Array.isArray(body.mission_ids)
    ? body.mission_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)
    : [];

  if (!mission_ids.length) {
    return NextResponse.json({ error: "חסרים ימי משימה" }, { status: 400 });
  }

  try {
    const missions = await publishMissionDays(mission_ids);
    if (!missions.length) {
      return NextResponse.json({ error: "אין טיוטה לפרסום" }, { status: 404 });
    }
    return NextResponse.json({ missions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
