import { Injectable } from "@nestjs/common";
import { CHARGE_KINDS, type ChargeKind, type CreditRefund, type CreditRefundReason } from "@hv/contracts";
import { postJournalEntry, reverseJournalEntry } from "@hv/db";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";
import { ENTRY_DESCRIPTION, POSTING_ACCOUNTS, SETTLEMENT_REFUND_ACCOUNT } from "./posting-rules.js";

/**
 * Credit of a tenancy: what payments in force did not cover, less overpayments
 * paid back. Settlement credits are separate; they come from a statement.
 */
export const CREDIT = `(
  (SELECT coalesce(sum(p.amount_cents - coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = p.id), 0)), 0)
   FROM payment p WHERE p.tenancy_id = t.id AND p.reversal_entry_id IS NULL)
  - (SELECT coalesce(sum(r.amount_cents), 0) FROM credit_refund r
     WHERE r.tenancy_id = t.id AND r.reason = 'overpayment' AND r.reversal_entry_id IS NULL))`;

const OPEN = `c.amount_cents - coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
  WHERE a.charge_id = c.id AND p.reversal_entry_id IS NULL), 0)`;

export interface RefundInput {
  tenancyId: string;
  reason: CreditRefundReason;
  settlementId?: string | null;
  amountCents?: number | null;
  paidOn: string;
  bankTransactionId?: string;
}

const REFUND = `r.id, r.tenancy_id AS "tenancyId", r.reason, r.settlement_id AS "settlementId", r.amount_cents::int AS "amountCents",
  r.paid_on::text AS "paidOn", r.bank_transaction_id AS "bankTransactionId", r.reversal_entry_id IS NOT NULL AS reversed`;

@Injectable()
export class CreditService {
  constructor(private readonly db: TenantDb) {}

