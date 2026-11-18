import { monthlyCharges, monthPeriod } from "@hv/settlement-engine";
import type { PoolClient } from "pg";

/**
 * Creates the rent charges of all tenancies of the caller's tenant for one
 * month (YYYY-MM) from their rent components, inside the caller's tenant
 * transaction. Charges that exist already are left as they are, so running a
 * month again only adds what is missing. Returns the ids of new charges.
 *
 * Used by the API on request and by the worker every month.
 */
export async function generateRentCharges(client: PoolClient, tenantId: string, month: string): Promise<string[]> {
  const period = monthPeriod(month);
  const tenancies = (
    await client.query<{ id: string; from: string; to: string | null }>(
      `SELECT id, lower(term)::text AS from, (upper(term) - 1)::text AS to FROM tenancy
       WHERE term && daterange($1::date, $2::date, '[]') ORDER BY lower(term), id`,
      [period.from, period.to],
    )
  ).rows;
  if (tenancies.length === 0) return [];
  const versions = (
    await client.query<{ tenancyId: string; kind: string; amountCents: string; from: string; to: string | null }>(
      `SELECT tenancy_id AS "tenancyId", kind, amount_cents::text AS "amountCents",
              lower(valid)::text AS from, (upper(valid) - 1)::text AS to
       FROM rent_component WHERE tenancy_id = ANY($1::uuid[]) AND valid && daterange($2::date, $3::date, '[]')`,
      [tenancies.map((t) => t.id), period.from, period.to],
    )
  ).rows;

  const created: string[] = [];
  for (const tenancy of tenancies) {
    const own = versions
      .filter((v) => v.tenancyId === tenancy.id)
      .map((v) => ({ kind: v.kind, amountCents: BigInt(v.amountCents), from: v.from, to: v.to }));
    for (const charge of monthlyCharges(month, tenancy, own)) {
      const row = (
        await client.query<{ id: string }>(
          `INSERT INTO rent_charge (tenant_id, tenancy_id, period_month, kind, amount_cents, due_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenancy_id, period_month, kind) DO NOTHING RETURNING id`,
          [tenantId, tenancy.id, period.from, charge.kind, charge.amountCents.toString(), charge.dueDate],
        )
      ).rows[0];
      if (row) created.push(row.id);
    }
  }
  return created;
}
