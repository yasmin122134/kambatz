import { NextResponse } from "next/server";
import { calendarEventsForPerson } from "@/lib/calendar-ics";
import { googleCalendarEventUrl } from "@/lib/calendar-google";
import { calendarEmailInvitesEnabled } from "@/lib/calendar-invites";
import { listMissionDays } from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const missions = await listMissionDays(true);
  const events = calendarEventsForPerson(missions, session.person.name);

  return NextResponse.json({
    count: events.length,
    email: session.person.email,
    emailInvitesEnabled: calendarEmailInvitesEnabled(),
    events: events.map((event) => ({
      uid: event.uid,
      summary: event.summary,
      description: event.description,
      startMs: event.startMs,
      endMs: event.endMs,
      googleUrl: googleCalendarEventUrl(event),
    })),
  });
}
