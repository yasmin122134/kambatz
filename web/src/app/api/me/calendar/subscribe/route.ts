import { NextResponse } from "next/server";
import {
  calendarFeedUrl,
  googleCalendarSubscribeUrl,
} from "@/lib/calendar-feed-token";
import { calendarEmailInvitesEnabled } from "@/lib/calendar-invites";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const feedUrl = calendarFeedUrl(session.person.id);
  return NextResponse.json({
    feedUrl,
    googleSubscribeUrl: googleCalendarSubscribeUrl(feedUrl),
    emailInvitesEnabled: calendarEmailInvitesEnabled(),
  });
}
