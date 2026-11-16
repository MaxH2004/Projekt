import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/**
 * Applies all SQL files that have not been applied yet, in name order, each
 * in its own transaction. Returns the newly applied files.
 */
export async function migrate(client: Client): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migration")).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed`, { cause: err });
    }
    applied.push(file);
  }
  return applied;
}
