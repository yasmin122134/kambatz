import { describe, expect, it, vi } from "vitest";
import {
  formatCalendarInviteMessage,
  isTestResendSender,
  resendErrorHint,
} from "@/lib/calendar-invites";

describe("calendar-invites messaging", () => {
  it("detects test sender when CALENDAR_FROM_EMAIL unset", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CALENDAR_FROM_EMAIL", "");
    expect(isTestResendSender()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("hints sandbox restriction from Resend 403", () => {
    const hint = resendErrorHint([
      "a@b.com: Resend 403: You can only send testing emails to your own email address",
    ]);
    expect(hint).toMatch(/Resend במצב בדיקה/);
  });

  it("formats total failure with hint", () => {
    const msg = formatCalendarInviteMessage({
      sent: 0,
      people: 53,
      events: 133,
      skipped: false,
      missingEmail: [],
      errors: [
        "x@y.com: Resend 403: You can only send testing emails to your own email address",
      ],
    });
    expect(msg).toMatch(/הזמנות לא נשלחו/);
    expect(msg).toMatch(/53/);
    expect(msg).toMatch(/Resend במצב בדיקה/);
  });
});
