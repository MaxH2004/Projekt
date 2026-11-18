import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema, type ChargeKind, type RentComponentKind } from "./master-data.js";

/** Calendar month YYYY-MM. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// --- Rent charges ---

export const chargeGenerateSchema = z.object({ month: monthSchema });

export interface RentCharge {
  readonly id: string;
  readonly tenancyId: string;
  /** Month the charge is for, YYYY-MM. */
  readonly month: string;
  readonly kind: ChargeKind;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly cancelled: boolean;
  /** Amount not yet covered by payments; 0 for a cancelled charge. */
  readonly openCents: number;
}

// --- Payments ---

const positiveCents = centsSchema.min(1);

export const paymentInputSchema = z
  .object({
    tenancyId: idSchema,
    receivedOn: isoDateSchema,
    amountCents: positiveCents,
    reference: z.string().trim().min(1).max(500).nullish(),
    /** Omit to cover the oldest open charges first. */
    allocations: z.array(z.object({ chargeId: idSchema, amountCents: positiveCents })).max(500).optional(),
  })
  .refine((p) => !p.allocations || new Set(p.allocations.map((a) => a.chargeId)).size === p.allocations.length, {
    path: ["allocations"],
  })
  .refine((p) => !p.allocations || p.allocations.reduce((sum, a) => sum + a.amountCents, 0) <= p.amountCents, {
    path: ["allocations"],
  });

export const paymentReverseSchema = z.object({ bookingDate: isoDateSchema });

export interface Payment {
  readonly id: string;
  readonly tenancyId: string;
  readonly receivedOn: string;
  readonly amountCents: number;
  readonly reference: string | null;
  readonly allocations: readonly { chargeId: string; amountCents: number }[];
  /** Part of the payment not allocated to a charge: credit of the tenancy. */
  readonly unallocatedCents: number;
  readonly reversed: boolean;
  /** Bank transaction the payment was booked from, if any. */
  readonly bankTransactionId: string | null;
}

export interface TenancyBalance {
  readonly tenancyId: string;
  /** Sum of all charges that are not cancelled. */
  readonly chargedCents: number;
  /** Sum of all payments that are not reversed. */
  readonly paidCents: number;
  /** Charges not yet covered. */
  readonly openCents: number;
  /** Payments not yet allocated, less what was paid back. */
  readonly creditCents: number;
}

// --- Bank import ---

/** Size limit of an uploaded statement in characters. */
export const BANK_STATEMENT_MAX_LENGTH = 1_500_000;

export const bankImportSchema = z.object({
  format: z.literal("camt053"),
  content: z.string().min(1).max(BANK_STATEMENT_MAX_LENGTH),
});

export interface BankImportResult {
  readonly accounts: readonly {
    readonly iban: string;
    readonly imported: number;
    /** Transactions that were imported before and were left as they are. */
    readonly duplicates: number;
    /** Entries that are not booked or not in euro. */
    readonly skipped: number;
  }[];
}

export const MATCH_REASONS = ["known_iban", "amount_matches", "name_matches"] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export interface MatchSuggestion {
  readonly tenancyId: string;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
}

export interface BankTransactionView {
  readonly id: string;
  readonly iban: string;
  readonly bookingDate: string;
  readonly valueDate: string | null;
  /** Positive = incoming, negative = outgoing. */
  readonly amountCents: number;
  readonly counterpartyName: string | null;
  readonly counterpartyIban: string | null;
  readonly remittanceInfo: string;
  readonly status: "open" | "booked" | "ignored";
  /** Rent payment booking an incoming transaction. */
  readonly paymentId: string | null;
  /** Expense booking an outgoing transaction. */
  readonly expenseId: string | null;
  /** Money paid back to a tenant. */
  readonly refundId: string | null;
  /** Booked directly to an account. */
  readonly otherBookingId: string | null;
  /** Tenancies the transaction probably belongs to, best first. Only for open incoming transactions. */
  readonly suggestions: readonly MatchSuggestion[];
}

export const bankTransactionBookSchema = z.object({
  tenancyId: idSchema,
  allocations: z.array(z.object({ chargeId: idSchema, amountCents: positiveCents })).max(500).optional(),
});

export const bankTransactionIgnoreSchema = z.object({ ignored: z.boolean() });

// --- Chart of accounts and expenses ---

export interface Account {
  /** Six-digit account number of the chart. */
  readonly code: string;
  readonly name: string;
  readonly type: "asset" | "liability" | "equity" | "income" | "expense";
  /** True for expense accounts that cash payments may book to. */
  readonly forExpenses: boolean;
}

