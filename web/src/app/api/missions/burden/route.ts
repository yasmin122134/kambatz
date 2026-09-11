import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { computeRosterFairnessFromStorage, getFairnessRules } from "@/lib/fairness";
import { countDistinctMissionDates } from "@/lib/mission-scope";
import {
  listMissionDaysForBoardFocus,
  listVisibleMissionDays,
} from "@/lib/missions";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const missionDate = searchParams.get("mission_date");
  const admin = await isAdmin();
  const focusMissionId = admin ? searchParams.get("missionId")?.trim() : undefined;

  try {
    const supabase = await createClient();
    const [rules, missions, peopleRes] = await Promise.all([
      getFairnessRules(),
      focusMissionId
        ? listMissionDaysForBoardFocus(focusMissionId)
        : listVisibleMissionDays(),
      supabase
        .from("people")
        .select("name, prior_score")
        .eq("active", true)
        .order("name"),
    ]);

    if (peopleRes.error) throw new Error(peopleRes.error.message);

    const visible = missions;
    const people = (peopleRes.data || []).map((p) => ({
      name: String(p.name),
      prior_score: Number(p.prior_score) || 0,
    }));

    const dateKey = missionDate?.slice(0, 10) ?? null;
    const dayMissions = dateKey
      ? visible.filter((m) => m.mission_date === dateKey)
      : visible;

    const roster = (
      await computeRosterFairnessFromStorage(people, rules, {
        missionDate: dateKey,
        missions: visible,
      })
    ).sort((a, b) => b.totalWithHistory - a.totalWithHistory);

    const periodRoster = dateKey
      ? (
          await computeRosterFairnessFromStorage(people, rules, {
            missions: visible,
          })
        ).sort((a, b) => b.totalWithHistory - a.totalWithHistory)
      : undefined;

    const missionDayCount = countDistinctMissionDates(dayMissions);
    const periodMissionDayCount = countDistinctMissionDates(visible);

    return NextResponse.json({
      missionDate: dateKey,
      missionDayCount,
      periodMissionDayCount,
      roster,
      periodRoster,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
