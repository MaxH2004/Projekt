import { allocate } from "./allocation.js";
import { splitByOccupancy } from "./occupancy.js";
import { addMonths, daysInclusive, overlapDays, toDayNumber, type IsoDate, type Period } from "./period.js";
import { resolveRuleSet } from "./rules/index.js";

/**
 * Operating cost categories with their number in § 2 BetrKV.
 * See docs/domain-rules/operating-costs.md.
 */
export const OPERATING_COST_CATEGORIES = {
  public_charges: 1,
  water_supply: 2,
  drainage: 3,
  heating: 4,
  hot_water: 5,
  combined_heating_hot_water: 6,
  lift: 7,
  street_cleaning_waste: 8,
  building_cleaning_pest_control: 9,
  garden: 10,
  lighting: 11,
  chimney_cleaning: 12,
  insurance: 13,
  caretaker: 14,
  antenna_broadband: 15,
  laundry_facilities: 16,
  other: 17,
} as const;
export type OperatingCostCategory = keyof typeof OPERATING_COST_CATEGORIES;

/** Heating and hot water follow HeizkostenV, which this module does not implement. */
const HEATING_CATEGORIES: readonly OperatingCostCategory[] = ["heating", "hot_water", "combined_heating_hot_water"];

/**
 * How a cost is spread over the units.
 * - area: by floor area
 * - units: equal share per unit
 * - persons: by persons and days of occupancy
 * - consumption: by metered consumption per unit
 * - direct: the whole amount belongs to one unit
 */
export type AllocationKey = "area" | "units" | "persons" | "consumption" | "direct";

export interface SettlementUnit {
  readonly id: string;
  /** Floor area in hundredths of a square metre. */
  readonly areaCentiSqm: bigint;
}

export interface SettlementOccupancy {
  /** Id of the tenancy. */
  readonly id: string;
  readonly unitId: string;
  readonly from: IsoDate;
  readonly to: IsoDate | null;
  /** Persons living in the unit; used by the `persons` key. */
  readonly persons: number;
  /** Advance payments made for the settlement period. */
  readonly advancesPaidCents: bigint;
}

export interface CostItem {
  readonly id: string;
  readonly category: OperatingCostCategory;
  /** Total for the whole building. Negative for a refund. */
  readonly amountCents: bigint;
  readonly key: AllocationKey;
  /** For `consumption`: metered consumption per unit id, in the meter's smallest unit. */
  readonly consumptionByUnit?: Readonly<Record<string, bigint>>;
  /** For `direct`: the unit that bears the cost. */
  readonly directUnitId?: string;
}

export interface OperatingCostInput {
  /** At most twelve months. */
  readonly period: Period;
  /** All units of the building, including vacant ones. */
  readonly units: readonly SettlementUnit[];
  readonly occupancies: readonly SettlementOccupancy[];
  /** Only costs that may be passed on; anything else must be left out by the caller. */
  readonly costs: readonly CostItem[];
  /**
   * Persons a vacant unit counts as under the `persons` key. There is no
   * default: with 0 the tenants bear the vacancy's share, which is disputed.
   */
  readonly vacancyPersons: number;
}

export interface StatementLine {
  readonly costId: string;
  readonly category: OperatingCostCategory;
  readonly key: AllocationKey;
  readonly shareCents: bigint;
}

export interface OccupancyStatement {
  readonly occupancyId: string;
  readonly unitId: string;
  /** Days of the tenancy inside the settlement period. */
  readonly days: number;
  readonly lines: readonly StatementLine[];
  readonly totalCents: bigint;
  readonly advancesPaidCents: bigint;
  /** Positive: the tenant owes this amount. Negative: the tenant gets it back. */
  readonly balanceCents: bigint;
  /** Share projected to twelve months, per month. A suggestion, not a claim. */
  readonly suggestedMonthlyAdvanceCents: bigint;
}

export interface OperatingCostResult {
  readonly ruleSetId: string;
  readonly periodDays: number;
  /** Last day on which the statement can still reach the tenant in time (§ 556 (3) BGB). */
  readonly deadline: IsoDate;
  readonly statements: readonly OccupancyStatement[];
  /** Shares for vacant days; the landlord bears them. */
  readonly landlord: { readonly lines: readonly { costId: string; shareCents: bigint }[]; readonly totalCents: bigint };
}

/**
 * Settles the operating costs of one building for one period.
 * Every cent of every cost ends up either with a tenancy or with the landlord.
 */
