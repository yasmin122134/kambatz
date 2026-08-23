import {
  buildCalendarInviteIcs,
  buildGroupedCalendarInviteIcs,
  type CalendarEvent,
} from "@/lib/calendar-ics";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import type { MissionDay, Person } from "@/lib/types";
import { MISSION_TYPE_LABELS } from "@/lib/types";

export type CalendarInviteSummary = {
  sent: number;
  people: number;
  events: number;
  skipped: boolean;
  reason?: "not_configured" | "not_published";
  missingEmail: string[];
  errors: string[];
};

type InviteTarget = {
  personName: string;
  email: string;
  event: CalendarEvent;
};

function emptySummary(skipped: boolean, reason?: CalendarInviteSummary["reason"]): CalendarInviteSummary {
  return { sent: 0, people: 0, events: 0, skipped, reason, missingEmail: [], errors: [] };
}

function organizerEmail(): string | null {
  const from = process.env.CALENDAR_FROM_EMAIL?.trim();
  if (from) return from;
  return process.env.RESEND_API_KEY ? "onboarding@resend.dev" : null;
}

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!organizerEmail();
}

export function calendarEmailInvitesEnabled(): boolean {
  return resendConfigured();
}

function assignmentKeys(mission: MissionDay): Set<string> {
  const keys = new Set<string>();
  for (const slot of flattenMissionSlots(mission)) {
    for (const name of slot.assignees) {
      const n = name.trim();
      if (n) keys.add(`${slot.slotId}:${n}`);
    }
  }
  return keys;
}

function eventForSlot(mission: MissionDay, slot: ReturnType<typeof flattenMissionSlots>[0]): CalendarEvent {
  const typeLabel = MISSION_TYPE_LABELS[mission.mission_type];
  return {
    uid: `${mission.id}-${slot.slotId}@kambatz`,
    startMs: slot.startAtMs!,
    endMs: slot.endAtMs!,
    summary: `${slot.positionName} — ${typeLabel}`,
    description: `${mission.title} · ${slot.timeLabel} · ${mission.mission_date}`,
  };
}

function inviteTargetsForMission(
  mission: MissionDay,
  previous: MissionDay | null,
  peopleByName: Record<string, Person>,
  forceAll: boolean,
): { targets: InviteTarget[]; missingEmail: string[] } {
  const prevKeys =
    previous?.status === "published" ? assignmentKeys(previous) : new Set<string>();
  const isFirstPublish = !previous || previous.status !== "published";
  const sendAll = forceAll || isFirstPublish;
  const targets: InviteTarget[] = [];
  const missingEmail: string[] = [];

  for (const slot of flattenMissionSlots(mission)) {
    if (
      slot.startAtMs == null ||
      slot.endAtMs == null ||
      slot.endAtMs <= slot.startAtMs
    ) {
      continue;
    }
    for (const rawName of slot.assignees) {
      const personName = rawName.trim();
      if (!personName) continue;
      const key = `${slot.slotId}:${personName}`;
      if (!sendAll && prevKeys.has(key)) continue;

      const person = peopleByName[personName];
      const email = person?.email?.trim().toLowerCase();
      if (!email) {
        missingEmail.push(personName);
        continue;
      }

      targets.push({
        personName,
        email,
        event: eventForSlot(mission, slot),
      });
    }
  }

  return { targets, missingEmail: [...new Set(missingEmail)] };
}

