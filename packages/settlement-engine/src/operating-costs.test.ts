import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addMonths, settleOperatingCosts, type CostItem, type OperatingCostInput } from "./index.js";

const FIXTURES = new URL("../fixtures/", import.meta.url);

interface Fixture {
  title: string;
  reviewed: boolean;
  input: {
    period: { from: string; to: string };
    vacancyPersons: number;
    units: { id: string; areaCentiSqm: string }[];
    occupancies: { id: string; unitId: string; from: string; to: string | null; persons: number; advancesPaidCents: string }[];
    costs: (Omit<CostItem, "amountCents" | "consumptionByUnit"> & { amountCents: string; consumptionByUnit?: Record<string, string> })[];
  };
  expected: {
    periodDays: number;
    deadline: string;
    statements: { occupancyId: string; days: number; shares: Record<string, string>; totalCents: string; balanceCents: string; suggestedMonthlyAdvanceCents: string }[];
    landlord: { shares: Record<string, string>; totalCents: string };
  };
}

function toInput(fixture: Fixture): OperatingCostInput {
  const { input } = fixture;
  return {
    period: input.period,
    vacancyPersons: input.vacancyPersons,
    units: input.units.map((u) => ({ id: u.id, areaCentiSqm: BigInt(u.areaCentiSqm) })),
    occupancies: input.occupancies.map((o) => ({ ...o, advancesPaidCents: BigInt(o.advancesPaidCents) })),
    costs: input.costs.map((c) => ({
      ...c,
      amountCents: BigInt(c.amountCents),
      consumptionByUnit: c.consumptionByUnit && Object.fromEntries(Object.entries(c.consumptionByUnit).map(([k, v]) => [k, BigInt(v)])),
    })),
  };
}

const fixtures = readdirSync(FIXTURES)
  .filter((name) => name.startsWith("operating-costs-") && name.endsWith(".json"))
  .sort()
  .map((name) => ({ name, fixture: JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as Fixture }));

describe("operating cost fixtures", () => {
  it("are present", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2);
  });

  for (const { name, fixture } of fixtures) {
    it(`${name}: ${fixture.title}`, () => {
      const result = settleOperatingCosts(toInput(fixture));
      const strings = (shares: readonly { costId: string; shareCents: bigint }[]) => Object.fromEntries(shares.map((s) => [s.costId, s.shareCents.toString()]));

      expect(result.periodDays).toBe(fixture.expected.periodDays);
      expect(result.deadline).toBe(fixture.expected.deadline);
      expect(
        result.statements.map((s) => ({
          occupancyId: s.occupancyId,
          days: s.days,
          shares: strings(s.lines),
          totalCents: s.totalCents.toString(),
          balanceCents: s.balanceCents.toString(),
          suggestedMonthlyAdvanceCents: s.suggestedMonthlyAdvanceCents.toString(),
        })),
      ).toEqual(fixture.expected.statements);
      expect({ shares: strings(result.landlord.lines), totalCents: result.landlord.totalCents.toString() }).toEqual(fixture.expected.landlord);
    });

    it(`${name}: every cent of every cost is assigned exactly once`, () => {
      const input = toInput(fixture);
      const result = settleOperatingCosts(input);
      for (const cost of input.costs) {
        const tenants = result.statements.flatMap((s) => s.lines).filter((l) => l.costId === cost.id).reduce((sum, l) => sum + l.shareCents, 0n);
        const landlord = result.landlord.lines.find((l) => l.costId === cost.id)!.shareCents;
        expect(tenants + landlord, cost.id).toBe(cost.amountCents);
      }
    });
  }
});

