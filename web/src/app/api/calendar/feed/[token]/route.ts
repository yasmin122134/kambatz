import { NextResponse } from "next/server";
import { buildPersonCalendarIcs } from "@/lib/calendar-ics";
import { verifyCalendarFeedToken } from "@/lib/calendar-feed-token";
import { getPersonById } from "@/lib/people";
import { listMissionDays } from "@/lib/missions";

type Params = { params: Promise<{ token: string }> };

/** Public webcal feed — token in URL replaces login (Google fetches without cookies). */
export async function GET(_request: Request, { params }: Params) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  const personId = verifyCalendarFeedToken(token);
  if (!personId) {
    return NextResponse.json({ error: "קישור לא תקין" }, { status: 404 });
  }

  const person = await getPersonById(personId);
  if (!person) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  const missions = await listMissionDays(true);
  const body = buildPersonCalendarIcs(missions, person.name);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="kambatz.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
