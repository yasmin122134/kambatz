import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AddToCalendarLink } from "@/components/AddToCalendarLink";
import { CalendarAutoSync } from "@/components/CalendarAutoSync";
import { HomeGuest } from "@/components/HomeGuest";
import { HomeUnknownUser } from "@/components/HomeUnknownUser";
import {
  calendarEventsForPerson,
  shiftIdFromCalendarUid,
} from "@/lib/calendar-ics";
import { getUpcomingForPersonFromMissions, listMissionDays } from "@/lib/missions";
import { getAuthUser, getSessionPerson, peopleEmailReady } from "@/lib/session";

export default async function HomePage() {
  const user = await getAuthUser();
  const session = await getSessionPerson();
  const emailReady = user ? await peopleEmailReady() : false;

  const missions = session ? await listMissionDays(true) : [];
  const upcoming = session
    ? await getUpcomingForPersonFromMissions(session.person.name)
    : [];

  const calendarEvents = session
    ? calendarEventsForPerson(missions, session.person.name)
    : [];

  const calendarUrlByShiftId = new Map(
    calendarEvents.flatMap((event) => {
      const shiftId = shiftIdFromCalendarUid(event.uid);
      return shiftId ? [[shiftId, event] as const] : [];
    }),
  );

  const calendarPreview = session
    ? {
        count: calendarEvents.length,
        events: calendarEvents.map((event) => ({
          uid: event.uid,
          summary: event.summary,
          event,
        })),
      }
    : null;

  return (
    <AppShell>
      <main className="mx-auto max-w-lg px-5 py-8 flex-1">
        {!user ? (
          <HomeGuest />
        ) : !session ? (
          <HomeUnknownUser email={user.email || ""} emailsNotReady={!emailReady} />
        ) : (
          <section className="card">
            <h2 className="font-display text-2xl mb-1">
              שלום, {session.person.name}
            </h2>
            <p className="lede mb-5">המשימות הבאות שלך:</p>

            {upcoming.length === 0 ? (
              <p className="hint">
                אין משמרות קרובות. כשייפורסם לוח — יופיע כאן.
              </p>
            ) : (
              <ul className="space-y-2 mb-6">
                {upcoming.map((item, i) => {
                  const calendarEvent = calendarUrlByShiftId.get(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`schedule-row ${i === 0 ? "schedule-mine" : ""}`}
                    >
                      <span className="mono text-sm font-medium shrink-0">
                        {item.timeLabel}
                      </span>
                      <span className="font-semibold flex-1 min-w-0 truncate">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="text-sm text-ink2 shrink-0">{item.subtitle}</span>
                      )}
                      {calendarEvent && (
                        <AddToCalendarLink event={calendarEvent} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <Link href="/board" className="btn-pri w-full text-center block mb-3">
              לרשימה המלאה
            </Link>

            {calendarPreview && <CalendarAutoSync preview={calendarPreview} />}
          </section>
        )}
      </main>
    </AppShell>
  );
}
