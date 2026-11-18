import { describe, expect, it } from "vitest";
import { monthlyCharges, monthPeriod } from "./monthly-charges.js";

// Expected values are calculated by hand, see the comments.

describe("monthPeriod", () => {
  it("knows the length of each month", () => {
    expect(monthPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthPeriod("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("monthlyCharges", () => {
  const ongoing = { from: "2020-01-01", to: null };

  it("charges full amounts for a whole month", () => {
    const charges = monthlyCharges("2026-11", ongoing, [
      { kind: "base_rent", amountCents: 70000n, from: "2020-01-01", to: null },
      { kind: "operating_cost_advance", amountCents: 15000n, from: "2020-01-01", to: null },
    ]);
    expect(charges).toEqual([
      { kind: "base_rent", amountCents: 70000n, dueDate: "2026-11-01" },
      { kind: "operating_cost_advance", amountCents: 15000n, dueDate: "2026-11-01" },
    ]);
  });

  it("prorates a tenancy that starts in the month and is due on its first day", () => {
    // 15 to 28 February 2026 = 14 of 28 days: 700.00 * 14 / 28 = 350.00
    const charges = monthlyCharges("2026-02", { from: "2026-02-15", to: null }, [
      { kind: "base_rent", amountCents: 70000n, from: "2026-02-15", to: null },
    ]);
    expect(charges).toEqual([{ kind: "base_rent", amountCents: 35000n, dueDate: "2026-02-15" }]);
  });

  it("prorates a tenancy that ends in the month", () => {
    // 1 to 10 April 2026 = 10 of 30 days: 500.00 * 10 / 30 = 166.666… → 166.67
    // (allocate: 16666 r 20 and 33333 r 10 of 30; the left-over cent goes to the larger remainder)
    const charges = monthlyCharges("2026-04", { from: "2020-01-01", to: "2026-04-10" }, [
      { kind: "base_rent", amountCents: 50000n, from: "2020-01-01", to: null },
    ]);
    expect(charges).toEqual([{ kind: "base_rent", amountCents: 16667n, dueDate: "2026-04-01" }]);
  });

  it("splits a month with a rent change by days and rounds through allocate", () => {
    // March 2026 has 31 days. 800.00 for 1–10 March, 900.00 from 11 March.
    // 80000 * 10 / 31 = 25806.45 → 25806 (the other share 54193.55 has the larger remainder)
    // 90000 * 21 / 31 = 60967.74 → 60968 (larger remainder than 29032.26)
    // Sum: 86774
    const charges = monthlyCharges("2026-03", ongoing, [
      { kind: "base_rent", amountCents: 80000n, from: "2020-01-01", to: "2026-03-10" },
      { kind: "base_rent", amountCents: 90000n, from: "2026-03-11", to: null },
    ]);
    expect(charges).toEqual([{ kind: "base_rent", amountCents: 86774n, dueDate: "2026-03-01" }]);
  });

  it("charges nothing outside the tenancy and skips zero amounts", () => {
    const versions = [
      { kind: "base_rent" as const, amountCents: 70000n, from: "2026-05-01", to: null },
      { kind: "heating_cost_advance" as const, amountCents: 0n, from: "2026-05-01", to: null },
    ];
    expect(monthlyCharges("2026-04", { from: "2026-05-01", to: null }, versions)).toEqual([]);
    expect(monthlyCharges("2026-07", { from: "2026-05-01", to: "2026-06-30" }, versions)).toEqual([]);
    expect(monthlyCharges("2026-05", { from: "2026-05-01", to: null }, versions)).toHaveLength(1);
  });

  it("ignores rent components dated after the end of the tenancy", () => {
    // Tenancy ends 10 June 2026; a raise recorded from 15 June charges nothing.
    // 700.00 * 10 / 30 = 233.333… → 233.33 (remainder 10 of 30 against 20 of 30 for the other share)
    const charges = monthlyCharges("2026-06", { from: "2020-01-01", to: "2026-06-10" }, [
      { kind: "base_rent", amountCents: 70000n, from: "2020-01-01", to: "2026-06-14" },
      { kind: "base_rent", amountCents: 80000n, from: "2026-06-15", to: null },
    ]);
    expect(charges).toEqual([{ kind: "base_rent", amountCents: 23333n, dueDate: "2026-06-01" }]);
  });
});
