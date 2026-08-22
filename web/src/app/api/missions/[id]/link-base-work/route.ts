import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { consolidateGuardDayMission } from "@/lib/guard-day-bundle";
import { getMissionDay } from "@/lib/missions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const guards = await getMissionDay(id);
  if (!guards) {
    return NextResponse.json({ error: "יום משימה לא נמצא" }, { status: 404 });
  }
  if (guards.mission_type !== "guards") {
    return NextResponse.json({ error: "רק יום שמירות יכול לכלול עב״ס" }, { status: 400 });
  }

  try {
    const consolidated = await consolidateGuardDayMission(guards);
    return NextResponse.json({ guards: consolidated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
