import type { PoolClient } from "pg";
import type { ChartAccount } from "./skr04.js";

/**
 * Creates the accounts of a chart for a tenant inside the caller's tenant
 * transaction. Accounts whose code already exists are left untouched, so the
 * call is safe to repeat when a chart gains accounts. Returns the new codes.
 */
export async function seedChartOfAccounts(client: PoolClient, tenantId: string, chart: readonly ChartAccount[]): Promise<string[]> {
  const result = await client.query<{ code: string }>(
    `INSERT INTO account (tenant_id, code, name, type)
     SELECT $1, a.code, a.name, a.type
     FROM unnest($2::text[], $3::text[], $4::text[]) AS a (code, name, type)
     ON CONFLICT (tenant_id, code) DO NOTHING
     RETURNING code`,
    [tenantId, chart.map((a) => a.code), chart.map((a) => a.name), chart.map((a) => a.type)],
  );
  return result.rows.map((r) => r.code).sort();
}
