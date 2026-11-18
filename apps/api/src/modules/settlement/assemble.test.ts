import { describe, expect, it } from "vitest";
import { ApiError } from "../../common/api-error.js";
import { settle, type SettlementData } from "./assemble.js";

// Calculated by hand, see the comments. 2026 has 365 days; 1 July to
// 31 December are 184 days, 1 January to 30 June 181 days.
const data: SettlementData = {
  from: "2026-01-01",
  to: "2026-12-31",
  units: [
    { id: "A", areaCentiSqm: 6000 },
    { id: "B", areaCentiSqm: 4000 },
  ],
  tenancies: [
    { id: "T1", unitId: "A", from: "2020-01-01", to: null, advancesPaidCents: 60000n },
    { id: "T2", unitId: "B", from: "2026-07-01", to: null, advancesPaidCents: 30000n },
    { id: "OLD", unitId: "B", from: "2019-01-01", to: "2025-12-31", advancesPaidCents: 0n },
  ],
  costs: [
    { category: "insurance", amountCents: 100000n },
    { category: "street_cleaning_waste", amountCents: 36500n },
    { category: "water_supply", amountCents: 73000n },
  ],
};
const config = {
  propertyId: "00000000-0000-4000-8000-000000000000",
  from: "2026-01-01",
  to: "2026-12-31",
  keys: { insurance: { key: "area" as const }, street_cleaning_waste: { key: "units" as const }, water_supply: { key: "persons" as const } },
  personsByTenancy: { T1: 2, T2: 1 },
  vacancyPersons: 1,
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ApiError ? err.getResponse() : err;
  }
  return undefined;
};

describe("settle", () => {
  it("settles by area, units and persons with vacancy and a move-in", () => {
    const { result } = settle(data, config);
    const t1 = result.statements.find((s) => s.tenancyId === "T1")!;
    const t2 = result.statements.find((s) => s.tenancyId === "T2")!;

    // Insurance 1000.00 by area 60:40 → A 600.00, B 400.00.
    //   B: 400.00 × 184/365 = 201.6438 → 201.64 for T2, 198.36 vacancy (larger remainder gets the cent).
    // Waste 365.00 by units → 182.50 each; B: 182.50 × 184/365 = 92.00 for T2, 90.50 vacancy.
    // Water 730.00 by person-days: T1 2 × 365 = 730, T2 1 × 184 = 184, vacant B 1 × 181 = 181; total 1095.
    //   T1 486.666… → 486.67, T2 122.666… → 122.67, vacancy 120.666… → 120.66
    //   (equal remainders; the two left-over cents go to the earlier entries T1 and T2).
    expect(t1.lines.map((l) => [l.category, l.shareCents])).toEqual([
      ["insurance", 60000],
      ["street_cleaning_waste", 18250],
      ["water_supply", 48667],
    ]);
    expect(t2.lines.map((l) => [l.category, l.shareCents])).toEqual([
      ["insurance", 20164],
      ["street_cleaning_waste", 9200],
      ["water_supply", 12267],
    ]);
    // T1: 600.00 + 182.50 + 486.67 = 1269.17, minus 600.00 advances = 669.17 to pay.
    expect([t1.totalCents, t1.advancesPaidCents, t1.balanceCents]).toEqual([126917, 60000, 66917]);
    // T2: 201.64 + 92.00 + 122.67 = 416.31, minus 300.00 = 116.31 to pay.
    expect([t2.totalCents, t2.days, t2.balanceCents]).toEqual([41631, 184, 11631]);
    // Landlord: 198.36 + 90.50 + 120.66 = 409.52; all three add up to 2095.00.
    expect(result.landlordCents).toBe(40952);
    expect(t1.totalCents + t2.totalCents + result.landlordCents).toBe(209500);

    // The tenancy that ended before the period is not part of it.
    expect(result.statements.map((s) => s.tenancyId)).toEqual(["T1", "T2"]);
    expect(result.deadline).toBe("2027-12-31");
  });

  it("explains each share with the weights used", () => {
    const t2 = settle(data, config).result.statements.find((s) => s.tenancyId === "T2")!;
    expect(t2.lines.map((l) => l.basis)).toEqual([
      { key: "area", ownWeight: 4000, totalWeight: 10000, days: 184, periodDays: 365 },
      { key: "units", ownWeight: 1, totalWeight: 2, days: 184, periodDays: 365 },
      { key: "persons", ownWeight: 184, totalWeight: 1095, days: 184, periodDays: 365 },
    ]);
  });

  it("names what is missing instead of guessing", () => {
    expect(code(() => settle(data, { ...config, keys: { insurance: { key: "area" }, water_supply: { key: "units" } } }))).toEqual({
      code: "settlement_key_missing",
      fields: ["keys.street_cleaning_waste"],
    });
    expect(code(() => settle({ ...data, units: [data.units[0]!, { id: "B", areaCentiSqm: null }] }, config))).toEqual({
      code: "settlement_unit_area",
      fields: ["units.B"],
    });
    expect(code(() => settle(data, { ...config, personsByTenancy: { T1: 2 }, vacancyPersons: null }))).toEqual({
      code: "settlement_persons_missing",
      fields: ["personsByTenancy.T2", "vacancyPersons"],
    });
    expect(code(() => settle(data, { ...config, keys: { ...config.keys, insurance: { key: "direct", directUnitId: "X" } } }))).toEqual({
      code: "settlement_key_missing",
      fields: ["keys.insurance.directUnitId"],
    });
    expect(code(() => settle({ ...data, costs: [] }, config))).toEqual({ code: "settlement_nothing_to_settle" });
  });

  it("needs no area or persons for keys that do not use them", () => {
    const noArea = { ...data, units: data.units.map((u) => ({ ...u, areaCentiSqm: null })) };
    const { result } = settle(noArea, { ...config, keys: { insurance: { key: "units" }, street_cleaning_waste: { key: "units" }, water_supply: { key: "direct", directUnitId: "A" } }, personsByTenancy: {}, vacancyPersons: null });
    // Water 730.00 directly to unit A, whose tenant T1 lived there all year.
    expect(result.statements.find((s) => s.tenancyId === "T1")!.lines.find((l) => l.category === "water_supply")!.shareCents).toBe(73000);
  });
});
