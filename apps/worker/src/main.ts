// Background jobs. Every job runs at start and then every WORKER_INTERVAL_MINUTES
// (default 60); jobs are idempotent, so a missed or repeated run does no harm.
// Several instances may run: a database lock lets only one run a job at a time.
import pg from "pg";
import { JOBS, runExclusive } from "./jobs.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const intervalMinutes = Number(process.env.WORKER_INTERVAL_MINUTES ?? 60);
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
  console.error("WORKER_INTERVAL_MINUTES must be at least 1");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 3 });
let running: Promise<void> = Promise.resolve();
let stopping = false;

async function tick(): Promise<void> {
  for (const job of JOBS) {
    if (stopping) return;
    const started = Date.now();
    try {
      const result = await runExclusive(pool, job, new Date());
      log({ job: job.name, result: result ?? "skipped: running elsewhere", ms: Date.now() - started });
    } catch (err) {
      log({ job: job.name, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
    }
  }
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

const timer = setInterval(() => {
  running = running.then(tick);
}, intervalMinutes * 60_000);
running = tick();
log({ started: true, intervalMinutes, jobs: JOBS.map((j) => j.name) });

async function shutdown(signal: string): Promise<void> {
  stopping = true;
  clearInterval(timer);
  log({ stopping: signal });
  await running;
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
