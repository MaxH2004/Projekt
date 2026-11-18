import { Injectable } from "@nestjs/common";
import type { BankImportResult, BankTransactionView, Payment } from "@hv/contracts";
import { CamtFormatError, parseCamt053, type CamtStatement } from "@hv/integrations";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";
import { FinanceService } from "../finance/index.js";
import { suggestTenancies, type MatchCandidate } from "./matching.js";

type TransactionRow = Omit<BankTransactionView, "amountCents" | "suggestions"> & { amountCents: string };

const STATUS = `CASE WHEN p.id IS NOT NULL THEN 'booked' WHEN t.ignored_at IS NOT NULL THEN 'ignored' ELSE 'open' END`;

@Injectable()
export class BankingService {
  constructor(
    private readonly db: TenantDb,
    private readonly finance: FinanceService,
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
                ${STATUS} AS status, p.id AS "paymentId"
         FROM bank_transaction t
         JOIN bank_account a ON a.id = t.bank_account_id
         LEFT JOIN payment p ON p.bank_transaction_id = t.id AND p.reversal_entry_id IS NULL
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
