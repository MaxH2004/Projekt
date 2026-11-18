import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema, type RentComponentKind } from "./master-data.js";

/** Calendar month YYYY-MM. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// --- Rent charges ---

export const chargeGenerateSchema = z.object({ month: monthSchema });

export interface RentCharge {
  readonly id: string;
  readonly tenancyId: string;
  /** Month the charge is for, YYYY-MM. */
  readonly month: string;
  readonly kind: RentComponentKind;
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
  /** Payments not yet allocated. */
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
  readonly paymentId: string | null;
  /** Tenancies the transaction probably belongs to, best first. Only for open incoming transactions. */
  readonly suggestions: readonly MatchSuggestion[];
}

export const bankTransactionBookSchema = z.object({
  tenancyId: idSchema,
  allocations: z.array(z.object({ chargeId: idSchema, amountCents: positiveCents })).max(500).optional(),
});

export const bankTransactionIgnoreSchema = z.object({ ignored: z.boolean() });
