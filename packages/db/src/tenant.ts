import type { Pool, PoolClient } from "pg";

/**
 * Runs `fn` in a transaction that is limited to one tenant. The tenant only
 * applies to this transaction (set_config ... is_local = true), so a pooled
 * connection cannot carry it into the next request.
 *
 * `role` sets the database role for the transaction. In production the
 * application logs in directly as a member of hv_app and omits it.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
  options: { role?: "hv_app" } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (options.role) await client.query(`SET LOCAL ROLE ${options.role}`);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
