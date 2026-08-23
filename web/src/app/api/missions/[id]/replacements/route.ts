import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFairnessRules } from "@/lib/fairness";
import { listMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { findReplacements } from "@/lib/scheduling-engine";
import { sameDayMissionsFor } from "@/lib/replacement-apply";
import { isAdmin } from "@/lib/auth";
import type { Issue, Person } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

async function loadPeople(): Promise<Person[]> {
  const supabase = await createClient();
  return fetchActivePeople(supabase);
}

async function loadIssues(): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("status", "approved");
  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data || []) as Issue[];
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const slotId = String(body.slot_id || "");
  const seatIndex = +body.seat_index;
  const removeName = String(body.remove_name || "").trim();
  const mode = body.mode === "swap" ? "swap" : "replace";

  if (!slotId || Number.isNaN(seatIndex) || !removeName) {
    return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
  }

  try {
    const [missions, people, issues, rules] = await Promise.all([
      listMissionDays(false),
      loadPeople(),
      loadIssues(),
      getFairnessRules(),
    ]);

    const mission = missions.find((m) => m.id === id);
    if (!mission) {
      return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    }

    const sameDay = sameDayMissionsFor(mission, missions);
    const options = findReplacements({
      missions: sameDay,
      people,
      issues,
      rules,
      missionId: id,
      slotId,
      seatIndex,
      removeName,
      mode,
    });

    return NextResponse.json({ options });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
