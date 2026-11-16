import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./test-support.js";

let api: TestApp;

beforeAll(async () => {
  api = await createTestApp();
});

afterAll(() => api.close());

describe("API", () => {
  it("responds on /health", async () => {
    const res = await api.request("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers unknown paths with 404", async () => {
    expect((await api.request("GET", "/does-not-exist")).status).toBe(404);
  });
});
