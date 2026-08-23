import {
  buildCalendarInviteIcs,
  type CalendarEvent,
} from "@/lib/calendar-ics";
import { flattenMissionSlots } from "@/lib/mission-utils";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import type { MissionDay, Person } from "@/lib/types";
import { MISSION_TYPE_LABELS } from "@/lib/types";

type InviteTarget = {
  personName: string;
  email: string;
  event: CalendarEvent;
};

function organizerEmail(): string | null {
  const from = process.env.CALENDAR_FROM_EMAIL?.trim();
  if (from) return from;
  return process.env.RESEND_API_KEY ? "kambatz@resend.dev" : null;
}

function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!organizerEmail();
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

function inviteTargetsForMission(
  mission: MissionDay,
  previous: MissionDay | null,
  peopleByName: Record<string, Person>,
): InviteTarget[] {
  const prevKeys =
    previous?.status === "published" ? assignmentKeys(previous) : new Set<string>();
  const isFirstPublish = !previous || previous.status !== "published";
  const targets: InviteTarget[] = [];

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
      if (!isFirstPublish && prevKeys.has(key)) continue;

      const person = peopleByName[personName];
      const email = person?.email?.trim().toLowerCase();
      if (!email) continue;

      const typeLabel = MISSION_TYPE_LABELS[mission.mission_type];

      targets.push({
        personName,
        email,
        event: {
          uid: `${mission.id}-${slot.slotId}@kambatz`,
          startMs: slot.startAtMs,
          endMs: slot.endAtMs,
          summary: `${slot.positionName} — ${typeLabel}`,
          description: `${mission.title} · ${slot.timeLabel} · ${mission.mission_date}`,
        },
      });
    }
  }

  return targets;
}

async function sendInviteEmail(target: InviteTarget, organizer: string): Promise<void> {
  const ics = buildCalendarInviteIcs(target.event, {
    name: target.personName,
    email: target.email,
  }, organizer);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `קמב״ץ <${organizer}>`,
      to: [target.email],
      subject: `משמרת: ${target.event.summary}`,
      html: `<p>שלום ${target.personName},</p><p>שובצת למשמרת: <strong>${target.event.summary}</strong></p><p>${target.event.description ?? ""}</p><p>האירוע מצורף ליומן — Google Calendar יוסיף אותו אוטומטית.</p>`,
      attachments: [
        {
          filename: "invite.ics",
          content: Buffer.from(ics, "utf8").toString("base64"),
          content_type: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/** Send calendar invite emails for new/changed assignments on a published mission. */
export async function sendCalendarInvitesForMission(
  mission: MissionDay,
  previous: MissionDay | null = null,
): Promise<{ sent: number; skipped: boolean }> {
  if (mission.status !== "published") {
    return { sent: 0, skipped: true };
  }
  if (!resendConfigured()) {
    return { sent: 0, skipped: true };
  }

  const organizer = organizerEmail();
  if (!organizer) return { sent: 0, skipped: true };

  const supabase = await createClient();
  let peopleByName: Record<string, Person> = {};
  try {
    const people = await fetchActivePeople(supabase);
    peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  } catch {
    return { sent: 0, skipped: true };
  }

  const targets = inviteTargetsForMission(mission, previous, peopleByName);
  let sent = 0;
  for (const target of targets) {
    try {
      await sendInviteEmail(target, organizer);
      sent++;
    } catch (e) {
      console.error("[calendar-invite]", target.email, e);
    }
  }
  return { sent, skipped: false };
}

export function calendarEmailInvitesEnabled(): boolean {
  return resendConfigured();
}
