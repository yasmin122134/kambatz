import { flattenMissionSlots } from "@/lib/mission-utils";
import { MISSION_WALL_TZ } from "@/lib/time-interval";
import { MISSION_TYPE_LABELS, type MissionDay } from "@/lib/types";

/** שם היומן ב-Google Calendar / Apple Calendar */
export const KAMBATZ_CALENDAR_NAME = "הגנם ועבס";

export type CalendarEvent = {
  uid: string;
  startMs: number;
  endMs: number;
  summary: string;
  description?: string;
};

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsFold(line: string): string {
  const enc = new TextEncoder();
  let out = "";
  let cur = "";
  let n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > 72) {
      out += `${cur}\r\n `;
      cur = "";
      n = 1;
    }
    cur += ch;
    n += b;
  }
  return out + cur;
}

function icsStamp(d: Date): string {
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

function assigneeMatches(assignees: string[], personName: string): boolean {
  const norm = personName.trim();
  return assignees.some((a) => a.trim() === norm);
}

/** All published assignment events for one person. */
export function calendarEventsForPerson(
  missions: MissionDay[],
  personName: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const mission of missions.filter((m) => m.status === "published")) {
    for (const slot of flattenMissionSlots(mission)) {
      if (!assigneeMatches(slot.assignees, personName)) continue;
      if (
        slot.startAtMs == null ||
        slot.endAtMs == null ||
        slot.endAtMs <= slot.startAtMs
      ) {
        continue;
      }
      const typeLabel = MISSION_TYPE_LABELS[mission.mission_type];
      events.push({
        uid: `${mission.id}-${slot.slotId}@kambatz`,
        startMs: slot.startAtMs,
        endMs: slot.endAtMs,
        summary: `${slot.positionName} — ${typeLabel}`,
        description: `${mission.title} · ${slot.timeLabel} · ${mission.mission_date}`,
      });
    }
  }
  events.sort((a, b) => a.startMs - b.startMs || a.summary.localeCompare(b.summary, "he"));
  return events;
}

export function buildIcsCalendar(
  events: CalendarEvent[],
  calendarName: string,
): string {
  const stamp = icsStamp(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kambatz//Mission Scheduler//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
    `X-WR-TIMEZONE:${MISSION_WALL_TZ}`,
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    // UTC timestamps — Google Calendar imports reliably (TZID without VTIMEZONE often fails).
    lines.push(`DTSTART:${icsStamp(new Date(e.startMs))}`);
    lines.push(`DTEND:${icsStamp(new Date(e.endMs))}`);
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

export function buildPersonCalendarIcs(
  missions: MissionDay[],
  personName: string,
): string {
  const events = calendarEventsForPerson(missions, personName);
  return buildIcsCalendar(events, KAMBATZ_CALENDAR_NAME);
}

export function buildCalendarInviteIcs(
  event: CalendarEvent,
  attendee: { name: string; email: string },
  organizerEmail: string,
  sequence = 0,
): string {
  const stamp = icsStamp(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kambatz//Mission Scheduler//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsStamp(new Date(event.startMs))}`,
    `DTEND:${icsStamp(new Date(event.endMs))}`,
    `SUMMARY:${icsEscape(event.summary)}`,
    `ORGANIZER;CN=Kambatz:mailto:${organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${icsEscape(attendee.name)}:mailto:${attendee.email}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
