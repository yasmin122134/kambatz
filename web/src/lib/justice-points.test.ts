import { describe, expect, it } from "vitest";
import { justicePoints, formatJusticePoints } from "@/lib/justice-points";

describe("justicePoints", () => {
  it("prefers fairnessPoints from burden", () => {
    expect(
      justicePoints({ fairnessPoints: 5.5, totalBurden: 5.5 }, 99),
    ).toBe(5.5);
  });

  it("falls back to periodPoints", () => {
    expect(justicePoints(undefined, 3.2)).toBe(3.2);
  });

  it("formats to one decimal", () => {
    expect(formatJusticePoints(4)).toBe("4.0");
    expect(formatJusticePoints(4.25)).toBe("4.3");
  });
});
