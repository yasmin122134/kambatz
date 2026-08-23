import { AddToCalendarLink } from "@/components/AddToCalendarLink";
import type { CalendarEvent } from "@/lib/calendar-ics";

export type CalendarPreviewEvent = {
  uid: string;
  summary: string;
  event: CalendarEvent;
};

export type CalendarPreview = {
  count: number;
  events: CalendarPreviewEvent[];
};

type Props = {
  preview: CalendarPreview;
};

export function CalendarAutoSync({ preview }: Props) {
  if (preview.count === 0) {
    return (
      <p className="hint text-xs text-center">
        אין משמרות בלוח שפורסם. כשייפורסם לוח ותהיי משובצת — יופיע כאן כפתור
        «יומן» לכל משמרת.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-bone2 pt-4">
      <p className="font-display text-base text-center">יומן — הגנם ועבס</p>
      <p className="hint text-xs text-center">
        {preview.count} משמרות · לחצי «יומן» — Google Calendar יפתח עם האירוע המוכן,
        לחצי «שמור»
      </p>

      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {preview.events.map((item) => (
          <li
            key={item.uid}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="truncate">{item.summary}</span>
            <AddToCalendarLink event={item.event} label="יומן" />
          </li>
        ))}
      </ul>
    </div>
  );
}
