import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { buildPersonCalendarIcs } from "@/lib/calendar-ics";
import { listMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";

/** Admin: download ICS for a specific cadet by name (for sharing / email). */
export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const personName = searchParams.get("person")?.trim();
  const missionDate = searchParams.get("mission_date")?.slice(0, 10);

  if (!personName) {
    return NextResponse.json({ error: "חסר person" }, { status: 400 });
  }

  const supabase = await createClient();
  const people = await fetchActivePeople(supabase);
  if (!people.some((p) => p.name === personName)) {
    return NextResponse.json({ error: "שם לא נמצא במחזור" }, { status: 404 });
  }

  let missions = await listMissionDays(true);
  if (missionDate) {
    missions = missions.filter((m) => m.mission_date === missionDate);
  }

  const body = buildPersonCalendarIcs(missions, personName);
  const safeName = personName.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim() || "calendar";
  const dateSuffix = missionDate ? `-${missionDate}` : "";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="kambatz-${safeName}${dateSuffix}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
