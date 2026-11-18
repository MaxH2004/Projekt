import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, withTenant } from "./index.js";
import { asAdmin, resetDatabase, testDatabaseUrl } from "./test-support.js";

const url = testDatabaseUrl();
const pool = new pg.Pool({ connectionString: url });
let tenantA: string;
let tenantB: string;
let unitA: string;

beforeAll(async () => {
  const seed = await resetDatabase(pool);
  expect(seed.applied).toEqual(["0001_init.sql", "0002_tenancy.sql", "0003_ledger.sql", "0004_identity.sql", "0005_metering.sql", "0006_receivables.sql", "0007_bank_import.sql", "0008_expenses.sql", "0009_settlements.sql", "0010_organization_details.sql"]);
  tenantA = seed.a.org;
  tenantB = seed.b.org;
  unitA = seed.a.unit;
});

afterAll(() => pool.end());

describe("migrations", () => {
  it("apply only once", async () => {
    expect(await asAdmin((admin) => migrate(admin))).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("shows each tenant only its own rows", async () => {
    for (const [tenant, name] of [[tenantA, "Property A"], [tenantB, "Property B"]] as const) {
      const rows = await withTenant(pool, tenant, (c) => c.query("SELECT name FROM property"));
      expect(rows.rows).toEqual([{ name }]);
      const orgs = await withTenant(pool, tenant, (c) => c.query("SELECT id FROM organization"));
      expect(orgs.rows).toEqual([{ id: tenant }]);
    }
  });

  it("is enabled and forced on every table", async () => {
    const unprotected = await asAdmin((admin) =>
      admin.query(
        `SELECT relname FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migration'
           AND NOT (relrowsecurity AND relforcerowsecurity)`,
      ),
    );
    expect(unprotected.rows).toEqual([]);
  });

  it("shows nothing when no tenant is set", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE hv_app");
      const tables = (await client.query<{ tablename: string }>(
        // Every table the application role may read at all.
        "SELECT relname AS tablename FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND has_table_privilege('hv_app', oid, 'SELECT')",
      )).rows.map((r) => r.tablename);
      expect(tables.length).toBeGreaterThanOrEqual(12);
      for (const table of tables) {
        expect((await client.query(`SELECT 1 FROM ${table}`)).rowCount, table).toBe(0);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not carry the tenant into the next transaction on the same connection", async () => {
    const single = new pg.Pool({ connectionString: url, max: 1 });
    try {
      await withTenant(single, tenantA, (c) => c.query("SELECT 1"));
      const after = await single.query("SELECT current_tenant_id() AS t, current_user AS u");
      expect(after.rows[0].t).toBeNull();
      expect(after.rows[0].u).not.toBe("hv_app");
    } finally {
      await single.end();
    }
  });

  it("rejects writes for another tenant", async () => {
    await expect(
      withTenant(pool, tenantA, (c) => c.query("INSERT INTO property (tenant_id, name) VALUES ($1, 'foreign')", [tenantB])),
    ).rejects.toThrow(/row-level security/);
  });

  it("leaves other tenants' rows untouched on UPDATE and DELETE", async () => {
    const upd = await withTenant(pool, tenantA, (c) => c.query("UPDATE property SET name = 'hijacked' WHERE tenant_id = $1", [tenantB]));
    const del = await withTenant(pool, tenantA, (c) => c.query("DELETE FROM unit WHERE tenant_id = $1", [tenantB]));
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);
    const check = await withTenant(pool, tenantB, (c) => c.query("SELECT name FROM property"));
    expect(check.rows).toEqual([{ name: "Property B" }]);
  });

  it("prevents references to rows of another tenant", async () => {
    const propertyA = (await withTenant(pool, tenantA, (c) => c.query<{ id: string }>("SELECT id FROM property"))).rows[0]!.id;
    await expect(
      withTenant(pool, tenantB, (c) =>
        c.query("INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, 'x', 'x', 'x')", [tenantB, propertyA])),
    ).rejects.toThrow(/foreign key/);
  });

  it("does not let the application role create organizations", async () => {
    await expect(
      withTenant(pool, tenantA, (c) => c.query("INSERT INTO organization (name) VALUES ('new')")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("time-versioned area", () => {
  const insert = (range: string, area: number) =>
    withTenant(pool, tenantA, (c) =>
      c.query("INSERT INTO unit_area (tenant_id, unit_id, area_centi_sqm, valid) VALUES ($1, $2, $3, $4)", [tenantA, unitA, area, range]));

  it("allows adjacent periods", async () => {
    await insert("[2020-01-01,2025-07-01)", 5437);
    await insert("[2025-07-01,)", 5612);
    const at = (day: string) =>
      withTenant(pool, tenantA, (c) => c.query("SELECT area_centi_sqm FROM unit_area WHERE unit_id = $1 AND valid @> $2::date", [unitA, day]));
    expect((await at("2025-06-30")).rows).toEqual([{ area_centi_sqm: 5437 }]);
    expect((await at("2025-07-01")).rows).toEqual([{ area_centi_sqm: 5612 }]);
  });

  it("rejects overlapping periods", async () => {
    await expect(insert("[2025-06-01,2025-08-01)", 6000)).rejects.toThrow(/exclusion constraint/);
  });
});
