import type { OperatingCostCategoryKey, SettlementConfig, SettlementResult, ShareBasis } from "@hv/contracts";
import { overlapDays, settleOperatingCosts, type CostItem, type OperatingCostInput } from "@hv/settlement-engine";
import { ApiError } from "../../common/api-error.js";

/** What the database holds for one property and period, before the user's choices. */
export interface SettlementData {
  readonly from: string;
  readonly to: string;
  readonly units: readonly { readonly id: string; readonly areaCentiSqm: number | null }[];
  readonly tenancies: readonly {
    readonly id: string;
    readonly unitId: string;
    readonly from: string;
    readonly to: string | null;
    readonly advancesPaidCents: bigint;
  }[];
  /** Allocable costs per category, heating already left out. */
  readonly costs: readonly { readonly category: OperatingCostCategoryKey; readonly amountCents: bigint }[];
}

/**
 * Checks the user's choices against the data, runs the engine and adds for
 * every share how it was derived. All calculation happens in the engine; this
 * only prepares its input and explains its output.
 */
export function settle(data: SettlementData, config: SettlementConfig): { input: OperatingCostInput; result: SettlementResult } {
  const period = { from: data.from, to: data.to };
  const tenancies = data.tenancies.filter((t) => overlapDays(period, t) > 0);
  if (data.costs.length === 0 || tenancies.length === 0) throw new ApiError("settlement_nothing_to_settle");

  const unitIds = new Set(data.units.map((u) => u.id));
  const costs: CostItem[] = data.costs.map((cost) => {
    const choice = config.keys[cost.category];
    if (!choice) throw new ApiError("settlement_key_missing", [`keys.${cost.category}`]);
    if (choice.key === "area") {
      const missing = data.units.filter((u) => u.areaCentiSqm === null).map((u) => `units.${u.id}`);
      if (missing.length) throw new ApiError("settlement_unit_area", missing);
    }
    if (choice.key === "direct" && (!choice.directUnitId || !unitIds.has(choice.directUnitId))) {
      throw new ApiError("settlement_key_missing", [`keys.${cost.category}.directUnitId`]);
    }
    return {
      id: cost.category,
      category: cost.category,
      amountCents: cost.amountCents,
      key: choice.key,
      ...(choice.key === "direct" ? { directUnitId: choice.directUnitId! } : {}),
    };
  });

  const usesPersons = costs.some((c) => c.key === "persons");
  if (usesPersons) {
    const missing = tenancies.filter((t) => config.personsByTenancy[t.id] === undefined).map((t) => `personsByTenancy.${t.id}`);
    if (config.vacancyPersons === null || config.vacancyPersons === undefined) missing.push("vacancyPersons");
    if (missing.length) throw new ApiError("settlement_persons_missing", missing);
  }

  const input: OperatingCostInput = {
    period,
    units: data.units.map((u) => ({ id: u.id, areaCentiSqm: BigInt(u.areaCentiSqm ?? 0) })),
    occupancies: tenancies.map((t) => ({
      id: t.id,
      unitId: t.unitId,
      from: t.from,
      to: t.to,
      persons: usesPersons ? config.personsByTenancy[t.id]! : 0,
      advancesPaidCents: t.advancesPaidCents,
    })),
    costs,
    vacancyPersons: usesPersons ? config.vacancyPersons! : 0,
  };

  // Weights for the explanation, the same the engine uses.
  const daysOf = new Map(tenancies.map((t) => [t.id, overlapDays(period, t)]));
  const periodDays = overlapDays(period, period);
  const totalArea = data.units.reduce((sum, u) => sum + (u.areaCentiSqm ?? 0), 0);
  const personDays = (t: (typeof tenancies)[number]) => input.occupancies.find((o) => o.id === t.id)!.persons * daysOf.get(t.id)!;
  const vacantDays = data.units.map((u) => periodDays - tenancies.filter((t) => t.unitId === u.id).reduce((sum, t) => sum + daysOf.get(t.id)!, 0));
  const totalPersonDays = tenancies.reduce((sum, t) => sum + personDays(t), 0) + vacantDays.reduce((sum, d) => sum + d * input.vacancyPersons, 0);
  if (usesPersons && totalPersonDays === 0) throw new ApiError("settlement_persons_missing", ["personsByTenancy"]);

  const engine = settleOperatingCosts(input);

  const basis = (cost: CostItem, tenancy: (typeof tenancies)[number]): ShareBasis => {
    const days = daysOf.get(tenancy.id)!;
    const unit = data.units.find((u) => u.id === tenancy.unitId)!;
    switch (cost.key) {
      case "area":
        return { key: "area", ownWeight: unit.areaCentiSqm!, totalWeight: totalArea, days, periodDays };
      case "units":
        return { key: "units", ownWeight: 1, totalWeight: data.units.length, days, periodDays };
      case "persons":
        return { key: "persons", ownWeight: personDays(tenancy), totalWeight: totalPersonDays, days, periodDays };
      default:
        return { key: "direct", ownWeight: cost.directUnitId === unit.id ? 1 : 0, totalWeight: 1, days, periodDays };
    }
  };

  const result: SettlementResult = {
    ruleSetId: engine.ruleSetId,
    periodDays: engine.periodDays,
    deadline: engine.deadline,
    costs: costs.map((c) => ({
      category: c.category,
      key: c.key as SettlementResult["costs"][number]["key"],
      amountCents: Number(c.amountCents),
      directUnitId: c.directUnitId ?? null,
    })),
    statements: engine.statements.map((s) => {
      const tenancy = tenancies.find((t) => t.id === s.occupancyId)!;
      return {
        tenancyId: s.occupancyId,
        unitId: s.unitId,
        days: s.days,
        lines: s.lines.map((l) => ({
          category: l.category,
          shareCents: Number(l.shareCents),
          basis: basis(costs.find((c) => c.id === l.costId)!, tenancy),
        })),
        totalCents: Number(s.totalCents),
        advancesPaidCents: Number(s.advancesPaidCents),
        balanceCents: Number(s.balanceCents),
      };
    }),
    landlordCents: Number(engine.landlord.totalCents),
  };
  return { input, result };
}
