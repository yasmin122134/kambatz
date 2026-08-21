import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { HomeGuest } from "@/components/HomeGuest";
import { HomeUnknownUser } from "@/components/HomeUnknownUser";
import { getUpcomingForPersonFromMissions } from "@/lib/missions";
import { getAuthUser, getSessionPerson, peopleEmailReady } from "@/lib/session";

export default async function HomePage() {
  const user = await getAuthUser();
  const session = await getSessionPerson();
  const emailReady = user ? await peopleEmailReady() : false;

  const upcoming = session
    ? await getUpcomingForPersonFromMissions(session.person.name)
    : [];

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
                {upcoming.map((item, i) => (
                  <li
                    key={item.id}
                    className={`schedule-row ${i === 0 ? "schedule-mine" : ""}`}
                  >
                    <span className="mono text-sm font-medium shrink-0">
                      {item.timeLabel}
                    </span>
                    <span className="font-semibold">{item.title}</span>
                    {item.subtitle && (
                      <span className="text-sm text-ink2">{item.subtitle}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Link href="/board" className="btn-pri w-full text-center block">
              לרשימה המלאה
            </Link>
          </section>
        )}
      </main>
    </AppShell>
  );
}
