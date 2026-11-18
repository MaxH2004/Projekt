import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
let ben: string;
const password = "a long enough password";
const call = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await api.request(method, path, { cookie, body });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna Sample" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
});

afterAll(() => api.close());

describe("organization details", () => {
  it("are empty until saved", async () => {
    expect((await call(anna, "GET", "/organization/details")).body).toEqual({
      name: "Anna Sample",
      street: null,
      postalCode: null,
      city: null,
      accountHolder: null,
      iban: null,
    });
  });

  it("are saved, replaced and kept apart per organization", async () => {
    // Published sample IBAN, no real account.
    const saved = await call(anna, "PUT", "/organization/details", { street: "Oak Road 1", postalCode: "12345", city: "Sampletown", accountHolder: "Anna Sample", iban: "de89 3704 0044 0532 0130 00" });
    expect(saved).toEqual({ status: 200, body: { name: "Anna Sample", street: "Oak Road 1", postalCode: "12345", city: "Sampletown", accountHolder: "Anna Sample", iban: "DE89370400440532013000" } });
    expect((await call(anna, "PUT", "/organization/details", { city: "Othertown" })).body).toMatchObject({ street: null, city: "Othertown", iban: null });
    expect((await call(ben, "GET", "/organization/details")).body).toMatchObject({ name: "Ben", city: null });
  });

  it("refuses an IBAN with wrong check digits", async () => {
    expect((await call(anna, "PUT", "/organization/details", { iban: "DE89370400440532013001" })).body).toEqual({ code: "validation_failed", fields: ["iban"] });
  });
});
