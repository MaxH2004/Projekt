import { generateRentCharges, seedChartOfAccounts, SKR04_RENTAL_2026, withIdentity, withTenant } from "@hv/db";
import type { Pool } from "pg";

export interface Job {
  /** Stable name; also the key of the database lock that keeps instances apart. */
  readonly name: string;
  run(pool: Pool, now: Date): Promise<string>;
}

/** Month YYYY-MM of a moment, in UTC. */
export const monthOf = (now: Date) => now.toISOString().slice(0, 7);

/**
 * Creates the current month's rent charges for every organization. The same
 * as pressing "create charges" for the month; running it again adds nothing.
 */
export const rentChargesJob: Job = {
  name: "rent-charges",
  async run(pool, now) {
    const month = monthOf(now);
    // Only the identity role may list organizations; tenant data needs one transaction each.
    const organizations = (await withIdentity(pool, (c) => c.query<{ id: string }>("SELECT id FROM organization ORDER BY created_at"))).rows;
    let created = 0;
    for (const { id } of organizations) {
      created += (await withTenant(pool, id, (c) => generateRentCharges(c, id, month))).length;
    }
    return `${created} charges for ${month} in ${organizations.length} organizations`;
  },
};

export const sessionCleanupJob: Job = {
  name: "session-cleanup",
  async run(pool) {
    const deleted = (await withIdentity(pool, (c) => c.query("DELETE FROM session WHERE expires_at <= now()"))).rowCount ?? 0;
    return `${deleted} expired sessions deleted`;
  },
};

/**
 * Adds accounts that were added to the chart after an organization was
 * created. Existing accounts are left as they are.
 */
export const chartSyncJob: Job = {
  name: "chart-sync",
  async run(pool) {
    const organizations = (await withIdentity(pool, (c) => c.query<{ id: string }>("SELECT id FROM organization ORDER BY created_at"))).rows;
    let added = 0;
    for (const { id } of organizations) {
      added += (await withTenant(pool, id, (c) => seedChartOfAccounts(c, id, SKR04_RENTAL_2026))).length;
    }
    return `${added} accounts added in ${organizations.length} organizations`;
  },
};

export const JOBS: readonly Job[] = [chartSyncJob, rentChargesJob, sessionCleanupJob];

/** Lock key per job name, the same in every worker instance. */
function lockKey(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash;
}

/**
 * Runs a job unless another worker instance is running it right now. The
 * lock belongs to one connection and ends with it, also if the process dies.
 */
export async function runExclusive(pool: Pool, job: Job, now: Date): Promise<string | null> {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockKey(job.name)]);
    if (!rows[0]!.locked) return null;
    try {
      return await job.run(pool, now);
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1)", [lockKey(job.name)]);
    }
  } finally {
    lock.release();
  }
}
