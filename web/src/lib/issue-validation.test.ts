import { describe, expect, it } from "vitest";
import { parseIssuePayload } from "@/lib/issue-validation";

describe("parseIssuePayload", () => {
  it("accepts valid payload", () => {
    const out = parseIssuePayload({
      constraint_date: "2026-03-01",
      start_time: "09:00",
      end_time: "11:00",
      issue_type: "exam",
      note: "מבחן",
    });
    expect(out).toEqual({
      constraint_date: "2026-03-01",
      start_time: "09:00",
      end_time: "11:00",
      issue_type: "exam",
      note: "מבחן",
    });
  });

  it("rejects missing note", () => {
    const out = parseIssuePayload({
      constraint_date: "2026-03-01",
      start_time: "09:00",
      end_time: "11:00",
      issue_type: "exam",
      note: "",
    });
    expect(out).toEqual({ error: "יש לכתוב הערה קצרה שמסבירה את החסימה" });
  });
});
