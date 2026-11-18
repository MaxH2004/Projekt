import { z } from "zod";
import { OPERATING_COST_CATEGORY_KEYS, type OperatingCostCategoryKey } from "./finance.js";
import { idSchema, isoDateSchema } from "./master-data.js";

/**
 * Keys the interface offers. `consumption` exists in the engine but needs
 * readings per unit, which the application does not collect yet.
 */
export const SETTLEMENT_KEYS = ["area", "units", "persons", "direct"] as const;
export type SettlementKey = (typeof SETTLEMENT_KEYS)[number];

/** Heating and hot water are settled under HeizkostenV and stay out of this settlement. */
export const HEATING_CATEGORY_KEYS: readonly OperatingCostCategoryKey[] = ["heating", "hot_water", "combined_heating_hot_water"];

const firstOfMonth = isoDateSchema.refine((d) => d.endsWith("-01"));
const lastOfMonth = isoDateSchema.refine((d) => {
  const next = new Date(`${d}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
});

/** A settlement covers whole months of one property. */
export const settlementPeriodSchema = z
  .object({ propertyId: idSchema, from: firstOfMonth, to: lastOfMonth })
  .refine((p) => p.from <= p.to, { path: ["to"] });

export const settlementConfigSchema = z
  .object({
    propertyId: idSchema,
    from: firstOfMonth,
    to: lastOfMonth,
    /** Key for every category that has costs in the period. */
    keys: z.partialRecord(z.enum(OPERATING_COST_CATEGORY_KEYS), z.object({ key: z.enum(SETTLEMENT_KEYS), directUnitId: idSchema.nullish() })),
    /** Persons per tenancy, needed for the `persons` key. */
    personsByTenancy: z.record(idSchema, z.number().int().min(0).max(99)).default({}),
    /** Persons a vacant unit counts as under the `persons` key. No default: the user decides. */
    vacancyPersons: z.number().int().min(0).max(99).nullish(),
  })
  .refine((p) => p.from <= p.to, { path: ["to"] });

export const settlementFinalizeSchema = settlementConfigSchema.and(z.object({ dueDate: isoDateSchema }));

export type SettlementConfig = z.infer<typeof settlementConfigSchema>;

export interface SettlementDraft {
  readonly propertyId: string;
  readonly from: string;
  readonly to: string;
  readonly periodDays: number;
  readonly units: readonly {
    readonly id: string;
    readonly label: string;
    /** Area valid for the whole period; null if none is recorded or it changes within the period. */
    readonly areaCentiSqm: number | null;
  }[];
  readonly tenancies: readonly {
    readonly id: string;
    readonly unitId: string;
    readonly days: number;
    /** Starting value for the persons key: recorded occupants, else the number of named tenants. */
    readonly tenantCount: number;
    /** Covered operating cost advances charged for months of the period. */
    readonly advancesPaidCents: number;
  }[];
  /** Allocable costs per category: expense lines of the property paid in the period. */
  readonly costs: readonly { readonly category: OperatingCostCategoryKey; readonly amountCents: number; readonly lineCount: number }[];
  /** Heating and hot water costs paid in the period, left out of this settlement. */
  readonly excluded: readonly { readonly category: OperatingCostCategoryKey; readonly amountCents: number }[];
}

/** How a tenancy's share of one cost was derived, for the statement. */
export interface ShareBasis {
  readonly key: SettlementKey;
  /** The tenancy's or unit's weight and the total: area in centi-m², units, person-days. */
  readonly ownWeight: number;
  readonly totalWeight: number;
  /** Days of the tenancy in the period and days of the period; not used by `persons`, which counts days itself. */
  readonly days: number;
  readonly periodDays: number;
}

export interface SettlementResult {
  readonly ruleSetId: string;
  readonly periodDays: number;
  /** Last day the statement can reach the tenant in time. */
  readonly deadline: string;
  readonly costs: readonly { readonly category: OperatingCostCategoryKey; readonly key: SettlementKey; readonly amountCents: number; readonly directUnitId: string | null }[];
  readonly statements: readonly {
    readonly tenancyId: string;
    readonly unitId: string;
    readonly days: number;
    readonly lines: readonly { readonly category: OperatingCostCategoryKey; readonly shareCents: number; readonly basis: ShareBasis }[];
    readonly totalCents: number;
    readonly advancesPaidCents: number;
    /** Positive: the tenant owes it. Negative: the tenant gets it back. */
    readonly balanceCents: number;
  }[];
  /** Shares of vacant units and days, borne by the landlord. */
  readonly landlordCents: number;
}

export interface Settlement {
  readonly id: string;
  readonly propertyId: string;
  readonly from: string;
  readonly to: string;
  readonly dueDate: string;
  readonly createdAt: string;
  readonly result: SettlementResult;
  /** Charge created for each tenancy that owes a balance. */
  readonly chargeIds: Readonly<Record<string, string>>;
  /** Refund in force for each tenancy whose credit was paid out. */
  readonly refundIds: Readonly<Record<string, string>>;
  /** Cancelled settlements count for nothing; the period can be settled again. */
  readonly cancelled: boolean;
}

export interface SettlementSummary {
  readonly id: string;
  readonly propertyId: string;
  readonly from: string;
  readonly to: string;
  readonly createdAt: string;
  readonly statementCount: number;
  readonly cancelled: boolean;
}