  /**
   * Covers open charges of the tenancy, oldest first, with its credit. For each
   * payment whose credit is used, one entry moves the amount from tenant
   * credit to income. Returns the amount applied.
   */
  applyCredit(tenantId: string, tenancyId: string, bookingDate: string): Promise<{ appliedCents: number }> {
    return this.db.run(tenantId, async (c) => {
      const tenancy = await lockTenancy(c, tenancyId);
      let available = tenancy.creditCents;
      if (available <= 0) return { appliedCents: 0 };

      const charges = (
        await c.query<{ id: string; kind: ChargeKind; open: string }>(
          `SELECT c.id, c.kind, (${OPEN})::text AS open FROM rent_charge c
           WHERE c.tenancy_id = $1 AND c.cancelled_at IS NULL
           ORDER BY c.due_date, c.period_month, array_position($2::text[], c.kind), c.id FOR UPDATE OF c`,
          [tenancyId, CHARGE_KINDS],
        )
      ).rows.map((ch) => ({ ...ch, open: Number(ch.open) })).filter((ch) => ch.open > 0);
      const payments = (
        await c.query<{ id: string; unallocated: string }>(
          `SELECT p.id, (p.amount_cents - coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = p.id), 0))::text AS unallocated
           FROM payment p WHERE p.tenancy_id = $1 AND p.reversal_entry_id IS NULL ORDER BY p.received_on, p.created_at, p.id FOR UPDATE`,
          [tenancyId],
        )
      ).rows.map((p) => ({ id: p.id, left: Number(p.unallocated) })).filter((p) => p.left > 0);

      // Pair charges with payment credit, oldest of each first, up to the available credit.
      const byPayment = new Map<string, { chargeId: string; kind: ChargeKind; amountCents: number }[]>();
      for (const charge of charges) {
        for (const payment of payments) {
          if (charge.open === 0 || available === 0) break;
          const take = Math.min(charge.open, payment.left, available);
          if (take === 0) continue;
          byPayment.set(payment.id, [...(byPayment.get(payment.id) ?? []), { chargeId: charge.id, kind: charge.kind, amountCents: take }]);
          charge.open -= take;
          payment.left -= take;
          available -= take;
        }
      }

      const accounts = await accountIds(c, [POSTING_ACCOUNTS.tenantCredit, ...Object.values(POSTING_ACCOUNTS.income)]);
      let applied = 0;
      for (const [paymentId, allocations] of byPayment) {
        const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
        const income = new Map<string, number>();
        for (const a of allocations) income.set(POSTING_ACCOUNTS.income[a.kind], (income.get(POSTING_ACCOUNTS.income[a.kind]) ?? 0) + a.amountCents);
        const entryId = await postJournalEntry(c, tenantId, {
          bookingDate,
          description: ENTRY_DESCRIPTION.creditApplied,
          lines: [
            { accountId: accounts.get(POSTING_ACCOUNTS.tenantCredit)!, amountCents: BigInt(total), propertyId: tenancy.propertyId },
            ...[...income].map(([code, cents]) => ({ accountId: accounts.get(code)!, amountCents: -BigInt(cents), propertyId: tenancy.propertyId })),
          ],
        });
        for (const a of allocations) {
          await c.query(
            `INSERT INTO payment_allocation (tenant_id, tenancy_id, payment_id, charge_id, amount_cents, journal_entry_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenantId, tenancyId, paymentId, a.chargeId, a.amountCents, entryId],
          );
        }
        applied += total;
      }
      await c.query("SET CONSTRAINTS payment_allocation_within_amounts IMMEDIATE");
      return { appliedCents: applied };
    });
  }

  /**
   * Pays money back to a tenant from the bank: an overpayment against tenant
   * credit, or a settlement credit against settlement income.
   */
  refund(tenantId: string, input: RefundInput): Promise<CreditRefund> {
    return this.db.run(tenantId, async (c) => {
      const tenancy = await lockTenancy(c, input.tenancyId);
      let amount: number;
      let debitCode: string;
      if (input.reason === "overpayment") {
        amount = input.amountCents ?? 0;
        if (amount > tenancy.creditCents) throw new ApiError("credit_insufficient", ["amountCents"]);
        debitCode = POSTING_ACCOUNTS.tenantCredit;
      } else {
        const statement = found(
          (
            await c.query<{ balance: string }>(
              `SELECT st.balance_cents::text AS balance FROM settlement_statement st JOIN settlement s ON s.id = st.settlement_id
               WHERE st.settlement_id = $1 AND st.tenancy_id = $2 AND s.cancelled_at IS NULL FOR SHARE OF s`,
              [input.settlementId, input.tenancyId],
            )
          ).rows[0],
        );
        amount = -Number(statement.balance);
        if (amount <= 0) throw new ApiError("credit_insufficient", ["settlementId"]);
        if (input.amountCents && input.amountCents !== amount) throw new ApiError("validation_failed", ["amountCents"]);
        debitCode = SETTLEMENT_REFUND_ACCOUNT;
      }
      const accounts = await accountIds(c, [debitCode, POSTING_ACCOUNTS.bank]);
      const entryId = await postJournalEntry(c, tenantId, {
        bookingDate: input.paidOn,
        description: ENTRY_DESCRIPTION.creditRefund,
        lines: [
          { accountId: accounts.get(debitCode)!, amountCents: BigInt(amount), propertyId: tenancy.propertyId },
          { accountId: accounts.get(POSTING_ACCOUNTS.bank)!, amountCents: -BigInt(amount) },
        ],
      });
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO credit_refund (tenant_id, tenancy_id, reason, settlement_id, amount_cents, paid_on, bank_transaction_id, journal_entry_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tenantId, input.tenancyId, input.reason, input.settlementId ?? null, amount, input.paidOn, input.bankTransactionId ?? null, entryId],
        )
      ).rows[0]!.id;
      return found((await c.query<CreditRefund>(`SELECT ${REFUND} FROM credit_refund r WHERE r.id = $1`, [id])).rows[0]);
    });
  }

  reverseRefund(tenantId: string, id: string, bookingDate: string): Promise<CreditRefund> {
    return this.db.run(tenantId, async (c) => {
      const refund = found(
        (
          await c.query<{ entryId: string; paidOn: string; reversed: boolean }>(
            `SELECT journal_entry_id AS "entryId", paid_on::text AS "paidOn", reversal_entry_id IS NOT NULL AS reversed FROM credit_refund WHERE id = $1 FOR UPDATE`,
            [id],
          )
        ).rows[0],
      );
      if (refund.reversed) throw new ApiError("conflict");
      if (bookingDate < refund.paidOn) throw new ApiError("validation_failed", ["bookingDate"]);
      const reversal = await reverseJournalEntry(c, tenantId, refund.entryId, { bookingDate, description: ENTRY_DESCRIPTION.creditRefundReversal });
      await c.query("UPDATE credit_refund SET reversal_entry_id = $2 WHERE id = $1", [id, reversal]);
      return found((await c.query<CreditRefund>(`SELECT ${REFUND} FROM credit_refund r WHERE r.id = $1`, [id])).rows[0]);
    });
  }

  listRefunds(tenantId: string, tenancyId: string): Promise<CreditRefund[]> {
    return this.db.run(tenantId, async (c) => (await c.query<CreditRefund>(`SELECT ${REFUND} FROM credit_refund r WHERE r.tenancy_id = $1 ORDER BY r.paid_on, r.created_at`, [tenancyId])).rows);
  }
}

/** Serialises credit changes of one tenancy and returns its property and credit. */
export async function lockTenancy(c: pg.PoolClient, tenancyId: string): Promise<{ propertyId: string; creditCents: number }> {
  const row = found(
    (
      await c.query<{ propertyId: string; credit: string }>(
        `SELECT b.property_id AS "propertyId", ${CREDIT}::text AS credit FROM tenancy t
         JOIN unit u ON u.id = t.unit_id JOIN building b ON b.id = u.building_id
         WHERE t.id = $1 FOR UPDATE OF t`,
        [tenancyId],
      )
    ).rows[0],
  );
  return { propertyId: row.propertyId, creditCents: Number(row.credit) };
}

async function accountIds(c: pg.PoolClient, codes: readonly string[]): Promise<Map<string, string>> {
  const rows = (await c.query<{ code: string; id: string }>("SELECT code, id FROM account WHERE code = ANY($1::text[])", [codes])).rows;
  const map = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((code) => !map.has(code));
  if (missing.length) throw new Error(`Chart of accounts lacks ${missing.join(", ")}`);
  return map;
}
