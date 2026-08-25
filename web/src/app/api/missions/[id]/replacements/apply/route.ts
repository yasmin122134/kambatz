import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getFairnessRules } from "@/lib/fairness";
import { getMissionDay, listMissionDays } from "@/lib/missions";
import { loadApprovedIssues } from "@/lib/issues";
import { fetchActivePeople } from "@/lib/people";
import {
  applyReplacementAssignment,
  normalizeReplacementApplyOption,
  sameDayMissionsFor,
} from "@/lib/replacement-apply";
import { resolveMissionForSlot } from "@/lib/mission-utils";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const slotId = String(body.slot_id || "");
  const seatIndex = Number(body.seat_index);
  const removeName = String(body.remove_name || "").trim();
  const option = normalizeReplacementApplyOption(body.option, body.force === true);

  if (!slotId || !Number.isFinite(seatIndex) || !removeName || !option) {
    return NextResponse.json({ error: "חסרים פרמטרים" }, { status: 400 });
  }

  if (
    option.type === "swap" &&
    (!option.swapMissionId || !option.swapSlotId || !Number.isFinite(option.swapSeatIndex))
  ) {
    return NextResponse.json({ error: "חסרים פרטי החלפה" }, { status: 400 });
  }

  try {
    const mission = await getMissionDay(id);
    if (!mission) {
      return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    }

    const supabase = await createClient();
    const [allMissions, people, issues, rules] = await Promise.all([
      listMissionDays(false),
      fetchActivePeople(supabase),
      loadApprovedIssues(),
      getFairnessRules(),
    ]);
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
    const sameDayMissions = sameDayMissionsFor(mission, allMissions);
    const hostMission =
      resolveMissionForSlot(sameDayMissions, mission.id, slotId) ?? mission;

    const result = await applyReplacementAssignment({
      sourceMission: hostMission,
      sameDayMissions,
      slotId,
      seatIndex,
      removeName,
      option,
      peopleByName,
      issues,
      rules,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 400 },
    );
  }
}
