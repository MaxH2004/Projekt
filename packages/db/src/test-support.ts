import pg from "pg";
import { migrate } from "./migrate.js";
import { withTenant } from "./tenant.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("Tests reset the schema and only run against databases whose name ends in _test");
  }
  return url;
}

export interface SeededTenant {
  readonly org: string;
  readonly property: string;
  readonly building: string;
  readonly unit: string;
}

/** Runs `fn` on a connection with full rights (schema owner). */
export async function asAdmin<T>(fn: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

/** Drops everything, migrates from scratch and creates two tenants with one unit each. */
export async function resetDatabase(pool: pg.Pool): Promise<{ applied: string[]; a: SeededTenant; b: SeededTenant }> {
  return asAdmin(async (admin) => {
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const applied = await migrate(admin);
    // Only the admin connection creates organizations; the application role may not.
    await admin.query("ALTER TABLE organization NO FORCE ROW LEVEL SECURITY");
    const a = await seedTenant(admin, pool, "A");
    const b = await seedTenant(admin, pool, "B");
    await admin.query("ALTER TABLE organization FORCE ROW LEVEL SECURITY");
    return { applied, a, b };
  });
}

async function seedTenant(admin: pg.Client, pool: pg.Pool, name: string): Promise<SeededTenant> {
  const org = (await admin.query<{ id: string }>("INSERT INTO organization (name) VALUES ($1) RETURNING id", [name])).rows[0]!.id;
  return withTenant(
    pool,
    org,
    async (c) => {
      const one = async (sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]!.id;
      const property = await one("INSERT INTO property (tenant_id, name) VALUES ($1, $2) RETURNING id", [org, `Property ${name}`]);
      const building = await one(
        "INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, 'Sample Street 1', '12345', 'Sampletown') RETURNING id",
        [org, property],
      );
      const unit = await one("INSERT INTO unit (tenant_id, building_id, label) VALUES ($1, $2, 'Ground floor left') RETURNING id", [org, building]);
      return { org, property, building, unit };
    });
}
