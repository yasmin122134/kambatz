import { flattenMissionSlots } from "@/lib/mission-utils";
import { MISSION_WALL_TZ } from "@/lib/time-interval";
import { MISSION_TYPE_LABELS, type MissionDay } from "@/lib/types";

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

function icsLocalDateTime(ms: number, timeZone = MISSION_WALL_TZ): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return (
    pick("year") +
    pick("month") +
    pick("day") +
    "T" +
    pick("hour") +
    pick("minute") +
    pick("second")
  );
}

/** All published assignment events for one person. */
export function calendarEventsForPerson(
  missions: MissionDay[],
  personName: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const mission of missions.filter((m) => m.status === "published")) {
    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      if (!slot.startAtMs || !slot.endAtMs || slot.endAtMs <= slot.startAtMs) continue;
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
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;TZID=${MISSION_WALL_TZ}:${icsLocalDateTime(e.startMs)}`);
    lines.push(`DTEND;TZID=${MISSION_WALL_TZ}:${icsLocalDateTime(e.endMs)}`);
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
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
  return buildIcsCalendar(events, `משמרות — ${personName}`);
}
