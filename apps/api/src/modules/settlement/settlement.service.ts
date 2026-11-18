import { Injectable } from "@nestjs/common";
import {
  HEATING_CATEGORY_KEYS,
  OPERATING_COST_CATEGORY_KEYS,
  type OperatingCostCategoryKey,
  type Settlement,
  type SettlementConfig,
  type SettlementDraft,
  type SettlementResult,
  type SettlementSummary,
} from "@hv/contracts";
import { overlapDays } from "@hv/settlement-engine";
import type pg from "pg";
import { found, TenantDb } from "../../common/tenant-db.js";
import { settle, type SettlementData } from "./assemble.js";

interface Loaded extends SettlementData {
  readonly units: { id: string; label: string; areaCentiSqm: number | null }[];
  readonly tenancies: (SettlementData["tenancies"][number] & { tenantCount: number })[];
  readonly costs: { category: OperatingCostCategoryKey; amountCents: bigint; lineCount: number }[];
  readonly excluded: { category: OperatingCostCategoryKey; amountCents: bigint }[];
}

/** JSON with bigint amounts written as strings. */
const toJson = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

@Injectable()
export class SettlementService {
  constructor(private readonly db: TenantDb) {}

  /** Everything the settlement of a property for a period would be built from. */
  draft(tenantId: string, propertyId: string, from: string, to: string): Promise<SettlementDraft> {
    return this.db.run(tenantId, async (c) => {
      const data = await this.load(c, propertyId, from, to);
      const period = { from, to };
      return {
        propertyId,
        from,
        to,
        periodDays: overlapDays(period, period),
        units: data.units,
        tenancies: data.tenancies
          .filter((t) => overlapDays(period, t) > 0)
          .map((t) => ({ id: t.id, unitId: t.unitId, days: overlapDays(period, t), tenantCount: t.tenantCount, advancesPaidCents: Number(t.advancesPaidCents) })),
        costs: data.costs.map((cost) => ({ category: cost.category, amountCents: Number(cost.amountCents), lineCount: cost.lineCount })),
        excluded: data.excluded.map((cost) => ({ category: cost.category, amountCents: Number(cost.amountCents) })),
      };
    });
  }

  /** Calculates without storing anything. */
  preview(tenantId: string, config: SettlementConfig): Promise<SettlementResult> {
    return this.db.run(tenantId, async (c) => settle(await this.load(c, config.propertyId, config.from, config.to), config).result);
  }

