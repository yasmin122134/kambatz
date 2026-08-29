import { describe, expect, it } from "vitest";
import { buildBurdenHistogram } from "@/lib/burden-distribution";

describe("buildBurdenHistogram", () => {
  it("groups assigned cadets into bins and idle into zero bucket", () => {
    const roster = [
      { personName: "א", fairnessPoints: 0 },
      { personName: "ב", fairnessPoints: 4 },
      { personName: "ג", fairnessPoints: 5 },
      { personName: "ד", fairnessPoints: 8 },
    ];
    const summary = buildBurdenHistogram(roster);
    expect(summary.idleCount).toBe(1);
    expect(summary.assignedCount).toBe(3);
    expect(summary.bins[0]).toMatchObject({ label: "0", count: 1 });
    expect(summary.mean).toBeGreaterThan(0);
    expect(summary.maxCount).toBeGreaterThan(0);
  });

  it("marks highlight bin", () => {
    const roster = [
      { personName: "א", fairnessPoints: 2 },
      { personName: "ב", fairnessPoints: 6 },
    ];
    const summary = buildBurdenHistogram(roster, { highlightName: "ב" });
    const highlighted = summary.bins.find((b) => b.includesHighlight);
    expect(highlighted?.names).toContain("ב");
  });

  it("shows zero bin when everyone is idle", () => {
    const summary = buildBurdenHistogram([
      { personName: "א", fairnessPoints: 0 },
    ]);
    expect(summary.assignedCount).toBe(0);
    expect(summary.bins).toHaveLength(1);
    expect(summary.bins[0]).toMatchObject({ label: "0", count: 1 });
  });
});
