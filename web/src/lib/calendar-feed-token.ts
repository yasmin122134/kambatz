import { createHmac, timingSafeEqual } from "crypto";

function feedSecret(): string {
  return (
    process.env.CALENDAR_FEED_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "kambatz-dev-calendar-feed"
  );
}

export function signCalendarFeedToken(personId: string): string {
  const sig = createHmac("sha256", feedSecret()).update(personId).digest("base64url");
  return `${personId}.${sig}`;
}

export function verifyCalendarFeedToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const personId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!personId || !sig) return null;
  const expected = createHmac("sha256", feedSecret()).update(personId).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return personId;
  } catch {
    return null;
  }
}

export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.replace(/\/$/, "");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function calendarFeedUrl(personId: string): string {
  const token = signCalendarFeedToken(personId);
  return `${appBaseUrl()}/api/calendar/feed/${token}.ics`;
}

export function googleCalendarSubscribeUrl(feedUrl: string): string {
  const webcal = feedUrl
    .replace(/^https:\/\//i, "webcal://")
    .replace(/^http:\/\//i, "webcal://");
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}
