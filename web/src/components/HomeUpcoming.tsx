import Link from "next/link";
import type { UpcomingEvent } from "@/lib/upcoming";

type Props = {
  personName: string;
  boardReady: boolean;
  boardStart: string;
  events: UpcomingEvent[];
};

export function HomeUpcoming({ personName, boardReady, boardStart, events }: Props) {
  return (
    <section className="card mb-6">
      <div className="bar spread mb-3">
        <div>
          <h2 className="font-display text-xl">שלום, {personName}</h2>
          <p className="hint mt-1">האירועים הבאים שלך בלוח התורנות</p>
        </div>
        <Link href="/profile" className="btn-sm">
          הפרופיל שלי
        </Link>
      </div>

      {!boardReady && events.length === 0 ? (
        <p className="hint">
          עדיין אין לוח פעיל. כשהמפקד יבנה לוח — המשמרות שלך יופיעו כאן אוטומטית.
        </p>
      ) : events.length === 0 ? (
        <p className="hint">
          אין משמרות או חסימות קרובות בלוח הנוכחי (פתיחה {boardStart}).
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev, i) => (
            <li
              key={ev.id}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border px-3 py-2.5 ${
                i === 0
                  ? "border-olive bg-[#eef2e8]"
                  : "border-line2 bg-bone2/60"
              }`}
            >
              <span className="mono text-sm font-medium shrink-0">{ev.time}</span>
              <span className="font-semibold">{ev.title}</span>
              {ev.subtitle && (
                <span className="text-sm text-ink2">{ev.subtitle}</span>
              )}
              {ev.kind === "block" && ev.status && ev.statusKey && (
                <span className={`tag tag-${ev.statusKey} text-xs`}>
                  {ev.status}
                </span>
              )}
              {ev.kind === "shift" && i === 0 && !ev.ongoing && (
                <span className="text-xs text-olive font-medium">הבא</span>
              )}
              {ev.ongoing && (
                <span className="text-xs text-brick font-medium">עכשיו</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="bar mt-4 gap-2">
        <Link href="/schedule" className="btn-pri btn-sm">
          לוח שמירות מלא
        </Link>
        <Link href="/report" className="btn-sm">
          דווח חסימה
        </Link>
        {!boardReady && (
          <span className="hint">לוח המחולל טרם נשמר בשרת</span>
        )}
      </div>
    </section>
  );
}
