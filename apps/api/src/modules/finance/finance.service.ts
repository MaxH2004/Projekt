import { Injectable } from "@nestjs/common";
import { RENT_COMPONENT_KINDS, type Payment, type RentCharge, type RentComponentKind, type TenancyBalance } from "@hv/contracts";
import { postJournalEntry, reverseJournalEntry, type JournalLineInput } from "@hv/db";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";
import { monthlyCharges, monthPeriod, type ComponentVersion } from "./monthly-charges.js";
import { ENTRY_DESCRIPTION, POSTING_ACCOUNTS } from "./posting-rules.js";

export interface PaymentInput {
  tenancyId: string;
  receivedOn: string;
  amountCents: number;
  reference?: string | null;
  allocations?: { chargeId: string; amountCents: number }[];
  /** Set when the payment books an imported bank transaction. */
  bankTransactionId?: string;
}

export interface ChargeFilter {
  tenancyId?: string;
  month?: string;
  openOnly?: boolean;
}

/** Amount of a charge that payments still in force have not covered. */
const OPEN = `CASE WHEN c.cancelled_at IS NOT NULL THEN 0 ELSE c.amount_cents - coalesce((
    SELECT sum(a.amount_cents) FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
    WHERE a.charge_id = c.id AND p.reversal_entry_id IS NULL), 0) END`;

const CHARGE = `c.id, c.tenancy_id AS "tenancyId", to_char(c.period_month, 'YYYY-MM') AS month, c.kind,
  c.amount_cents::text AS "amountCents", c.due_date::text AS "dueDate", c.cancelled_at IS NOT NULL AS cancelled,
  (${OPEN})::text AS "openCents"`;

/** Oldest due first; within a day in the order of RENT_COMPONENT_KINDS. */
const CHARGE_ORDER = `c.due_date, c.period_month, array_position($KINDS::text[], c.kind), c.id`;

type Row<T> = { [K in keyof T]: T[K] extends number ? string : T[K] };

const toCharge = (row: Row<RentCharge>): RentCharge => ({ ...row, amountCents: Number(row.amountCents), openCents: Number(row.openCents) });

@Injectable()
export class FinanceService {
  constructor(private readonly db: TenantDb) {}

  /**
   * Creates the charges of all tenancies for a month from their rent
   * components. Charges that exist already are left as they are, so running
   * a month again only adds what is missing. Returns the new charges.
   */
  generateCharges(tenantId: string, month: string): Promise<RentCharge[]> {
    const period = monthPeriod(month);
    return this.db.run(tenantId, async (c) => {
      const tenancies = (
        await c.query<{ id: string; from: string; to: string | null }>(
          `SELECT id, lower(term)::text AS from, (upper(term) - 1)::text AS to FROM tenancy
           WHERE term && daterange($1::date, $2::date, '[]') ORDER BY lower(term), id`,
          [period.from, period.to],
        )
      ).rows;
      if (tenancies.length === 0) return [];
      const versions = (
        await c.query<{ tenancyId: string; kind: RentComponentKind; amountCents: string; from: string; to: string | null }>(
          `SELECT tenancy_id AS "tenancyId", kind, amount_cents::text AS "amountCents",
                  lower(valid)::text AS from, (upper(valid) - 1)::text AS to
           FROM rent_component WHERE tenancy_id = ANY($1::uuid[]) AND valid && daterange($2::date, $3::date, '[]')`,
          [tenancies.map((t) => t.id), period.from, period.to],
        )
      ).rows;

      const created: string[] = [];
      for (const tenancy of tenancies) {
        const own: ComponentVersion[] = versions
          .filter((v) => v.tenancyId === tenancy.id)
          .map((v) => ({ kind: v.kind, amountCents: BigInt(v.amountCents), from: v.from, to: v.to }));
        for (const charge of monthlyCharges(month, tenancy, own)) {
          const row = (
            await c.query<{ id: string }>(
              `INSERT INTO rent_charge (tenant_id, tenancy_id, period_month, kind, amount_cents, due_date)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (tenancy_id, period_month, kind) DO NOTHING RETURNING id`,
              [tenantId, tenancy.id, period.from, charge.kind, charge.amountCents.toString(), charge.dueDate],
            )
          ).rows[0];
          if (row) created.push(row.id);
        }
      }
      return this.readCharges(c, "c.id = ANY($1::uuid[])", [created]);
    });
  }

  listCharges(tenantId: string, filter: ChargeFilter): Promise<RentCharge[]> {
    return this.db.run(tenantId, (c) =>
      this.readCharges(
        c,
        `($1::uuid IS NULL OR c.tenancy_id = $1) AND ($2::date IS NULL OR c.period_month = $2) AND (NOT $3 OR (${OPEN}) > 0)`,
        [filter.tenancyId ?? null, filter.month ? `${filter.month}-01` : null, filter.openOnly ?? false],
      ),
    );
  }

