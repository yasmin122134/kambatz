import { describe, expect, it } from "vitest";
import { buildPeopleAdminPatch } from "@/lib/session";

describe("buildPeopleAdminPatch", () => {
  it("allows toggling active without clearing personal flags", () => {
    const result = buildPeopleAdminPatch(
      { id: "p1", active: false },
      { withFlags: true, withOfficer: true },
    );
    expect(result).toEqual({
      ok: true,
      patch: { active: false },
      flagsChanged: false,
    });
  });

  it("patches flags only when they are present in the body", () => {
    const result = buildPeopleAdminPatch(
      { id: "p1", no_guard: true, no_kitchen: false },
      { withFlags: true, withOfficer: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flagsChanged).toBe(true);
    expect(result.patch).toEqual({
      no_guard: true,
      no_standby: false,
      no_standing: false,
      no_base_work: false,
      no_kitchen: false,
    });
    expect(result.patch).not.toHaveProperty("active");
  });

  it("rejects an empty update", () => {
    const result = buildPeopleAdminPatch(
      { id: "p1" },
      { withFlags: true, withOfficer: true },
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "אין שדות לעדכון",
    });
  });
});
