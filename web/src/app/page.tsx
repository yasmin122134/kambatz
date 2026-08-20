import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { HomeGuest } from "@/components/HomeGuest";
import { HomeUnknownUser } from "@/components/HomeUnknownUser";
import { getUpcomingForPersonFromMissions } from "@/lib/missions";
import { getUpcomingForPerson } from "@/lib/upcoming";
import { getAuthUser, getSessionPerson, peopleEmailReady } from "@/lib/session";
import type { UpcomingMissionItem } from "@/lib/missions";

function mergeUpcoming(
  missionItems: UpcomingMissionItem[],
  legacy: Awaited<ReturnType<typeof getUpcomingForPerson>>,
) {
  if (missionItems.length) return { items: missionItems, source: "missions" as const };
  if (legacy.events.length) {
    return {
      items: legacy.events.map((ev) => ({
        id: ev.id,
        timeLabel: ev.time,
        title: ev.title,
        subtitle: ev.subtitle || "",
      })),
      source: "legacy" as const,
      boardStart: legacy.boardStart,
    };
  }
  return { items: [], source: "none" as const };
}

export default async function HomePage() {
  const user = await getAuthUser();
  const session = await getSessionPerson();
  const emailReady = user ? await peopleEmailReady() : false;

  let upcoming: {
    items: { id: string; timeLabel: string; title: string; subtitle: string }[];
  } = { items: [] };

  if (session) {
    const [missionItems, legacy] = await Promise.all([
      getUpcomingForPersonFromMissions(session.person.name),
      getUpcomingForPerson(session.person.name),
    ]);
    upcoming = { items: mergeUpcoming(missionItems, legacy).items };
  }

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

            {upcoming.items.length === 0 ? (
              <p className="hint">
                אין משמרות קרובות. כשייפורסם לוח — יופיע כאן.
              </p>
            ) : (
              <ul className="space-y-2 mb-6">
                {upcoming.items.map((item, i) => (
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
