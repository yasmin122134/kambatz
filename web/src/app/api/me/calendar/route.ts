import { NextResponse } from "next/server";
import { buildPersonCalendarIcs } from "@/lib/calendar-ics";
import { listMissionDays } from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const missions = await listMissionDays(true);
  const body = buildPersonCalendarIcs(missions, session.person.name);
  const safeName = session.person.name.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim() || "calendar";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="kambatz-${safeName}.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
