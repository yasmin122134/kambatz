import { NextResponse } from "next/server";
import { getPersonFairnessStats } from "@/lib/fairness";
import { countDistinctMissionDates } from "@/lib/mission-scope";
import { listVisibleMissionDays } from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  try {
    const [stats, missions] = await Promise.all([
      getPersonFairnessStats(session.person.name, session.person.prior_score || 0),
      listVisibleMissionDays(),
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
