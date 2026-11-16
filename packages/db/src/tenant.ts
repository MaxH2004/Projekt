import type { Pool, PoolClient } from "pg";

/**
 * Führt `fn` in einer Transaktion aus, die auf einen Mandanten begrenzt ist.
 * Der Mandant gilt nur für diese Transaktion (set_config ... is_local = true),
 * eine Verbindung aus dem Pool kann ihn also nicht in die nächste Anfrage tragen.
 *
 * `role` setzt die Datenbankrolle für die Transaktion. Im Betrieb meldet sich
 * die Anwendung direkt als Mitglied von hv_app an und lässt den Wert weg.
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