  /** A charge that is not owed. Only possible while no payment covers any of it. */
  cancelCharge(tenantId: string, id: string): Promise<RentCharge> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM rent_charge WHERE id = $1 FOR UPDATE", [id])).rows[0]);
      await c.query("UPDATE rent_charge SET cancelled_at = now() WHERE id = $1", [id]);
      return found((await this.readCharges(c, "c.id = $1", [id]))[0]);
    });
  }

  /**
   * Records an incoming payment and books it: bank against income per rent
   * component of the charges it covers, the rest against tenant credit.
   */
  recordPayment(tenantId: string, input: PaymentInput): Promise<Payment> {
    return this.db.run(tenantId, async (c) => {
      const tenancy = found(
        (
          await c.query<{ propertyId: string }>(
            `SELECT b.property_id AS "propertyId" FROM tenancy t
             JOIN unit u ON u.id = t.unit_id JOIN building b ON b.id = u.building_id
             WHERE t.id = $1 FOR SHARE OF t`,
            [input.tenancyId],
          )
        ).rows[0],
      );
      const open = (
        await c.query<{ id: string; kind: RentComponentKind; cancelled: boolean; openCents: string }>(
          `SELECT c.id, c.kind, c.cancelled_at IS NOT NULL AS cancelled, (${OPEN})::text AS "openCents"
           FROM rent_charge c WHERE c.tenancy_id = $1 ORDER BY ${CHARGE_ORDER.replace("$KINDS", "$2")} FOR UPDATE OF c`,
          [input.tenancyId, RENT_COMPONENT_KINDS],
        )
      ).rows;
      const allocations = input.allocations ? checkAllocations(input.allocations, open) : oldestFirst(input.amountCents, open);

      const accounts = await accountIds(c);
      const income = new Map<string, bigint>();
      for (const a of allocations) {
        const code = POSTING_ACCOUNTS.income[open.find((o) => o.id === a.chargeId)!.kind];
        income.set(code, (income.get(code) ?? 0n) + BigInt(a.amountCents));
      }
      const allocated = allocations.reduce((sum, a) => sum + a.amountCents, 0);
      const credit = BigInt(input.amountCents - allocated);
      const line = (code: string, amountCents: bigint): JournalLineInput => ({
        accountId: accounts.get(code)!,
        amountCents,
        propertyId: tenancy.propertyId,
      });
      const lines = [
        line(POSTING_ACCOUNTS.bank, BigInt(input.amountCents)),
        ...[...income].map(([code, cents]) => line(code, -cents)),
        ...(credit > 0n ? [line(POSTING_ACCOUNTS.tenantCredit, -credit)] : []),
      ];
      const entryId = await postJournalEntry(c, tenantId, { bookingDate: input.receivedOn, description: ENTRY_DESCRIPTION.payment, lines });

      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payment (tenant_id, tenancy_id, received_on, amount_cents, reference, journal_entry_id, bank_transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [tenantId, input.tenancyId, input.receivedOn, input.amountCents, input.reference ?? null, entryId, input.bankTransactionId ?? null],
        )
      ).rows[0]!.id;
      for (const a of allocations) {
        await c.query(
          "INSERT INTO payment_allocation (tenant_id, tenancy_id, payment_id, charge_id, amount_cents) VALUES ($1, $2, $3, $4, $5)",
          [tenantId, input.tenancyId, id, a.chargeId, a.amountCents],
        );
      }
      await c.query("SET CONSTRAINTS payment_allocation_within_amounts IMMEDIATE");
      return found((await this.readPayments(c, "p.id = $1", [id]))[0]);
    });
  }

  /** Books the reversing entry; the charges the payment covered are open again. */
  reversePayment(tenantId: string, id: string, bookingDate: string): Promise<Payment> {
    return this.db.run(tenantId, async (c) => {
      const payment = found(
        (
          await c.query<{ entryId: string; receivedOn: string; reversed: boolean }>(
            `SELECT journal_entry_id AS "entryId", received_on::text AS "receivedOn", reversal_entry_id IS NOT NULL AS reversed
             FROM payment WHERE id = $1 FOR UPDATE`,
            [id],
          )
        ).rows[0],
      );
      if (payment.reversed) throw new ApiError("conflict");
      if (bookingDate < payment.receivedOn) throw new ApiError("validation_failed", ["bookingDate"]);
      // Lock the covered charges as recordPayment does, so both see the same open amounts.
      await c.query("SELECT 1 FROM rent_charge WHERE id IN (SELECT charge_id FROM payment_allocation WHERE payment_id = $1) FOR UPDATE", [id]);
      const reversalId = await reverseJournalEntry(c, tenantId, payment.entryId, { bookingDate, description: ENTRY_DESCRIPTION.paymentReversal });
      await c.query("UPDATE payment SET reversal_entry_id = $2 WHERE id = $1", [id, reversalId]);
      return found((await this.readPayments(c, "p.id = $1", [id]))[0]);
    });
  }

  listPayments(tenantId: string, tenancyId?: string): Promise<Payment[]> {
    return this.db.run(tenantId, (c) => this.readPayments(c, "($1::uuid IS NULL OR p.tenancy_id = $1)", [tenancyId ?? null]));
  }

  balance(tenantId: string, tenancyId: string): Promise<TenancyBalance> {
    return this.db.run(tenantId, async (c) => {
      const row = found(
        (
          await c.query<Row<TenancyBalance>>(
            `SELECT t.id AS "tenancyId",
               (SELECT coalesce(sum(c.amount_cents), 0) FROM rent_charge c WHERE c.tenancy_id = t.id AND c.cancelled_at IS NULL)::text AS "chargedCents",
               (SELECT coalesce(sum(p.amount_cents), 0) FROM payment p WHERE p.tenancy_id = t.id AND p.reversal_entry_id IS NULL)::text AS "paidCents",
               (SELECT coalesce(sum(${OPEN}), 0) FROM rent_charge c WHERE c.tenancy_id = t.id)::text AS "openCents",
               (SELECT coalesce(sum(p.amount_cents - coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = p.id), 0)), 0)
                FROM payment p WHERE p.tenancy_id = t.id AND p.reversal_entry_id IS NULL)::text AS "creditCents"
             FROM tenancy t WHERE t.id = $1`,
            [tenancyId],
          )
        ).rows[0],
      );
      return {
        tenancyId: row.tenancyId,
        chargedCents: Number(row.chargedCents),
        paidCents: Number(row.paidCents),
        openCents: Number(row.openCents),
        creditCents: Number(row.creditCents),
      };
    });
  }

  private async readCharges(c: pg.PoolClient, where: string, params: unknown[]): Promise<RentCharge[]> {
    const kindsParam = `$${params.length + 1}`;
    const rows = (
      await c.query<Row<RentCharge>>(
        `SELECT ${CHARGE} FROM rent_charge c WHERE ${where} ORDER BY c.tenancy_id, ${CHARGE_ORDER.replace("$KINDS", kindsParam)}`,
        [...params, RENT_COMPONENT_KINDS],
      )
    ).rows;
    return rows.map(toCharge);
  }

  private async readPayments(c: pg.PoolClient, where: string, params: unknown[]): Promise<Payment[]> {
    const rows = (
      await c.query<Row<Omit<Payment, "allocations">> & { allocations: { chargeId: string; amountCents: string }[] }>(
        `SELECT p.id, p.tenancy_id AS "tenancyId", p.received_on::text AS "receivedOn", p.amount_cents::text AS "amountCents",
                p.reference, p.reversal_entry_id IS NOT NULL AS reversed, p.bank_transaction_id AS "bankTransactionId",
                (p.amount_cents - coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = p.id), 0))::text AS "unallocatedCents",
                coalesce((SELECT jsonb_agg(jsonb_build_object('chargeId', a.charge_id, 'amountCents', a.amount_cents::text) ORDER BY a.charge_id)
                          FROM payment_allocation a WHERE a.payment_id = p.id), '[]') AS allocations
         FROM payment p WHERE ${where} ORDER BY p.received_on, p.created_at, p.id`,
        params,
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      amountCents: Number(row.amountCents),
      unallocatedCents: Number(row.unallocatedCents),
      allocations: row.allocations.map((a) => ({ chargeId: a.chargeId, amountCents: Number(a.amountCents) })),
    }));
  }
}