describe("settleOperatingCosts", () => {
  const base: OperatingCostInput = {
    period: { from: "2025-01-01", to: "2025-12-31" },
    vacancyPersons: 0,
    units: [
      { id: "A", areaCentiSqm: 5000n },
      { id: "B", areaCentiSqm: 5000n },
    ],
    occupancies: [{ id: "T1", unitId: "A", from: "2020-01-01", to: null, persons: 2, advancesPaidCents: 0n }],
    costs: [{ id: "c1", category: "insurance", amountCents: 10_000n, key: "area" }],
  };

  it("lets the landlord bear a unit that is vacant all year", () => {
    const result = settleOperatingCosts(base);
    expect(result.statements[0]!.totalCents).toBe(5_000n);
    expect(result.landlord.totalCents).toBe(5_000n);
  });

  it("leaves out tenancies without a day in the period", () => {
    const result = settleOperatingCosts({
      ...base,
      occupancies: [...base.occupancies, { id: "old", unitId: "B", from: "2010-01-01", to: "2024-12-31", persons: 1, advancesPaidCents: 0n }],
    });
    expect(result.statements.map((s) => s.occupancyId)).toEqual(["T1"]);
  });

  it("accepts a period of exactly twelve months and rejects a longer one", () => {
    expect(settleOperatingCosts({ ...base, period: { from: "2024-07-01", to: "2025-06-30" } }).periodDays).toBe(365);
    expect(() => settleOperatingCosts({ ...base, period: { from: "2024-07-01", to: "2025-07-01" } })).toThrow(/twelve months/);
  });

  it("refuses to spread heating costs by a general key", () => {
    expect(() => settleOperatingCosts({ ...base, costs: [{ id: "h", category: "heating", amountCents: 1n, key: "area" }] })).toThrow(/heating cost statement/);
    expect(() => settleOperatingCosts({ ...base, costs: [{ id: "h", category: "hot_water", amountCents: 1n, key: "consumption", consumptionByUnit: { A: 1n, B: 1n } }] })).toThrow(/heating cost statement/);
  });

  it("explains a key that cannot spread anything", () => {
    const empty = { ...base, occupancies: [] };
    expect(() => settleOperatingCosts({ ...empty, costs: [{ id: "p", category: "street_cleaning_waste", amountCents: 100n, key: "persons" }] })).toThrow(/all weights are zero/);
    expect(() => settleOperatingCosts({ ...base, costs: [{ id: "w", category: "water_supply", amountCents: 100n, key: "consumption", consumptionByUnit: { A: 0n, B: 0n } }] })).toThrow(/all weights are zero/);
  });

  it("rejects incomplete or inconsistent input", () => {
    const withCost = (cost: CostItem) => () => settleOperatingCosts({ ...base, costs: [cost] });
    expect(withCost({ id: "w", category: "water_supply", amountCents: 1n, key: "consumption" })).toThrow(/needs consumption/);
    expect(withCost({ id: "w", category: "water_supply", amountCents: 1n, key: "consumption", consumptionByUnit: { A: 1n } })).toThrow(/no consumption for unit B/);
    expect(withCost({ id: "w", category: "water_supply", amountCents: 1n, key: "consumption", consumptionByUnit: { A: 1n, B: 1n, X: 1n } })).toThrow(/unknown unit X/);
    expect(withCost({ id: "d", category: "other", amountCents: 1n, key: "direct", directUnitId: "X" })).toThrow(/unit it belongs to/);
    expect(() => settleOperatingCosts({ ...base, units: [] })).toThrow(/at least one unit/);
    expect(() => settleOperatingCosts({ ...base, units: [base.units[0]!, base.units[0]!] })).toThrow(/unique/);
    expect(() => settleOperatingCosts({ ...base, costs: [base.costs[0]!, base.costs[0]!] })).toThrow(/unique/);
    expect(() => settleOperatingCosts({ ...base, vacancyPersons: 0.5 })).toThrow(/vacancyPersons/);
    expect(() => settleOperatingCosts({ ...base, occupancies: [{ ...base.occupancies[0]!, unitId: "X" }] })).toThrow(/unknown unit X/);
    expect(() =>
      settleOperatingCosts({ ...base, occupancies: [...base.occupancies, { id: "T2", unitId: "A", from: "2025-06-01", to: null, persons: 1, advancesPaidCents: 0n }] }),
    ).toThrow(/overlap/);
  });

  it("suggests no advance when the tenant's share is a credit", () => {
    const result = settleOperatingCosts({ ...base, costs: [{ id: "r", category: "insurance", amountCents: -10_000n, key: "area" }] });
    expect(result.statements[0]).toMatchObject({ totalCents: -5_000n, balanceCents: -5_000n, suggestedMonthlyAdvanceCents: 0n });
  });
});

describe("addMonths", () => {
  it("keeps the day of the month and clamps to the end of shorter months", () => {
    expect(addMonths("2025-12-31", 12)).toBe("2026-12-31");
    expect(addMonths("2025-06-15", 12)).toBe("2026-06-15");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2025-11-30", 3)).toBe("2026-02-28");
    expect(() => addMonths("2025-02-30", 1)).toThrow(RangeError);
  });
});
