import type { CalendarEvent } from "@/lib/calendar-ics";
import { MISSION_WALL_TZ } from "@/lib/time-interval";

function utcStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/** One-click add a single shift to Google Calendar — most reliable method. */
export function googleCalendarEventUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates: `${utcStamp(event.startMs)}/${utcStamp(event.endMs)}`,
    ctz: MISSION_WALL_TZ,
  });
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Google Settings → add calendar by HTTPS URL (more reliable than webcal:// shortcut). */
export function googleCalendarAddByUrlSettings(feedHttpsUrl: string): string {
  return `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?url=${encodeURIComponent(feedHttpsUrl)}`;
}
