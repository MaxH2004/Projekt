import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { PG_POOL } from "./common/tokens.js";
import { createTestApp, type TestApp } from "./test-support.js";

let api: TestApp;

beforeAll(async () => {
  api = await createTestApp();
});

afterAll(() => api.close());

describe("API", () => {
  it("responds on /health when the database is reachable", async () => {
    const res = await api.request("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("answers 503 on /health when the database is not", async () => {
    const pool = api.app.get<pg.Pool>(PG_POOL);
    const query = pool.query.bind(pool);
    pool.query = (() => Promise.reject(new Error("connection refused"))) as typeof pool.query;
    try {
      const res = await api.request("GET", "/health");
      expect([res.status, await res.json()]).toEqual([503, { status: "unavailable", database: "unreachable" }]);
    } finally {
      pool.query = query;
    }
  });

  it("answers unknown paths with 404", async () => {
    expect((await api.request("GET", "/does-not-exist")).status).toBe(404);
  });
});
