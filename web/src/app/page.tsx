import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeGuest } from "@/components/HomeGuest";
import { HomeUpcoming } from "@/components/HomeUpcoming";
import { HomeUnknownUser } from "@/components/HomeUnknownUser";
import { getUpcomingForPerson } from "@/lib/upcoming";
import { getAuthUser, getSessionPerson, peopleEmailReady } from "@/lib/session";

export default async function HomePage() {
  const user = await getAuthUser();
  const session = await getSessionPerson();
  const emailReady = user ? await peopleEmailReady() : false;
  const upcoming = session
    ? await getUpcomingForPerson(session.person.name)
    : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10">
        {session && upcoming ? (
          <HomeUpcoming
            personName={session.person.name}
            boardReady={upcoming.boardReady}
            boardStart={upcoming.boardStart}
            events={upcoming.events}
          />
        ) : user?.email ? (
          <HomeUnknownUser email={user.email} emailsNotReady={!emailReady} />
        ) : (
          <HomeGuest />
        )}

        <div className="card mb-6">
          <h2 className="font-display text-2xl mb-2">ברוכים הבאים</h2>
          <p className="lede">
            מערכת לוח שמירות לגדוד — צוערים מדווחים חסימות שעות, מפקד מאשר,
            והמחולל בונה לוח שמירות מאוזן.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/report" className="card card-link">
            <h3 className="font-display text-lg text-brick">דיווח חסימה</h3>
            <p className="text-sm text-ink2 mt-2">
              יש לכם מבחן, התנסות, או פטור? דווחו את השעות — פשוט ובלי התחברות.
            </p>
          </Link>

          <Link href="/profile" className="card card-link">
            <h3 className="font-display text-lg text-olive">הפרופיל שלי</h3>
            <p className="text-sm text-ink2 mt-2">
              התחברות עם Google — עדכון כ״מ, פטור שמירה, ללא נשק ועוד.
            </p>
          </Link>

          <Link href="/admin" className="card card-link">
            <h3 className="font-display text-lg text-olive">ניהול</h3>
            <p className="text-sm text-ink2 mt-2">
              מפקד: אישור דיווחים ורשימת מחזור. מאושרים נכנסים אוטומטית למחולל.
            </p>
          </Link>

          <Link href="/scheduler.html" className="card card-link sm:col-span-2">
            <h3 className="font-display text-lg">מחולל שיבוץ מלא</h3>
            <p className="text-sm text-ink2 mt-2">
              לוח שמירות מלא — בניית לוח, ייצוא Excel, בלת״ם, טבלת צדק.
            </p>
          </Link>
        </div>
      </main>
    </>
  );
}