/** Categories of § 2 BetrKV, the same keys as in the settlement engine. */
export const OPERATING_COST_CATEGORY_KEYS = [
  "public_charges",
  "water_supply",
  "drainage",
  "heating",
  "hot_water",
  "combined_heating_hot_water",
  "lift",
  "street_cleaning_waste",
  "building_cleaning_pest_control",
  "garden",
  "lighting",
  "chimney_cleaning",
  "insurance",
  "caretaker",
  "antenna_broadband",
  "laundry_facilities",
  "other",
] as const;
export type OperatingCostCategoryKey = (typeof OPERATING_COST_CATEGORY_KEYS)[number];

export const expenseLineSchema = z.object({
  accountCode: z.string().regex(/^\d{6}$/),
  propertyId: idSchema,
  amountCents: positiveCents,
  /** Set when the line may go into an operating cost settlement. */
  operatingCostCategory: z.enum(OPERATING_COST_CATEGORY_KEYS).nullish(),
});

const expenseDetails = {
  vendor: z.string().trim().min(1).max(200).nullish(),
  description: z.string().trim().min(1).max(500).nullish(),
  lines: z.array(expenseLineSchema).min(1).max(50),
};

export const expenseInputSchema = z.object({
  paidOn: isoDateSchema,
  paidFrom: z.enum(["bank", "private"]),
  ...expenseDetails,
});

/** Booking an outgoing bank transaction: amount and date come from the transaction. */
export const bankTransactionExpenseSchema = z.object(expenseDetails);

export const expenseReverseSchema = z.object({ bookingDate: isoDateSchema });

export interface ExpenseLine {
  readonly accountCode: string;
  readonly propertyId: string;
  readonly amountCents: number;
  readonly operatingCostCategory: OperatingCostCategoryKey | null;
}

export interface Expense {
  readonly id: string;
  readonly paidOn: string;
  readonly amountCents: number;
  readonly paidFrom: "bank" | "private";
  readonly vendor: string | null;
  readonly description: string | null;
  readonly bankTransactionId: string | null;
  readonly reversed: boolean;
  readonly lines: readonly ExpenseLine[];
}

// --- Income and expenses per property ---

export const incomeStatementQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, { path: ["to"] });

export interface IncomeStatement {
  readonly from: string;
  readonly to: string;
  readonly properties: readonly {
    /** Null for bookings without a property. */
    readonly propertyId: string | null;
    readonly accounts: readonly { readonly code: string; readonly type: "income" | "expense"; readonly amountCents: number }[];
    readonly incomeCents: number;
    readonly expenseCents: number;
    /** Income minus expenses. */
    readonly resultCents: number;
  }[];
}

// --- Tenant credit ---

export const applyCreditSchema = z.object({ bookingDate: isoDateSchema });

export const CREDIT_REFUND_REASONS = ["overpayment", "settlement"] as const;
export type CreditRefundReason = (typeof CREDIT_REFUND_REASONS)[number];

/**
 * Paying money back to a tenant. For an overpayment the amount is chosen; for
 * a settlement credit it is the credit of that settlement and can be left out.
 */
export const creditRefundSchema = z
  .object({
    reason: z.enum(CREDIT_REFUND_REASONS),
    settlementId: idSchema.nullish(),
    amountCents: positiveCents.nullish(),
    paidOn: isoDateSchema,
  })
  .refine((r) => (r.reason === "settlement") === Boolean(r.settlementId), { path: ["settlementId"] })
  .refine((r) => r.reason === "settlement" || Boolean(r.amountCents), { path: ["amountCents"] });

export const bankTransactionRefundSchema = z
  .object({ tenancyId: idSchema, reason: z.enum(CREDIT_REFUND_REASONS), settlementId: idSchema.nullish() })
  .refine((r) => (r.reason === "settlement") === Boolean(r.settlementId), { path: ["settlementId"] });

export interface CreditRefund {
  readonly id: string;
  readonly tenancyId: string;
  readonly reason: CreditRefundReason;
  readonly settlementId: string | null;
  readonly amountCents: number;
  readonly paidOn: string;
  readonly bankTransactionId: string | null;
  readonly reversed: boolean;
}

/** Books a bank transaction to an account directly: a deposit, a refund, a private transfer. */
export const bankTransactionOtherSchema = z.object({
  accountCode: z.string().regex(/^\d{6}$/),
  propertyId: idSchema.nullish(),
  description: z.string().trim().min(1).max(500).nullish(),
});

// --- Deadlines ---

export type Deadline =
  | {
      readonly kind: "settlement_due";
      readonly date: string;
      readonly propertyId: string;
      /** Calendar year to settle; the overview assumes calendar-year periods. */
      readonly year: number;
    }
  | { readonly kind: "tenancy_end"; readonly date: string; readonly tenancyId: string }
  | { readonly kind: "rent_change"; readonly date: string; readonly tenancyId: string; readonly component: RentComponentKind; readonly amountCents: number };
