import { NextResponse } from "next/server";
import { getPersonFairnessStats } from "@/lib/fairness";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  try {
    const stats = await getPersonFairnessStats(
      session.person.name,
      session.person.prior_score || 0,
    );
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
