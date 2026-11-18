import { Injectable } from "@nestjs/common";
import type { BankImportResult, BankTransactionView, CreditRefund, CreditRefundReason, Expense, Payment } from "@hv/contracts";
import { postJournalEntry, reverseJournalEntry } from "@hv/db";
import { CamtFormatError, parseCamt053, type CamtStatement } from "@hv/integrations";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";
import { CreditService, ENTRY_DESCRIPTION, ExpenseService, FinanceService, NOT_FOR_OTHER_BOOKINGS, POSTING_ACCOUNTS, type ExpenseInput } from "../finance/index.js";
import { suggestTenancies, type MatchCandidate } from "./matching.js";

type TransactionRow = Omit<BankTransactionView, "amountCents" | "suggestions"> & { amountCents: string };

const STATUS = `CASE WHEN p.id IS NOT NULL OR x.id IS NOT NULL OR r.id IS NOT NULL OR o.id IS NOT NULL THEN 'booked' WHEN t.ignored_at IS NOT NULL THEN 'ignored' ELSE 'open' END`;

@Injectable()
export class BankingService {
  constructor(
    private readonly db: TenantDb,
    private readonly finance: FinanceService,
    private readonly expenses: ExpenseService,
    private readonly credit: CreditService,
  ) {}

  /**
   * Stores the transactions of a camt.053 file. The accounts of the statement
   * are created on first import. Transactions imported before stay as they
   * are, so overlapping statements can be imported safely.
   */
  importCamt(tenantId: string, content: string): Promise<BankImportResult> {
    let statements: CamtStatement[];
    try {
      statements = parseCamt053(content);
    } catch (err) {
      if (err instanceof CamtFormatError) throw new ApiError("bank_statement_unreadable");
      throw err;
    }
    return this.db.run(tenantId, async (c) => {
      const accounts: BankImportResult["accounts"][number][] = [];
      for (const stmt of statements) {
        await c.query("INSERT INTO bank_account (tenant_id, iban) VALUES ($1, $2) ON CONFLICT (tenant_id, iban) DO NOTHING", [tenantId, stmt.iban]);
        const accountId = (await c.query<{ id: string }>("SELECT id FROM bank_account WHERE iban = $1", [stmt.iban])).rows[0]!.id;
        let imported = 0;
        for (const t of stmt.transactions) {
          const inserted = await c.query(
            `INSERT INTO bank_transaction
               (tenant_id, bank_account_id, external_id, booking_date, value_date, amount_cents, counterparty_name, counterparty_iban, remittance_info)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (bank_account_id, external_id) DO NOTHING`,
            [tenantId, accountId, t.providerTransactionId, t.bookingDate, t.valueDate, t.amountCents.toString(), t.counterpartyName, t.counterpartyIban, t.remittanceInfo],
          );
          imported += inserted.rowCount ?? 0;
        }
        accounts.push({ iban: stmt.iban, imported, duplicates: stmt.transactions.length - imported, skipped: stmt.skipped.length });
      }
      return { accounts };
    });
  }

  /** `open` = neither booked nor ignored. Open incoming transactions carry suggestions. */
  async listTransactions(tenantId: string, onlyOpen: boolean): Promise<BankTransactionView[]> {
    const openCharges = await this.finance.listCharges(tenantId, { openOnly: true });
    return this.db.run(tenantId, async (c) => {
      const rows = await this.read(c, onlyOpen ? `(${STATUS}) = 'open'` : "true", []);
      const needSuggestions = rows.some((r) => r.status === "open" && BigInt(r.amountCents) > 0n);
      const candidates = needSuggestions ? await this.candidates(c, openCharges) : () => [];
      return rows.map((row) => {
        const amountCents = BigInt(row.amountCents);
        const suggestions =
          row.status === "open"
            ? suggestTenancies({ amountCents, counterpartyName: row.counterpartyName, counterpartyIban: row.counterpartyIban, remittanceInfo: row.remittanceInfo }, candidates(row.bookingDate))
            : [];
        return { ...row, amountCents: Number(amountCents), suggestions };
      });
    });
  }

  /** Books an incoming transaction as a payment of the tenancy. */
  async book(tenantId: string, id: string, input: { tenancyId: string; allocations?: { chargeId: string; amountCents: number }[] }): Promise<Payment> {
    const tx = await this.db.run(tenantId, async (c) => found((await this.read(c, "t.id = $1", [id]))[0]));
    if (tx.status !== "open" || BigInt(tx.amountCents) <= 0n) throw new ApiError("bank_transaction_not_bookable");
    return this.finance.recordPayment(tenantId, {
      tenancyId: input.tenancyId,
      receivedOn: tx.bookingDate,
      amountCents: Number(tx.amountCents),
      reference: tx.remittanceInfo.slice(0, 500) || null,
      allocations: input.allocations,
      bankTransactionId: id,
    });
  }

