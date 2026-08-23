import { describe, expect, it } from "vitest";
import { googleCalendarEventUrl } from "@/lib/calendar-google";

describe("calendar-google", () => {
  it("builds Google Calendar template URL", () => {
    const url = googleCalendarEventUrl({
      uid: "x@kambatz",
      startMs: Date.parse("2026-03-01T07:00:00.000Z"),
      endMs: Date.parse("2026-03-01T11:00:00.000Z"),
      summary: "פטל — שמירות",
      description: "יום שמירות",
    });
    expect(url).toContain("calendar.google.com");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("20260301T070000Z");
  });
});
