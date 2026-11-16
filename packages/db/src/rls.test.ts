import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, withTenant } from "./index.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL ist nicht gesetzt");
if (!new URL(url).pathname.endsWith("_test")) {
  throw new Error("Tests setzen das Schema zurück und laufen nur gegen Datenbanken, deren Name auf _test endet");
}

const pool = new pg.Pool({ connectionString: url });
const asApp = { role: "hv_app" } as const;
let tenantA: string;
let tenantB: string;
let unitA: string;

async function seedTenant(admin: pg.Client, name: string) {
  const org = (await admin.query<{ id: string }>("INSERT INTO organization (name) VALUES ($1) RETURNING id", [name])).rows[0]!.id;
  const unit = await withTenant(pool, org, async (c) => {
    const p = (await c.query<{ id: string }>("INSERT INTO property (tenant_id, name) VALUES ($1, $2) RETURNING id", [org, `Objekt ${name}`])).rows[0]!.id;
    const b = (await c.query<{ id: string }>(
      "INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, 'Musterweg 1', '12345', 'Musterstadt') RETURNING id",
      [org, p],
    )).rows[0]!.id;
    return (await c.query<{ id: string }>("INSERT INTO unit (tenant_id, building_id, label) VALUES ($1, $2, 'EG links') RETURNING id", [org, b])).rows[0]!.id;
  }, asApp);
  return { org, unit };
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    expect(await migrate(admin)).toEqual(["0001_init.sql"]);
    expect(await migrate(admin)).toEqual([]);
    // Mandanten legt nur die Verwaltung an; die Anwendungsrolle darf das nicht.
    await admin.query("ALTER TABLE organization NO FORCE ROW LEVEL SECURITY");
    const a = await seedTenant(admin, "A");
    const b = await seedTenant(admin, "B");
    await admin.query("ALTER TABLE organization FORCE ROW LEVEL SECURITY");
    tenantA = a.org;
    tenantB = b.org;
    unitA = a.unit;
  } finally {
    await admin.end();
  }
});

afterAll(() => pool.end());

describe("Mandantentrennung", () => {
  it("zeigt jedem Mandanten nur die eigenen Zeilen", async () => {
    for (const [tenant, name] of [[tenantA, "Objekt A"], [tenantB, "Objekt B"]] as const) {
      const rows = await withTenant(pool, tenant, (c) => c.query("SELECT name FROM property"), asApp);
      expect(rows.rows).toEqual([{ name }]);
      const orgs = await withTenant(pool, tenant, (c) => c.query("SELECT id FROM organization"), asApp);
      expect(orgs.rows).toEqual([{ id: tenant }]);
    }
  });

  it("zeigt ohne gesetzten Mandanten nichts", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE hv_app");
      for (const table of ["organization", "property", "building", "unit", "unit_area"]) {
        expect((await client.query(`SELECT 1 FROM ${table}`)).rowCount, table).toBe(0);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("trägt den Mandanten nicht in die nächste Transaktion derselben Verbindung", async () => {
    const single = new pg.Pool({ connectionString: url, max: 1 });
    try {
      await withTenant(single, tenantA, (c) => c.query("SELECT 1"), asApp);
      const after = await single.query("SELECT current_tenant_id() AS t, current_user AS u");
      expect(after.rows[0].t).toBeNull();
      expect(after.rows[0].u).not.toBe("hv_app");
    } finally {
      await single.end();
    }
  });

  it("lehnt Schreiben für einen fremden Mandanten ab", async () => {
    await expect(
      withTenant(pool, tenantA, (c) => c.query("INSERT INTO property (tenant_id, name) VALUES ($1, 'fremd')", [tenantB]), asApp),
    ).rejects.toThrow(/row-level security/);
  });

  it("lässt fremde Zeilen bei UPDATE und DELETE unberührt", async () => {
    const upd = await withTenant(pool, tenantA, (c) => c.query("UPDATE property SET name = 'gekapert' WHERE tenant_id = $1", [tenantB]), asApp);
    const del = await withTenant(pool, tenantA, (c) => c.query("DELETE FROM unit WHERE tenant_id = $1", [tenantB]), asApp);
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);
    const check = await withTenant(pool, tenantB, (c) => c.query("SELECT name FROM property"), asApp);
    expect(check.rows).toEqual([{ name: "Objekt B" }]);
  });

  it("verhindert Verweise auf Zeilen eines anderen Mandanten", async () => {
    const propertyA = (await withTenant(pool, tenantA, (c) => c.query<{ id: string }>("SELECT id FROM property"), asApp)).rows[0]!.id;
    await expect(
      withTenant(pool, tenantB, (c) =>
        c.query("INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, 'x', 'x', 'x')", [tenantB, propertyA]), asApp),
    ).rejects.toThrow(/foreign key/);
  });

  it("erlaubt der Anwendungsrolle nicht, Mandanten anzulegen", async () => {
    await expect(
      withTenant(pool, tenantA, (c) => c.query("INSERT INTO organization (name) VALUES ('neu')"), asApp),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("zeitliche Versionierung der Fläche", () => {
  const insert = (range: string, area: number) =>
    withTenant(pool, tenantA, (c) =>
      c.query("INSERT INTO unit_area (tenant_id, unit_id, area_centi_sqm, valid) VALUES ($1, $2, $3, $4)", [tenantA, unitA, area, range]), asApp);

  it("erlaubt aneinander anschließende Zeiträume", async () => {
    await insert("[2020-01-01,2025-07-01)", 5437);
    await insert("[2025-07-01,)", 5612);
    const at = (day: string) =>
      withTenant(pool, tenantA, (c) => c.query("SELECT area_centi_sqm FROM unit_area WHERE unit_id = $1 AND valid @> $2::date", [unitA, day]), asApp);
    expect((await at("2025-06-30")).rows).toEqual([{ area_centi_sqm: 5437 }]);
    expect((await at("2025-07-01")).rows).toEqual([{ area_centi_sqm: 5612 }]);
  });

  it("lehnt überlappende Zeiträume ab", async () => {
    await expect(insert("[2025-06-01,2025-08-01)", 6000)).rejects.toThrow(/exclusion constraint/);
  });
});
