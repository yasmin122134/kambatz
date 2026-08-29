import { describe, expect, it } from "vitest";
import { guardBandRows } from "@/lib/fairness-display";
import { getGuardBaseBurden } from "@/lib/guard-burden";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";

describe("guardBandRows", () => {
  it("matches getGuardBaseBurden for each 4h band", () => {
    const rules = DEFAULT_FAIRNESS_RULES;
    const bands = [
      ["00:00", "04:00"],
      ["04:00", "08:00"],
      ["08:00", "12:00"],
      ["12:00", "16:00"],
      ["16:00", "20:00"],
      ["20:00", "00:00"],
    ] as const;

    const rows = guardBandRows(rules);
    expect(rows).toHaveLength(6);

    rows.forEach((row, i) => {
      const [start, end] = bands[i];
      expect(row.solo).toBe(getGuardBaseBurden(start, end, 1, rules));
      expect(row.pair).toBe(getGuardBaseBurden(start, end, 2, rules));
    });
  });

  it("shows hourly-derived values (not legacy band scores)", () => {
    const rows = guardBandRows(DEFAULT_FAIRNESS_RULES);
    expect(rows[0].solo).toBe(5);
    expect(rows[0].pair).toBe(3.75);
    expect(rows[2].solo).toBe(4);
    expect(rows[2].pair).toBe(3);
  });
});
