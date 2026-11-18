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
