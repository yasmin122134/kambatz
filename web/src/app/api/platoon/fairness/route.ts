import { NextResponse } from "next/server";
import { computeRosterFairnessFromStorage, getFairnessRules } from "@/lib/fairness";
import { countDistinctMissionDates } from "@/lib/mission-scope";
import { listVisibleMissionDays } from "@/lib/missions";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";

export type PlatoonFairnessRow = {
  personId: string;
  personName: string;
  squad: number | null;
  justicePoints: number;
  guardPoints: number;
  toranutPoints: number;
  totalWithHistory: number;
  priorScore: number;
};

export async function GET() {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    const [rules, missions, peopleRes] = await Promise.all([
      getFairnessRules(),
      listVisibleMissionDays(),
      supabase
        .from("people")
        .select("id, name, prior_score, squad")
        .eq("active", true)
        .order("name"),
    ]);

    if (peopleRes.error) throw new Error(peopleRes.error.message);

    const people = (peopleRes.data || []).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      prior_score: Number(p.prior_score) || 0,
      squad:
        p.squad != null && Number(p.squad) >= 1 && Number(p.squad) <= 4
          ? Number(p.squad)
          : null,
    }));

    const burdenByName = new Map(
      (
        await computeRosterFairnessFromStorage(
          people.map(({ name, prior_score }) => ({ name, prior_score })),
          rules,
        )
      ).map((row) => [row.personName, row]),
    );

    const roster: PlatoonFairnessRow[] = people.map((p) => {
      const burden = burdenByName.get(p.name);
      return {
        personId: p.id,
        personName: p.name,
        squad: p.squad,
        justicePoints: burden?.fairnessPoints ?? burden?.totalBurden ?? 0,
        guardPoints: burden?.guardPoints ?? 0,
        toranutPoints: burden?.toranutPoints ?? 0,
        totalWithHistory: burden?.totalWithHistory ?? 0,
        priorScore: p.prior_score,
      };
    });

    roster.sort((a, b) => {
      if (a.justicePoints !== b.justicePoints) {
        return a.justicePoints - b.justicePoints;
      }
      return a.personName.localeCompare(b.personName, "he");
    });

    return NextResponse.json({
      roster,
      missionDayCount: countDistinctMissionDates(missions),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
