import type { RentComponentKind } from "@hv/contracts";

/**
 * Which account a business event books to, as codes of the SKR 04 rental
 * chart (packages/db/src/charts/skr04.ts). Not yet reviewed by a tax adviser,
 * see docs/BACKLOG.md.
 */
export const POSTING_ACCOUNTS = {
  bank: "180000",
  /** Payments not allocated to a charge: owed back to the tenant or kept for later charges. */
  tenantCredit: "350000",
  income: {
    // Every unit is treated as an apartment until units have a type of use.
    base_rent: "410500",
    operating_cost_advance: "410800",
    heating_cost_advance: "410800",
  } satisfies Record<RentComponentKind, string>,
} as const;

/** Journal entry descriptions are keys the interface translates, never sentences. */
export const ENTRY_DESCRIPTION = {
  payment: "rent_payment",
  paymentReversal: "rent_payment_reversal",
} as const;