  /** Books an outgoing transaction as an expense paid from the bank. */
  async bookExpense(tenantId: string, id: string, input: Pick<ExpenseInput, "vendor" | "description" | "lines">): Promise<Expense> {
    const tx = await this.db.run(tenantId, async (c) => found((await this.read(c, "t.id = $1", [id]))[0]));
    if (tx.status !== "open" || BigInt(tx.amountCents) >= 0n) throw new ApiError("bank_transaction_not_bookable");
    if (input.lines.reduce((sum, l) => sum + BigInt(l.amountCents), 0n) !== -BigInt(tx.amountCents)) {
      throw new ApiError("validation_failed", ["lines"]);
    }
    return this.expenses.recordExpense(tenantId, {
      ...input,
      vendor: input.vendor ?? tx.counterpartyName,
      paidOn: tx.bookingDate,
      paidFrom: "bank",
      bankTransactionId: id,
    });
  }

  /** Books an outgoing transaction as money paid back to a tenant. */
  async bookRefund(tenantId: string, id: string, input: { tenancyId: string; reason: CreditRefundReason; settlementId?: string | null }): Promise<CreditRefund> {
    const tx = await this.db.run(tenantId, async (c) => found((await this.read(c, "t.id = $1", [id]))[0]));
    if (tx.status !== "open" || BigInt(tx.amountCents) >= 0n) throw new ApiError("bank_transaction_not_bookable");
    return this.credit.refund(tenantId, { ...input, amountCents: -Number(tx.amountCents), paidOn: tx.bookingDate, bankTransactionId: id });
  }