async function sendResendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  ics: string;
  filename: string;
}): Promise<void> {
  const organizer = organizerEmail();
  if (!organizer || !process.env.RESEND_API_KEY) {
    throw new Error("Resend not configured");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `קמב״ץ <${organizer}>`,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      attachments: [
        {
          filename: payload.filename,
          content: Buffer.from(payload.ics, "utf8").toString("base64"),
          content_type: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

function groupTargetsByEmail(targets: InviteTarget[]): Map<string, InviteTarget[]> {
  const map = new Map<string, InviteTarget[]>();
  for (const t of targets) {
    const list = map.get(t.email) ?? [];
    list.push(t);
    map.set(t.email, list);
  }
  return map;
}

/** Send calendar invite emails when a mission is saved/published. */
export async function sendCalendarInvitesForMission(
  mission: MissionDay,
  previous: MissionDay | null = null,
  options: { forceAll?: boolean } = {},
): Promise<CalendarInviteSummary> {
  if (mission.status !== "published") {
    return emptySummary(true, "not_published");
  }
  if (!resendConfigured()) {
    return emptySummary(true, "not_configured");
  }

  const organizer = organizerEmail();
  if (!organizer) return emptySummary(true, "not_configured");

  const supabase = await createClient();
  let peopleByName: Record<string, Person> = {};
  try {
    const people = await fetchActivePeople(supabase);
    peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  } catch {
    return emptySummary(true, "not_configured");
  }

  const forceAll =
    options.forceAll ??
    (!previous || previous.status !== "published");
  const { targets, missingEmail } = inviteTargetsForMission(
    mission,
    previous,
    peopleByName,
    forceAll,
  );

  if (!targets.length) {
    return {
      sent: 0,
      people: 0,
      events: 0,
      skipped: false,
      missingEmail,
      errors: [],
    };
  }

  const errors: string[] = [];
  let sent = 0;
  let eventCount = 0;

  if (forceAll) {
    const grouped = groupTargetsByEmail(targets);
    for (const [, personTargets] of grouped) {
      const { personName, email } = personTargets[0];
      const events = personTargets.map((t) => t.event);
      eventCount += events.length;
      try {
        const ics = buildGroupedCalendarInviteIcs(events, { name: personName, email }, organizer);
        const subject =
          events.length === 1
            ? `משמרת: ${events[0].summary}`
            : `לוח משמרות ${mission.mission_date} (${events.length} משמרות)`;
        await sendResendEmail({
          to: email,
          subject,
          html: `<p>שלום ${personName},</p><p>פורסם לוח משמרות ל-<strong>${mission.mission_date}</strong>.</p><ul>${events.map((e) => `<li>${e.summary} · ${e.description ?? ""}</li>`).join("")}</ul><p>הזמנות מצורפות ליומן — Google Calendar יוסיף אותן מהמייל.</p>`,
          ics,
          filename: "invite.ics",
        });
        sent++;
      } catch (e) {
        errors.push(`${email}: ${e instanceof Error ? e.message : "שגיאה"}`);
        console.error("[calendar-invite]", email, e);
      }
    }
    return {
      sent,
      people: grouped.size,
      events: eventCount,
      skipped: false,
      missingEmail,
      errors,
    };
  }

  for (const target of targets) {
    eventCount++;
    try {
      const ics = buildCalendarInviteIcs(
        target.event,
        { name: target.personName, email: target.email },
        organizer,
      );
      await sendResendEmail({
        to: target.email,
        subject: `משמרת: ${target.event.summary}`,
        html: `<p>שלום ${target.personName},</p><p>שובצת למשמרת: <strong>${target.event.summary}</strong></p><p>${target.event.description ?? ""}</p><p>האירוע מצורף ליומן.</p>`,
        ics,
        filename: "invite.ics",
      });
      sent++;
    } catch (e) {
      errors.push(`${target.email}: ${e instanceof Error ? e.message : "שגיאה"}`);
      console.error("[calendar-invite]", target.email, e);
    }
  }

  const people = new Set(targets.map((t) => t.email)).size;
  return { sent, people, events: eventCount, skipped: false, missingEmail, errors };
}

/** Send calendar invite email for every published assignment (manual sync). */
export async function sendAllCalendarInvitesForPerson(
  person: Pick<Person, "name" | "email">,
): Promise<{ sent: number; total: number; skipped: boolean; error?: string }> {
  if (!resendConfigured()) {
    return { sent: 0, total: 0, skipped: true, error: "email_not_configured" };
  }
  const email = person.email?.trim().toLowerCase();
  if (!email) {
    return { sent: 0, total: 0, skipped: true, error: "no_email" };
  }

  const organizer = organizerEmail();
  if (!organizer) return { sent: 0, total: 0, skipped: true, error: "no_organizer" };

  const { listMissionDays } = await import("@/lib/missions");
  const { calendarEventsForPerson } = await import("@/lib/calendar-ics");
  const missions = await listMissionDays(true);
  const events = calendarEventsForPerson(missions, person.name);
  if (!events.length) {
    return { sent: 0, total: 0, skipped: false };
  }

  try {
    const ics = buildGroupedCalendarInviteIcs(events, { name: person.name, email }, organizer);
    await sendResendEmail({
      to: email,
      subject: `לוח משמרות (${events.length})`,
      html: `<p>שלום ${person.name},</p><p>מצורף לוח המשמרות שלך (${events.length}).</p>`,
      ics,
      filename: "invite.ics",
    });
    return { sent: 1, total: events.length, skipped: false };
  } catch {
    return { sent: 0, total: events.length, skipped: false, error: "send_failed" };
  }
}

export function formatCalendarInviteMessage(summary: CalendarInviteSummary): string | null {
  if (summary.reason === "not_configured") {
    return "הזמנות מייל לא נשלחו — הגדירו RESEND_API_KEY ו-CALENDAR_FROM_EMAIL ב-Vercel";
  }
  if (summary.reason === "not_published" || summary.events === 0) {
    return null;
  }
  const parts = [`נשלחו הזמנות ל-${summary.sent} חניכים (${summary.events} משמרות)`];
  if (summary.missingEmail.length) {
    parts.push(`ללא מייל: ${summary.missingEmail.slice(0, 5).join(", ")}${summary.missingEmail.length > 5 ? "…" : ""}`);
  }
  if (summary.errors.length) {
    parts.push(`שגיאות: ${summary.errors.length}`);
  }
  return parts.join(" · ");
}