export function settleOperatingCosts(input: OperatingCostInput): OperatingCostResult {
  const { period, units, costs } = input;
  const periodDays = daysInclusive(period);
  if (toDayNumber(period.to) >= toDayNumber(addMonths(period.from, 12))) {
    throw new RangeError("A settlement period must not be longer than twelve months");
  }
  if (units.length === 0) throw new RangeError("A settlement needs at least one unit");
  const unitIds = new Set(units.map((u) => u.id));
  if (unitIds.size !== units.length) throw new RangeError("Unit ids must be unique");
  if (!Number.isInteger(input.vacancyPersons) || input.vacancyPersons < 0) {
    throw new RangeError("vacancyPersons must be a whole number of 0 or more");
  }
  for (const o of input.occupancies) {
    if (!unitIds.has(o.unitId)) throw new RangeError(`Tenancy ${o.id} refers to unknown unit ${o.unitId}`);
    if (!Number.isInteger(o.persons) || o.persons < 0) throw new RangeError(`Tenancy ${o.id} needs a whole number of persons`);
  }
  if (new Set(costs.map((c) => c.id)).size !== costs.length) throw new RangeError("Cost ids must be unique");

  // Tenancies without a single day in the period are not part of the settlement.
  const occupancies = input.occupancies.filter((o) => overlapDays(period, o) > 0);
  const byUnit = new Map(units.map((u) => [u.id, occupancies.filter((o) => o.unitId === u.id)]));
  const daysOf = new Map(occupancies.map((o) => [o.id, overlapDays(period, o)]));
  // Also validates that tenancies of a unit do not overlap.
  const vacantDays = new Map(units.map((u) => [u.id, splitByOccupancy(0n, period, byUnit.get(u.id)!).vacancy.days]));

  const lines = new Map<string, StatementLine[]>(occupancies.map((o) => [o.id, []]));
  const landlordLines: { costId: string; shareCents: bigint }[] = [];

  for (const cost of costs) {
    if (HEATING_CATEGORIES.includes(cost.category) && cost.key !== "direct") {
      throw new RangeError(`Cost ${cost.id}: heating and hot water can only be taken over per unit from a heating cost statement (key "direct")`);
    }
    let landlordShare = 0n;
    const add = (occupancyId: string, shareCents: bigint) =>
      lines.get(occupancyId)!.push({ costId: cost.id, category: cost.category, key: cost.key, shareCents });

    if (cost.key === "persons") {
      const weights = [
        ...occupancies.map((o) => BigInt(o.persons) * BigInt(daysOf.get(o.id)!)),
        ...units.map((u) => BigInt(input.vacancyPersons) * BigInt(vacantDays.get(u.id)!)),
      ];
      const shares = allocateOrExplain(cost, weights);
      occupancies.forEach((o, i) => add(o.id, shares[i]!));
      landlordShare = shares.slice(occupancies.length).reduce((a, b) => a + b, 0n);
    } else {
      const unitShares = allocateOrExplain(cost, unitWeights(cost, units, unitIds));
      units.forEach((unit, i) => {
        const split = splitByOccupancy(unitShares[i]!, period, byUnit.get(unit.id)!);
        for (const share of split.shares) add(share.id, share.amountCents);
        landlordShare += split.vacancy.amountCents;
      });
    }
    landlordLines.push({ costId: cost.id, shareCents: landlordShare });
  }

  const statements = occupancies.map((o): OccupancyStatement => {
    const own = lines.get(o.id)!;
    const totalCents = own.reduce((sum, line) => sum + line.shareCents, 0n);
    const days = daysOf.get(o.id)!;
    return {
      occupancyId: o.id,
      unitId: o.unitId,
      days,
      lines: own,
      totalCents,
      advancesPaidCents: o.advancesPaidCents,
      balanceCents: totalCents - o.advancesPaidCents,
      suggestedMonthlyAdvanceCents: suggestAdvance(totalCents, days, periodDays),
    };
  });

  return {
    ruleSetId: resolveRuleSet("DE", period.from).id,
    periodDays,
    deadline: addMonths(period.to, 12),
    statements,
    landlord: { lines: landlordLines, totalCents: landlordLines.reduce((sum, line) => sum + line.shareCents, 0n) },
  };
}

function unitWeights(cost: CostItem, units: readonly SettlementUnit[], unitIds: ReadonlySet<string>): bigint[] {
  switch (cost.key) {
    case "area":
      return units.map((u) => {
        if (u.areaCentiSqm <= 0n) throw new RangeError(`Unit ${u.id} has no area, needed for cost ${cost.id}`);
        return u.areaCentiSqm;
      });
    case "units":
      return units.map(() => 1n);
    case "consumption": {
      const consumption = cost.consumptionByUnit;
      if (!consumption) throw new RangeError(`Cost ${cost.id} needs consumption per unit`);
      for (const id of Object.keys(consumption)) {
        if (!unitIds.has(id)) throw new RangeError(`Cost ${cost.id} has consumption for unknown unit ${id}`);
      }
      return units.map((u) => {
        const value = consumption[u.id];
        if (value === undefined) throw new RangeError(`Cost ${cost.id} has no consumption for unit ${u.id}`);
        return value;
      });
    }
    case "direct":
      if (!cost.directUnitId || !unitIds.has(cost.directUnitId)) throw new RangeError(`Cost ${cost.id} needs the unit it belongs to`);
      return units.map((u) => (u.id === cost.directUnitId ? 1n : 0n));
    case "persons":
      throw new Error("unreachable");
  }
}

function allocateOrExplain(cost: CostItem, weights: readonly bigint[]): bigint[] {
  if (weights.every((w) => w === 0n)) {
    throw new RangeError(`Cost ${cost.id} cannot be spread by "${cost.key}": all weights are zero`);
  }
  return allocate(cost.amountCents, weights);
}

/** Share projected to a full period, divided by twelve, rounded half up; never negative. */
function suggestAdvance(totalCents: bigint, days: number, periodDays: number): bigint {
  if (totalCents <= 0n) return 0n;
  const numerator = totalCents * BigInt(periodDays);
  const denominator = BigInt(days) * 12n;
  return (numerator * 2n + denominator) / (denominator * 2n);
}