  /**
   * Books a transaction to one account against the bank: a deposit received,
   * an insurance refund, a private transfer. Returns the transaction.
   */
  bookOther(tenantId: string, id: string, input: { accountCode: string; propertyId?: string | null; description?: string | null }): Promise<BankTransactionView> {
    return this.db.run(tenantId, async (c) => {
      const tx = found((await this.read(c, "t.id = $1", [id]))[0]);
      await c.query("SELECT 1 FROM bank_transaction WHERE id = $1 FOR UPDATE", [id]);
      if (tx.status !== "open") throw new ApiError("bank_transaction_not_bookable");
      const account = (await c.query<{ id: string }>("SELECT id FROM account WHERE code = $1 AND NOT (code = ANY($2::text[]))", [input.accountCode, NOT_FOR_OTHER_BOOKINGS])).rows[0];
      if (!account) throw new ApiError("validation_failed", ["accountCode"]);
      if (input.propertyId) found((await c.query("SELECT 1 FROM property WHERE id = $1", [input.propertyId])).rows[0]);
      const bank = (await c.query<{ id: string }>("SELECT id FROM account WHERE code = $1", [POSTING_ACCOUNTS.bank])).rows[0]!.id;
      const amount = BigInt(tx.amountCents);
      const entryId = await postJournalEntry(c, tenantId, {
        bookingDate: tx.bookingDate,
        description: ENTRY_DESCRIPTION.otherBooking,
        lines: [
          { accountId: bank, amountCents: amount },
          { accountId: account.id, amountCents: -amount, propertyId: input.propertyId ?? undefined },
        ],
      });
      await c.query(
        `INSERT INTO bank_booking (tenant_id, bank_transaction_id, account_id, property_id, description, journal_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, id, account.id, input.propertyId ?? null, input.description ?? null, entryId],
      );
      const row = found((await this.read(c, "t.id = $1", [id]))[0]);
      return { ...row, amountCents: Number(row.amountCents), suggestions: [] };
    });
  }

  /** Reverses a direct booking; the transaction is open again. */
  reverseOther(tenantId: string, bookingId: string, bookingDate: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      const booking = found(
        (
          await c.query<{ entryId: string; reversed: boolean; date: string }>(
            `SELECT b.journal_entry_id AS "entryId", b.reversal_entry_id IS NOT NULL AS reversed, t.booking_date::text AS date
             FROM bank_booking b JOIN bank_transaction t ON t.id = b.bank_transaction_id WHERE b.id = $1 FOR UPDATE OF b`,
            [bookingId],
          )
        ).rows[0],
      );
      if (booking.reversed) throw new ApiError("conflict");
      if (bookingDate < booking.date) throw new ApiError("validation_failed", ["bookingDate"]);
      const reversal = await reverseJournalEntry(c, tenantId, booking.entryId, { bookingDate, description: ENTRY_DESCRIPTION.otherBookingReversal });
      await c.query("UPDATE bank_booking SET reversal_entry_id = $2 WHERE id = $1", [bookingId, reversal]);
    });
  }

  setIgnored(tenantId: string, id: string, ignored: boolean): Promise<BankTransactionView> {
    return this.db.run(tenantId, async (c) => {
      const tx = found((await this.read(c, "t.id = $1", [id]))[0]);
      if (tx.status === "booked") throw new ApiError("bank_transaction_not_bookable");
      await c.query(`UPDATE bank_transaction SET ignored_at = ${ignored ? "coalesce(ignored_at, now())" : "NULL"} WHERE id = $1`, [id]);
      const row = found((await this.read(c, "t.id = $1", [id]))[0]);
      return { ...row, amountCents: Number(row.amountCents), suggestions: [] };
    });
  }

  private async read(c: pg.PoolClient, where: string, params: unknown[]): Promise<TransactionRow[]> {
    return (
      await c.query<TransactionRow>(
        `SELECT t.id, a.iban, t.booking_date::text AS "bookingDate", t.value_date::text AS "valueDate", t.amount_cents::text AS "amountCents",
                t.counterparty_name AS "counterpartyName", t.counterparty_iban AS "counterpartyIban", t.remittance_info AS "remittanceInfo",
                ${STATUS} AS status, p.id AS "paymentId", x.id AS "expenseId", r.id AS "refundId", o.id AS "otherBookingId"
         FROM bank_transaction t
         JOIN bank_account a ON a.id = t.bank_account_id
         LEFT JOIN payment p ON p.bank_transaction_id = t.id AND p.reversal_entry_id IS NULL
         LEFT JOIN expense x ON x.bank_transaction_id = t.id AND x.reversal_entry_id IS NULL
         LEFT JOIN credit_refund r ON r.bank_transaction_id = t.id AND r.reversal_entry_id IS NULL
         LEFT JOIN bank_booking o ON o.bank_transaction_id = t.id AND o.reversal_entry_id IS NULL
         WHERE ${where}
         ORDER BY t.booking_date, t.imported_at, t.id`,
        params,
      )
    ).rows;
  }

  /**
   * Everything the matching needs about the tenancies, loaded once. Returns
   * the candidates for a booking date: tenancies running on that day or with
   * open charges, with the rent valid on that day as one expected amount.
   */
  private async candidates(c: pg.PoolClient, openCharges: Awaited<ReturnType<FinanceService["listCharges"]>>) {
    const tenancies = (
      await c.query<{ id: string; from: string; to: string | null; names: string[]; ibans: string[] }>(
        `SELECT t.id, lower(t.term)::text AS from, (upper(t.term) - 1)::text AS to,
                (SELECT coalesce(array_agg(coalesce(pe.family_name, pe.company_name)), '{}')
                 FROM tenancy_party tp JOIN person pe ON pe.id = tp.person_id WHERE tp.tenancy_id = t.id AND tp.role = 'tenant') AS names,
                (SELECT coalesce(array_agg(DISTINCT bt.counterparty_iban) FILTER (WHERE bt.counterparty_iban IS NOT NULL), '{}')
                 FROM payment p JOIN bank_transaction bt ON bt.id = p.bank_transaction_id
                 WHERE p.tenancy_id = t.id AND p.reversal_entry_id IS NULL) AS ibans
         FROM tenancy t`,
      )
    ).rows;
    const rent = (
      await c.query<{ tenancyId: string; amountCents: string; from: string; to: string | null }>(
        `SELECT tenancy_id AS "tenancyId", amount_cents::text AS "amountCents", lower(valid)::text AS from, (upper(valid) - 1)::text AS to FROM rent_component`,
      )
    ).rows;

    const openByTenancy = new Map<string, Map<string, bigint>>();
    for (const charge of openCharges) {
      const months = openByTenancy.get(charge.tenancyId) ?? new Map<string, bigint>();
      months.set(charge.month, (months.get(charge.month) ?? 0n) + BigInt(charge.openCents));
      openByTenancy.set(charge.tenancyId, months);
    }

    return (day: string): MatchCandidate[] =>
      tenancies
        .filter((t) => (t.from <= day && (t.to === null || t.to >= day)) || openByTenancy.has(t.id))
        .map((t) => {
          const months = [...(openByTenancy.get(t.id)?.values() ?? [])];
          const monthlyRent = rent
            .filter((r) => r.tenancyId === t.id && r.from <= day && (r.to === null || r.to >= day))
            .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
          const expectedAmounts = [...months, months.reduce((a, b) => a + b, 0n), monthlyRent].filter((a) => a > 0n);
          return { tenancyId: t.id, partyNames: t.names, knownIbans: t.ibans, expectedAmounts };
        });
  }
}
