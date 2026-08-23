import { describe, expect, it } from "vitest";
import {
  calendarFeedUrl,
  googleCalendarSubscribeUrl,
  signCalendarFeedToken,
  verifyCalendarFeedToken,
} from "@/lib/calendar-feed-token";

describe("calendar-feed-token", () => {
  it("signs and verifies person feed token", () => {
    const token = signCalendarFeedToken("person-123");
    expect(verifyCalendarFeedToken(token)).toBe("person-123");
    expect(verifyCalendarFeedToken("bad.token")).toBeNull();
  });

  it("builds google subscribe url from https feed", () => {
    const url = calendarFeedUrl("abc");
    expect(url).toContain("/api/calendar/feed/");
    const google = googleCalendarSubscribeUrl(url);
    expect(google).toContain("calendar.google.com");
    expect(google).toContain("webcal");
  });
});
