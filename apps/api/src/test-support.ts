import "reflect-metadata";
import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { migrate } from "@hv/db";
import pg from "pg";
import { AppModule } from "./app.module.js";
import { configureHttp } from "./common/http.js";

export interface TestApp {
  readonly app: INestApplication;
  /** Sends a JSON request; `cookie` is the value returned by `sessionCookie`. */
  request(method: string, path: string, options?: { body?: unknown; cookie?: string }): Promise<Response>;
  /** Runs SQL with full rights, bypassing the application roles. */
  sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** Extracts `session=<token>` from a response's Set-Cookie header. */
export function sessionCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /^(session=[^;]*)/.exec(header);
  if (!match) throw new Error(`No session cookie in response (status ${res.status})`);
  return match[1]!;
}

/** Resets the test database and starts the API on a random port. */
export async function createTestApp(): Promise<TestApp> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("Tests reset the schema and only run against databases whose name ends in _test");
  }
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET_KEY = randomBytes(32).toString("base64");
  delete process.env.COOKIE_SECURE;

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(admin);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();

  return {
    app,
    request: (method, path, options = {}) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    sql: async (text, params) => (await admin.query(text, params)).rows,
    close: async () => {
      await app.close();
      await admin.end();
    },
  };
}
