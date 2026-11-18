import { Injectable } from "@nestjs/common";
import type { Account, Expense, IncomeStatement, OperatingCostCategoryKey } from "@hv/contracts";
import { postJournalEntry, reverseJournalEntry, type JournalLineInput } from "@hv/db";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";
import { ENTRY_DESCRIPTION, NON_CASH_EXPENSE_ACCOUNTS, POSTING_ACCOUNTS } from "./posting-rules.js";

export interface ExpenseInput {
  paidOn: string;
  paidFrom: "bank" | "private";
  vendor?: string | null;
  description?: string | null;
  lines: { accountCode: string; propertyId: string; amountCents: number; operatingCostCategory?: OperatingCostCategoryKey | null }[];
  /** Set when the expense books an imported outgoing bank transaction. */
  bankTransactionId?: string;
}

export interface ExpenseFilter {
  propertyId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class ExpenseService {
  constructor(private readonly db: TenantDb) {}

  listAccounts(tenantId: string): Promise<Account[]> {
    return this.db.run(tenantId, async (c) =>
      (await c.query<Omit<Account, "forExpenses">>("SELECT code, name, type FROM account ORDER BY code")).rows.map((a) => ({
        ...a,
        forExpenses: a.type === "expense" && !NON_CASH_EXPENSE_ACCOUNTS.includes(a.code),
      })),
    );
  }

  /** Records the expense and books its lines against bank or private contributions. */
  recordExpense(tenantId: string, input: ExpenseInput): Promise<Expense> {
    return this.db.run(tenantId, async (c) => {
      const codes = [...new Set(input.lines.map((l) => l.accountCode))];
      const accounts = new Map(
        (
          await c.query<{ code: string; id: string }>(
            "SELECT code, id FROM account WHERE code = ANY($1::text[]) AND type = 'expense' AND NOT (code = ANY($2::text[]))",
            [codes, NON_CASH_EXPENSE_ACCOUNTS],
          )
        ).rows.map((a) => [a.code, a.id]),
      );
      input.lines.forEach((line, i) => {
        if (!accounts.has(line.accountCode)) throw new ApiError("validation_failed", [`lines.${i}.accountCode`]);
      });
      const properties = new Set(
        (await c.query<{ id: string }>("SELECT id FROM property WHERE id = ANY($1::uuid[])", [[...new Set(input.lines.map((l) => l.propertyId))]])).rows.map((p) => p.id),
      );
      input.lines.forEach((line, i) => {
        if (!properties.has(line.propertyId)) throw new ApiError("not_found", [`lines.${i}.propertyId`]);
      });

      const total = input.lines.reduce((sum, l) => sum + BigInt(l.amountCents), 0n);
      const counterCode = input.paidFrom === "bank" ? POSTING_ACCOUNTS.bank : POSTING_ACCOUNTS.privateContribution;
      const counterId = found((await c.query<{ id: string }>("SELECT id FROM account WHERE code = $1", [counterCode])).rows[0]).id;
      const lines: JournalLineInput[] = [
        ...input.lines.map((l) => ({ accountId: accounts.get(l.accountCode)!, amountCents: BigInt(l.amountCents), propertyId: l.propertyId })),
        { accountId: counterId, amountCents: -total },
      ];
      const entryId = await postJournalEntry(c, tenantId, { bookingDate: input.paidOn, description: ENTRY_DESCRIPTION.expense, lines });

      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO expense (tenant_id, paid_on, amount_cents, paid_from, vendor, description, bank_transaction_id, journal_entry_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tenantId, input.paidOn, total.toString(), input.paidFrom, input.vendor ?? null, input.description ?? null, input.bankTransactionId ?? null, entryId],
        )
      ).rows[0]!.id;
      for (const l of input.lines) {
        await c.query(
          `INSERT INTO expense_line (tenant_id, expense_id, account_id, property_id, amount_cents, operating_cost_category)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, id, accounts.get(l.accountCode), l.propertyId, l.amountCents, l.operatingCostCategory ?? null],
        );
      }
      await c.query("SET CONSTRAINTS expense_consistent IMMEDIATE");
      return found((await this.read(c, "e.id = $1", [id]))[0]);
    });
  }

  reverseExpense(tenantId: string, id: string, bookingDate: string): Promise<Expense> {
    return this.db.run(tenantId, async (c) => {
      const expense = found(
        (
          await c.query<{ entryId: string; paidOn: string; reversed: boolean }>(
            `SELECT journal_entry_id AS "entryId", paid_on::text AS "paidOn", reversal_entry_id IS NOT NULL AS reversed FROM expense WHERE id = $1 FOR UPDATE`,
            [id],
          )
        ).rows[0],
      );
      if (expense.reversed) throw new ApiError("conflict");
      if (bookingDate < expense.paidOn) throw new ApiError("validation_failed", ["bookingDate"]);
      const reversalId = await reverseJournalEntry(c, tenantId, expense.entryId, { bookingDate, description: ENTRY_DESCRIPTION.expenseReversal });
      await c.query("UPDATE expense SET reversal_entry_id = $2 WHERE id = $1", [id, reversalId]);
      return found((await this.read(c, "e.id = $1", [id]))[0]);
    });
  }

  /** Expenses paid in the period; with a property, those with at least one line for it. */
  listExpenses(tenantId: string, filter: ExpenseFilter): Promise<Expense[]> {
    return this.db.run(tenantId, (c) =>
      this.read(
        c,
        `($1::uuid IS NULL OR EXISTS (SELECT FROM expense_line l WHERE l.expense_id = e.id AND l.property_id = $1))
         AND ($2::date IS NULL OR e.paid_on >= $2) AND ($3::date IS NULL OR e.paid_on <= $3)`,
        [filter.propertyId ?? null, filter.from ?? null, filter.to ?? null],
      ),
    );
  }

  /**
   * Income and expenses per property from the ledger, by booking date.
   * Income is shown positive. Reversals cancel out what they reverse.
   */
  incomeStatement(tenantId: string, from: string, to: string): Promise<IncomeStatement> {
    return this.db.run(tenantId, async (c) => {
      const rows = (
        await c.query<{ propertyId: string | null; code: string; type: "income" | "expense"; amount: string }>(
          `SELECT l.property_id AS "propertyId", a.code, a.type, sum(l.amount_cents)::text AS amount
           FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id JOIN account a ON a.id = l.account_id
           WHERE e.booking_date BETWEEN $1 AND $2 AND a.type IN ('income', 'expense')
           GROUP BY l.property_id, a.code, a.type
           HAVING sum(l.amount_cents) <> 0
           ORDER BY l.property_id NULLS LAST, a.code`,
          [from, to],
        )
      ).rows;
      const byProperty = new Map<string | null, typeof rows>();
      for (const row of rows) byProperty.set(row.propertyId, [...(byProperty.get(row.propertyId) ?? []), row]);
      return {
        from,
        to,
        properties: [...byProperty].map(([propertyId, accounts]) => {
          const shown = accounts.map((a) => ({ code: a.code, type: a.type, amountCents: Number(a.type === "income" ? -BigInt(a.amount) : BigInt(a.amount)) }));
          const incomeCents = shown.filter((a) => a.type === "income").reduce((s, a) => s + a.amountCents, 0);
          const expenseCents = shown.filter((a) => a.type === "expense").reduce((s, a) => s + a.amountCents, 0);
          return { propertyId, accounts: shown, incomeCents, expenseCents, resultCents: incomeCents - expenseCents };
        }),
      };
    });
  }

  private async read(c: pg.PoolClient, where: string, params: unknown[]): Promise<Expense[]> {
    const rows = (
      await c.query<Omit<Expense, "amountCents" | "lines"> & { amountCents: string; lines: (Omit<Expense["lines"][number], "amountCents"> & { amountCents: string })[] }>(
        `SELECT e.id, e.paid_on::text AS "paidOn", e.amount_cents::text AS "amountCents", e.paid_from AS "paidFrom", e.vendor, e.description,
                e.bank_transaction_id AS "bankTransactionId", e.reversal_entry_id IS NOT NULL AS reversed,
                (SELECT jsonb_agg(jsonb_build_object('accountCode', a.code, 'propertyId', l.property_id, 'amountCents', l.amount_cents::text,
                                                     'operatingCostCategory', l.operating_cost_category) ORDER BY a.code, l.amount_cents, l.id)
                 FROM expense_line l JOIN account a ON a.id = l.account_id WHERE l.expense_id = e.id) AS lines
         FROM expense e WHERE ${where} ORDER BY e.paid_on, e.created_at, e.id`,
        params,
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      amountCents: Number(row.amountCents),
      lines: row.lines.map((l) => ({ ...l, amountCents: Number(l.amountCents) })),
    }));
  }
}