type OpenCharge = { id: string; cancelled: boolean; openCents: string };

/** Explicit allocations: every charge must belong to the tenancy, be in force and have enough open. */
function checkAllocations(requested: { chargeId: string; amountCents: number }[], charges: OpenCharge[]) {
  requested.forEach((a, i) => {
    const charge = charges.find((ch) => ch.id === a.chargeId);
    if (!charge) throw new ApiError("not_found", [`allocations.${i}.chargeId`]);
    if (charge.cancelled || a.amountCents > Number(charge.openCents)) {
      throw new ApiError("allocation_exceeds_open_amount", [`allocations.${i}.amountCents`]);
    }
  });
  return requested;
}

/** Covers the open charges in the order given until the amount is used up. */
function oldestFirst(amountCents: number, charges: OpenCharge[]) {
  const result: { chargeId: string; amountCents: number }[] = [];
  let left = amountCents;
  for (const charge of charges) {
    const open = Number(charge.openCents);
    if (left === 0) break;
    if (charge.cancelled || open <= 0) continue;
    const take = Math.min(open, left);
    result.push({ chargeId: charge.id, amountCents: take });
    left -= take;
  }
  return result;
}

async function accountIds(c: pg.PoolClient): Promise<Map<string, string>> {
  const codes = [POSTING_ACCOUNTS.bank, POSTING_ACCOUNTS.tenantCredit, ...Object.values(POSTING_ACCOUNTS.income)];
  const rows = (await c.query<{ code: string; id: string }>("SELECT code, id FROM account WHERE code = ANY($1::text[])", [codes])).rows;
  const map = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((code) => !map.has(code));
  if (missing.length) throw new Error(`Chart of accounts lacks ${missing.join(", ")}`);
  return map;
}
