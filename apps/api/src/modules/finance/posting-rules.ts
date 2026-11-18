import type { ChargeKind } from "@hv/contracts";

/**
 * Which account a business event books to, as codes of the SKR 04 rental
 * chart (packages/db/src/charts/skr04.ts). Not yet reviewed by a tax adviser,
 * see docs/BACKLOG.md.
 */
export const POSTING_ACCOUNTS = {
  bank: "180000",
  /** Expenses paid from the landlord's private money. */
  privateContribution: "218000",
  /** Payments not allocated to a charge: owed back to the tenant or kept for later charges. */
  tenantCredit: "350000",
  income: {
    // Every unit is treated as an apartment until units have a type of use.
    base_rent: "410500",
    operating_cost_advance: "410800",
    heating_cost_advance: "410800",
    settlement_balance: "410850",
  } satisfies Record<ChargeKind, string>,
} as const;

/**
 * Account a refund of a settlement credit books to: it reduces the income
 * from settlement payments (§ 21 EStG statement, see chart-of-accounts.md).
 */
export const SETTLEMENT_REFUND_ACCOUNT = "410850";

/** Accounts a bank transaction cannot be booked to directly: the bank itself and tenant receivables. */
export const NOT_FOR_OTHER_BOOKINGS: readonly string[] = ["180000", "120000"];

/** Expense accounts that are not paid in cash and therefore cannot be used for an expense. */
export const NON_CASH_EXPENSE_ACCOUNTS: readonly string[] = ["622100"];

/** Journal entry descriptions are keys the interface translates, never sentences. */
export const ENTRY_DESCRIPTION = {
  payment: "rent_payment",
  paymentReversal: "rent_payment_reversal",
  expense: "expense",
  expenseReversal: "expense_reversal",
  creditApplied: "tenant_credit_applied",
  creditApplicationReversal: "tenant_credit_applied_reversal",
  creditRefund: "tenant_credit_refund",
  creditRefundReversal: "tenant_credit_refund_reversal",
  otherBooking: "bank_booking",
  otherBookingReversal: "bank_booking_reversal",
} as const;