  /**
   * Calculates and stores the settlement for good. Every tenancy that owes a
   * balance gets a charge due on `dueDate`.
   */
  finalize(tenantId: string, config: SettlementConfig & { dueDate: string }): Promise<Settlement> {
    return this.db.run(tenantId, async (c) => {
      // One settlement per property at a time, so two runs cannot both pass the overlap check.
      await c.query("SELECT 1 FROM property WHERE id = $1 FOR UPDATE", [config.propertyId]);
      const data = await this.load(c, config.propertyId, config.from, config.to);
      const { input, result } = settle(data, config);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO settlement (tenant_id, property_id, period, rule_set_id, due_date, input, result)
           VALUES ($1, $2, daterange($3::date, $4::date, '[]'), $5, $6, $7, $8) RETURNING id`,
          [tenantId, config.propertyId, config.from, config.to, result.ruleSetId, config.dueDate, toJson({ config, engine: input }), toJson(result)],
        )
      ).rows[0]!.id;
      for (const s of result.statements) {
        let chargeId: string | null = null;
        if (s.balanceCents > 0) {
          chargeId = (
            await c.query<{ id: string }>(
              `INSERT INTO rent_charge (tenant_id, tenancy_id, period_month, kind, amount_cents, due_date)
               VALUES ($1, $2, date_trunc('month', $3::date)::date, 'settlement_balance', $4, $3) RETURNING id`,
              [tenantId, s.tenancyId, config.dueDate, s.balanceCents],
            )
          ).rows[0]!.id;
        }
        await c.query(
          `INSERT INTO settlement_statement (tenant_id, settlement_id, tenancy_id, total_cents, advances_paid_cents, balance_cents, charge_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, id, s.tenancyId, s.totalCents, s.advancesPaidCents, s.balanceCents, chargeId],
        );
      }
      return found(await this.read(c, id));
    });
  }

  /**
   * Cancels a final settlement while nothing was paid on it: its balance
   * charges are cancelled, and the period can be settled again.
   */
  cancel(tenantId: string, id: string): Promise<Settlement> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM settlement WHERE id = $1 FOR UPDATE", [id])).rows[0]);
      // The database refuses a charge with money on it and a settlement with a credit paid out.
      await c.query(
        `UPDATE rent_charge SET cancelled_at = now()
         WHERE id IN (SELECT charge_id FROM settlement_statement WHERE settlement_id = $1 AND charge_id IS NOT NULL) AND cancelled_at IS NULL`,
        [id],
      );
      await c.query("UPDATE settlement SET cancelled_at = now() WHERE id = $1", [id]);
      return found(await this.read(c, id));
    });
  }

  list(tenantId: string, propertyId?: string): Promise<SettlementSummary[]> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<SettlementSummary>(
          `SELECT s.id, s.property_id AS "propertyId", lower(s.period)::text AS from, (upper(s.period) - 1)::text AS to,
                  s.created_at::text AS "createdAt",
                  (SELECT count(*)::int FROM settlement_statement st WHERE st.settlement_id = s.id) AS "statementCount",
                  s.cancelled_at IS NOT NULL AS cancelled
           FROM settlement s WHERE ($1::uuid IS NULL OR s.property_id = $1)
           ORDER BY lower(s.period) DESC, s.created_at DESC`,
          [propertyId ?? null],
        )
      ).rows,
    );
  }

  get(tenantId: string, id: string): Promise<Settlement> {
    return this.db.run(tenantId, async (c) => found(await this.read(c, id)));
  }

  private async read(c: pg.PoolClient, id: string): Promise<Settlement | undefined> {
    return (
      await c.query<Settlement>(
        `SELECT s.id, s.property_id AS "propertyId", lower(s.period)::text AS from, (upper(s.period) - 1)::text AS to,
                s.due_date::text AS "dueDate", s.created_at::text AS "createdAt", s.result,
                coalesce((SELECT jsonb_object_agg(st.tenancy_id, st.charge_id) FROM settlement_statement st
                          WHERE st.settlement_id = s.id AND st.charge_id IS NOT NULL), '{}') AS "chargeIds",
                coalesce((SELECT jsonb_object_agg(r.tenancy_id, r.id) FROM credit_refund r
                          WHERE r.settlement_id = s.id AND r.reversal_entry_id IS NULL), '{}') AS "refundIds",
                s.cancelled_at IS NOT NULL AS cancelled
         FROM settlement s WHERE s.id = $1`,
        [id],
      )
    ).rows[0];
  }

  private async load(c: pg.PoolClient, propertyId: string, from: string, to: string): Promise<Loaded> {
    found((await c.query("SELECT 1 FROM property WHERE id = $1", [propertyId])).rows[0]);
    // The area counts only if one recorded area covers the whole period.
    const units = (
      await c.query<{ id: string; label: string; areaCentiSqm: number | null }>(
        `SELECT u.id, u.label,
                (SELECT CASE WHEN count(*) = 1 AND bool_and(a.valid @> daterange($2::date, $3::date, '[]')) THEN max(a.area_centi_sqm) END
                 FROM unit_area a WHERE a.unit_id = u.id AND a.valid && daterange($2::date, $3::date, '[]')) AS "areaCentiSqm"
         FROM unit u JOIN building b ON b.id = u.building_id
         WHERE b.property_id = $1 ORDER BY b.street, u.label, u.id`,
        [propertyId, from, to],
      )
    ).rows;
    // Advances: what payments in force covered of the operating cost advances charged for months of the period.
    const tenancies = (
      await c.query<{ id: string; unitId: string; from: string; to: string | null; tenantCount: number; advances: string }>(
        `SELECT t.id, t.unit_id AS "unitId", lower(t.term)::text AS from, (upper(t.term) - 1)::text AS to,
                -- Recorded occupants at the start of the tenancy's part of the period, else the named tenants.
                coalesce(
                  (SELECT o.persons FROM tenancy_occupants o WHERE o.tenancy_id = t.id AND o.valid @> greatest(lower(t.term), $2::date)),
                  (SELECT count(*)::int FROM tenancy_party p WHERE p.tenancy_id = t.id AND p.role = 'tenant')
                ) AS "tenantCount",
                (SELECT coalesce(sum(a.amount_cents), 0)::text FROM rent_charge ch
                 JOIN payment_allocation a ON a.charge_id = ch.id JOIN payment p ON p.id = a.payment_id AND p.reversal_entry_id IS NULL
                 WHERE ch.tenancy_id = t.id AND ch.kind = 'operating_cost_advance' AND ch.period_month BETWEEN $2::date AND $3::date) AS advances
         FROM tenancy t WHERE t.unit_id = ANY($1::uuid[]) AND t.term && daterange($2::date, $3::date, '[]')
         ORDER BY lower(t.term), t.id`,
        [units.map((u) => u.id), from, to],
      )
    ).rows.map((t) => ({ id: t.id, unitId: t.unitId, from: t.from, to: t.to, tenantCount: t.tenantCount, advancesPaidCents: BigInt(t.advances) }));
    // Costs: expense lines of the property with a category, paid in the period, not reversed.
    const sums = (
      await c.query<{ category: OperatingCostCategoryKey; amount: string; lines: number }>(
        `SELECT l.operating_cost_category AS category, sum(l.amount_cents)::text AS amount, count(*)::int AS lines
         FROM expense_line l JOIN expense e ON e.id = l.expense_id
         WHERE l.property_id = $1 AND l.operating_cost_category IS NOT NULL
           AND e.reversal_entry_id IS NULL AND e.paid_on BETWEEN $2::date AND $3::date
         GROUP BY l.operating_cost_category ORDER BY array_position($4::text[], l.operating_cost_category)`,
        [propertyId, from, to, OPERATING_COST_CATEGORY_KEYS],
      )
    ).rows;
    const heating = (category: OperatingCostCategoryKey) => HEATING_CATEGORY_KEYS.includes(category);
    return {
      from,
      to,
      units,
      tenancies,
      costs: sums.filter((s) => !heating(s.category)).map((s) => ({ category: s.category, amountCents: BigInt(s.amount), lineCount: s.lines })),
      excluded: sums.filter((s) => heating(s.category)).map((s) => ({ category: s.category, amountCents: BigInt(s.amount) })),
    };
  }
}
