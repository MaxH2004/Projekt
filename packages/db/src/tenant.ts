import type { Pool, PoolClient } from "pg";

/**
 * Runs `fn` in a transaction limited to one tenant, as role hv_app. Tenant and
 * role only apply to this transaction (SET LOCAL), so a pooled connection
 * cannot carry them into the next request.
 *
 * The login user of the environment must be a member of hv_app.
 */
export function withTenant<T>(pool: Pool, tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, async (client) => {
    await enterTenant(client, tenantId);
    return fn(client);
  });
}

/**
 * Runs `fn` in a transaction as role hv_auth: users, memberships, sessions and
 * creating organizations. No tenant data is reachable.
 */
export function withIdentity<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, async (client) => {
    await client.query("SET LOCAL ROLE hv_auth");
    return fn(client);
  });
}

/** Switches the current transaction to tenant data of `tenantId`, as role hv_app. */
export async function enterTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SET LOCAL ROLE hv_app");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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
