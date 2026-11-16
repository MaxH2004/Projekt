import { describe, expect, it } from "vitest";
import { allocate, daysInclusive, overlapDays, resolveRuleSet, splitByOccupancy } from "./index.js";

const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("allocate", () => {
  it("splits without remainder when the amount divides evenly", () => {
    expect(allocate(1000n, [1n, 1n])).toEqual([500n, 500n]);
  });

  it("assigns leftover cents by largest remainder, ties to the earlier entry", () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    // 100 * 5/8 = 62.5 and 100 * 3/8 = 37.5: equal remainders, the first entry gets the cent
    expect(allocate(100n, [5n, 3n])).toEqual([63n, 37n]);
    // 10 * 2/3 = 6.67: the larger remainder wins although it comes later
    expect(allocate(10n, [1n, 2n])).toEqual([3n, 7n]);
  });

  it("always preserves the total", () => {
    const weights = [5437n, 7210n, 3150n, 9999n, 1n];
    for (const total of [1n, 99n, 123_457n, 98_765_432_101n]) {
      expect(sum(allocate(total, weights))).toBe(total);
    }
  });

  it("splits credits as the mirror image", () => {
    expect(allocate(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n]);
  });

  it("gives weight 0 no share", () => {
    expect(allocate(101n, [0n, 1n, 1n])).toEqual([0n, 51n, 50n]);
  });

  it("rejects invalid weights", () => {
    expect(() => allocate(100n, [])).toThrow(RangeError);
    expect(() => allocate(100n, [0n, 0n])).toThrow(RangeError);
    expect(() => allocate(100n, [1n, -1n])).toThrow(RangeError);
  });
});

describe("periods", () => {
  it("counts days including both bounds, also in a leap year", () => {
    expect(daysInclusive({ from: "2025-01-01", to: "2025-12-31" })).toBe(365);
    expect(daysInclusive({ from: "2024-01-01", to: "2024-12-31" })).toBe(366);
    expect(daysInclusive({ from: "2025-03-30", to: "2025-03-31" })).toBe(2);
  });

  it("rejects invalid dates", () => {
    expect(() => daysInclusive({ from: "2025-02-30", to: "2025-03-01" })).toThrow(RangeError);
    expect(() => daysInclusive({ from: "2025-03-02", to: "2025-03-01" })).toThrow(RangeError);
  });

  it("computes overlaps, also with an open end", () => {
    const year = { from: "2025-01-01", to: "2025-12-31" };
    expect(overlapDays(year, { from: "2024-06-01", to: "2025-01-31" })).toBe(31);
    expect(overlapDays(year, { from: "2025-12-01", to: null })).toBe(31);
    expect(overlapDays(year, { from: "2026-01-01", to: null })).toBe(0);
  });
});

describe("splitByOccupancy", () => {
  const year = { from: "2025-01-01", to: "2025-12-31" };

  it("separates tenant change and vacancy exact to the day", () => {
    // A until 31 March (90 days), vacancy in April (30 days), B from 1 May (245 days)
    const result = splitByOccupancy(36_500n, year, [
      { id: "A", from: "2020-01-01", to: "2025-03-31" },
      { id: "B", from: "2025-05-01", to: null },
    ]);
    expect(result.shares).toEqual([
      { id: "A", days: 90, amountCents: 9_000n },
      { id: "B", days: 245, amountCents: 24_500n },
    ]);
    expect(result.vacancy).toEqual({ days: 30, amountCents: 3_000n });
  });

  it("assigns a fully vacant year to the landlord", () => {
    const result = splitByOccupancy(12_345n, year, []);
    expect(result.vacancy).toEqual({ days: 365, amountCents: 12_345n });
  });

  it("preserves the total for uneven amounts", () => {
    const result = splitByOccupancy(10_001n, year, [
      { id: "A", from: "2025-01-01", to: "2025-07-14" },
      { id: "B", from: "2025-07-15", to: null },
    ]);
    const total = sum(result.shares.map((s) => s.amountCents)) + result.vacancy.amountCents;
    expect(total).toBe(10_001n);
    expect(result.vacancy.days).toBe(0);
  });

  it("rejects overlapping tenancies", () => {
    expect(() =>
      splitByOccupancy(100n, year, [
        { id: "A", from: "2025-01-01", to: "2025-06-30" },
        { id: "B", from: "2025-06-30", to: null },
      ]),
    ).toThrow(/overlap/);
  });
});

describe("resolveRuleSet", () => {
  it("picks the rule set by the start of the settlement period", () => {
    expect(resolveRuleSet("DE", "2025-01-01").id).toBe("de-2024-01");
  });

  it("reports periods without a rule set", () => {
    expect(() => resolveRuleSet("DE", "2019-01-01")).toThrow(RangeError);
  });
});
