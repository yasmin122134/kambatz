import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { computeRosterBurdenSummary, getFairnessRules } from "@/lib/fairness";
import { listMissionDays } from "@/lib/missions";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const admin = await isAdmin();
  const { searchParams } = new URL(req.url);
  const missionDate = searchParams.get("mission_date");

  try {
    const supabase = await createClient();
    const [rules, missions, peopleRes] = await Promise.all([
      getFairnessRules(),
      listMissionDays(false),
      supabase
        .from("people")
        .select("name, prior_score")
        .eq("active", true)
        .order("name"),
    ]);

    if (peopleRes.error) throw new Error(peopleRes.error.message);

    const visible = admin
      ? missions
      : missions.filter((m) => m.status === "published");
    const filtered = missionDate
      ? visible.filter((m) => m.mission_date === missionDate.slice(0, 10))
      : visible;

    const roster = computeRosterBurdenSummary(
      (peopleRes.data || []).map((p) => ({
        name: String(p.name),
        prior_score: Number(p.prior_score) || 0,
      })),
      filtered,
      rules,
    );

    roster.sort((a, b) => b.totalWithHistory - a.totalWithHistory);

    return NextResponse.json({
      missionDate: missionDate?.slice(0, 10) || null,
      roster,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
