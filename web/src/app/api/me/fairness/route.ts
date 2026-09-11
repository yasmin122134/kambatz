import { NextResponse } from "next/server";
import { getPersonFairnessStats } from "@/lib/fairness";
import { countDistinctMissionDates } from "@/lib/mission-scope";
import { listMissionDays } from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";
import { isAdmin } from "@/lib/auth";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  try {
    const admin = await isAdmin();
    const [stats, missions] = await Promise.all([
      getPersonFairnessStats(session.person.name, session.person.prior_score || 0),
      listMissionDays(!admin),
    ]);
    return NextResponse.json({
      ...stats,
      missionDayCount: countDistinctMissionDates(missions),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
