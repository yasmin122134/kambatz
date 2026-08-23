import { describe, expect, it } from "vitest";
import { buildPersonCalendarIcs, calendarEventsForPerson } from "@/lib/calendar-ics";
import { DEFAULT_MISSION_SCHEDULING_RULES, type MissionDay } from "@/lib/types";

describe("calendar-ics", () => {
  const mission: MissionDay = {
    id: "m1",
    title: "יום שמירות",
    mission_type: "guards",
    mission_date: "2026-03-01",
    starts_at: "2026-03-01T09:00:00+02:00",
    ends_at: "2026-03-02T09:00:00+02:00",
    status: "published",
    positions: [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        slots: [
          {
            id: "s1",
            start_time: "09:00",
            end_time: "13:00",
            seat_count: 1,
            starts_at: "2026-03-01T09:00:00+02:00",
            ends_at: "2026-03-01T13:00:00+02:00",
          },
        ],
      },
    ],
    assignments: { s1: ["יסמין חדד"] },
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "09:00" },
    notes: null,
    created_at: "",
    updated_at: "",
  };

  it("builds events for assigned person only", () => {
    const events = calendarEventsForPerson([mission], "יסמין חדד");
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain("פטל");
  });

  it("outputs valid ICS with UTC times for Google Calendar", () => {
    const ics = buildPersonCalendarIcs([mission], "יסמין חדד");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(ics).toContain("SUMMARY:");
    expect(ics).toContain("הגנם ועבס");
  });
});
