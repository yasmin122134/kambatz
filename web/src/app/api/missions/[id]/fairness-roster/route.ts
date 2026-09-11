import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getFairnessRules } from "@/lib/fairness";
import {
  loadManualFairnessOverridesForSync,
} from "@/lib/fairness-persistence";
import { computeMissionEditorFairness } from "@/lib/mission-editor-fairness";
import { getMissionDay, listVisibleMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import type { MissionDay } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const current = await getMissionDay(id);
    if (!current) {
      return NextResponse.json({ error: "משימה לא נמצאה" }, { status: 404 });
    }

    const supabase = await createClient();
    const [people, rules, published, manualRows] = await Promise.all([
      fetchActivePeople(supabase),
      getFairnessRules(),
      listVisibleMissionDays(),
      loadManualFairnessOverridesForSync(),
    ]);

    const result = computeMissionEditorFairness(
      people.map((p) => ({ name: p.name, prior_score: p.prior_score })),
      published,
      current,
      rules,
      manualRows,
    );

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

/** Live preview — body.mission replaces stored row (unsaved editor state). */
export async function POST(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const stored = await getMissionDay(id);
    if (!stored) {
      return NextResponse.json({ error: "משימה לא נמצאה" }, { status: 404 });
    }

    const current = (body.mission as MissionDay | undefined) ?? stored;
    if (String(current.id) !== id) {
      return NextResponse.json({ error: "מזהה משימה לא תואם" }, { status: 400 });
    }

    const supabase = await createClient();
    const [people, rules, published, manualRows] = await Promise.all([
      fetchActivePeople(supabase),
      getFairnessRules(),
      listVisibleMissionDays(),
      loadManualFairnessOverridesForSync(),
    ]);

    const result = computeMissionEditorFairness(
      people.map((p) => ({ name: p.name, prior_score: p.prior_score })),
      published,
      current,
      rules,
      manualRows,
    );

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
