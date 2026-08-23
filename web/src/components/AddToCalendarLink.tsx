import { googleCalendarEventUrl } from "@/lib/calendar-google";
import type { CalendarEvent } from "@/lib/calendar-ics";

type Props = {
  event: CalendarEvent;
  className?: string;
  label?: string;
};

/** Opens Google Calendar with a pre-filled event — one click to save. */
export function AddToCalendarLink({
  event,
  className = "btn-sm shrink-0",
  label = "יומן",
}: Props) {
  return (
    <a
      href={googleCalendarEventUrl(event)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title="הוסף ל-Google Calendar"
    >
      {label}
    </a>
  );
}
