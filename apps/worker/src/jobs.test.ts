import { migrate } from "@hv/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chartSyncJob, rentChargesJob, runExclusive, sessionCleanupJob } from "./jobs.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test");

const pool = new pg.Pool({ connectionString: url });
const admin = new pg.Client({ connectionString: url });
let tenancy: string;

beforeAll(async () => {
  await admin.connect();
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(admin);
  // One organization with one tenancy from 15 November 2026: 700.00 rent, 150.00 advance.
  const one = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0]!.id;
  const org = await one("INSERT INTO organization (name) VALUES ('Org') RETURNING id", []);
  const property = await one("INSERT INTO property (tenant_id, name) VALUES ($1, 'P') RETURNING id", [org]);
  const building = await one("INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, 'S', '1', 'C') RETURNING id", [org, property]);
  const unit = await one("INSERT INTO unit (tenant_id, building_id, label) VALUES ($1, $2, 'U') RETURNING id", [org, building]);
  tenancy = await one("INSERT INTO tenancy (tenant_id, unit_id, term) VALUES ($1, $2, daterange('2026-11-15', NULL)) RETURNING id", [org, unit]);
  await admin.query(
    `INSERT INTO rent_component (tenant_id, tenancy_id, kind, amount_cents, valid) VALUES
       ($1, $2, 'base_rent', 70000, daterange('2026-11-15', NULL)), ($1, $2, 'operating_cost_advance', 15000, daterange('2026-11-15', NULL))`,
    [org, tenancy],
  );
});

afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe("rent charges job", () => {
  it("creates the month's charges once, prorated to the day", async () => {
    // November 2026: 16 of 30 days. 700.00 × 16/30 = 373.33 (373.333…), 150.00 × 16/30 = 80.00.
    expect(await rentChargesJob.run(pool, new Date("2026-11-18T03:00:00Z"))).toBe("2 charges for 2026-11 in 1 organizations");
    const rows = await admin.query("SELECT kind, amount_cents::int AS amount, due_date::text AS due FROM rent_charge ORDER BY kind");
    expect(rows.rows).toEqual([
      { kind: "base_rent", amount: 37333, due: "2026-11-15" },
      { kind: "operating_cost_advance", amount: 8000, due: "2026-11-15" },
    ]);
    expect(await rentChargesJob.run(pool, new Date("2026-11-19T03:00:00Z"))).toBe("0 charges for 2026-11 in 1 organizations");
    // December in full.
    expect(await rentChargesJob.run(pool, new Date("2026-12-01T03:00:00Z"))).toBe("2 charges for 2026-12 in 1 organizations");
  });
});

describe("session cleanup job", () => {
  it("deletes only expired sessions", async () => {
    const user = (await admin.query<{ id: string }>("INSERT INTO app_user (email, password_hash) VALUES ('a@example.com', 'x') RETURNING id")).rows[0]!.id;
    const org = (await admin.query<{ id: string }>("SELECT id FROM organization LIMIT 1")).rows[0]!.id;
    await admin.query("INSERT INTO membership (user_id, tenant_id) VALUES ($1, $2)", [user, org]);
    await admin.query(
      `INSERT INTO session (token_hash, user_id, tenant_id, expires_at) VALUES
         ('\\x01', $1, $2, now() - interval '1 minute'), ('\\x02', $1, $2, now() + interval '1 day')`,
      [user, org],
    );
    expect(await sessionCleanupJob.run(pool, new Date())).toBe("1 expired sessions deleted");
    expect((await admin.query("SELECT 1 FROM session")).rowCount).toBe(1);
  });
});

describe("runExclusive", () => {
  it("skips a job another instance holds and runs it once the lock is free", async () => {
    const other = await pool.connect();
    try {
      // The same key the job uses: hash of its name.
      let key = 0;
      for (const ch of sessionCleanupJob.name) key = (key * 31 + ch.charCodeAt(0)) | 0;
      await other.query("SELECT pg_advisory_lock($1)", [key]);
      expect(await runExclusive(pool, sessionCleanupJob, new Date())).toBeNull();
      await other.query("SELECT pg_advisory_unlock($1)", [key]);
      expect(await runExclusive(pool, sessionCleanupJob, new Date())).toMatch(/expired sessions deleted/);
    } finally {
      other.release();
    }
  });
});

describe("chart sync job", () => {
  it("adds missing accounts to existing organizations and nothing else", async () => {
    // The organization above was inserted without a chart.
    expect(await chartSyncJob.run(pool, new Date())).toBe("38 accounts added in 1 organizations");
    expect(await chartSyncJob.run(pool, new Date())).toBe("0 accounts added in 1 organizations");
  });
});
