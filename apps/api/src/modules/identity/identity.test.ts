import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "../../test-support.js";
import { IdentityService } from "./identity.service.js";
import { timeStep, totpCode } from "./totp.js";

let api: TestApp;
const password = "a long enough password";
const anna = { email: "anna@example.com", password, organizationName: "Anna Rentals" };

const register = (body: object) => api.request("POST", "/auth/register", { body });
const login = (body: object) => api.request("POST", "/auth/login", { body });
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

beforeAll(async () => {
  api = await createTestApp();
});

afterAll(() => api.close());

describe("registration", () => {
  let cookie: string;

  it("creates organization, user and chart of accounts and logs in", async () => {
    const res = await register({ ...anna, email: " Anna@Example.com ", locale: "fr" });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).toMatch(/; SameSite=Lax/);
    cookie = sessionCookie(res);

    const me = await (await api.request("GET", "/auth/me", { cookie })).json();
    expect(me).toMatchObject({ email: "anna@example.com", locale: "fr", organizationName: "Anna Rentals", totpEnabled: false });
    const accounts = await api.sql("SELECT 1 FROM account WHERE tenant_id = $1", [me.organizationId]);
    expect(accounts).toHaveLength(11);
  });

  it("stores neither the password nor the session token in clear", async () => {
    const [user] = await api.sql<{ password_hash: string }>("SELECT password_hash FROM app_user WHERE email = 'anna@example.com'");
    expect(user!.password_hash).not.toContain(password);
    const token = cookie.slice("session=".length);
    const [session] = await api.sql<{ token_hash: Buffer }>("SELECT token_hash FROM session");
    expect(session!.token_hash.equals(createHash("sha256").update(token).digest())).toBe(true);
  });

  it("rejects a second registration with the same e-mail and leaves nothing behind", async () => {
    const res = await register({ ...anna, email: "ANNA@example.com", organizationName: "Duplicate" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("email_taken");
    expect(await api.sql("SELECT 1 FROM organization WHERE name = 'Duplicate'")).toHaveLength(0);
  });

  it("names the invalid fields", async () => {
    const res = await register({ email: "not-an-email", password: "short", organizationName: " " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "validation_failed", fields: ["email", "password", "organizationName"] });
    expect((await register({ ...anna, email: "x@example.com", locale: "en" })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("rejects requests without or with an unknown session", async () => {
    for (const cookie of [undefined, "session=", "session=unknown-token", "other=1"]) {
      const res = await api.request("GET", "/auth/me", { cookie });
      expect(res.status, String(cookie)).toBe(401);
      expect(await code(res)).toBe("unauthenticated");
    }
  });

  it("logs in, and logout ends exactly that session", async () => {
    const first = sessionCookie(await login(anna));
    const second = sessionCookie(await login(anna));
    expect((await api.request("POST", "/auth/logout", { cookie: first })).status).toBe(204);
    expect((await api.request("GET", "/auth/me", { cookie: first })).status).toBe(401);
    expect((await api.request("GET", "/auth/me", { cookie: second })).status).toBe(200);
  });

  it("ignores expired sessions", async () => {
    const cookie = sessionCookie(await login(anna));
    await api.sql("UPDATE session SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [
      createHash("sha256").update(cookie.slice("session=".length)).digest(),
    ]);
    expect((await api.request("GET", "/auth/me", { cookie })).status).toBe(401);
  });

  it("keeps organizations apart", async () => {
    const ben = sessionCookie(await register({ email: "ben@example.com", password, organizationName: "Ben Estates" }));
    const annaMe = await (await api.request("GET", "/auth/me", { cookie: sessionCookie(await login(anna)) })).json();
    const benMe = await (await api.request("GET", "/auth/me", { cookie: ben })).json();
    expect(benMe.organizationName).toBe("Ben Estates");
    expect(benMe.organizationId).not.toBe(annaMe.organizationId);
  });
});

describe("login failures", () => {
  it("answers a wrong password and an unknown e-mail identically", async () => {
    const wrong = await login({ ...anna, password: "wrong password 123" });
    const unknown = await login({ email: "nobody@example.com", password });
    expect([wrong.status, await code(wrong)]).toEqual([401, "invalid_credentials"]);
    expect([unknown.status, await code(unknown)]).toEqual([401, "invalid_credentials"]);
  });

  it("locks the account after five failures in a row, even for the right password", async () => {
    await register({ email: "carl@example.com", password, organizationName: "Carl" });
    const carl = { email: "carl@example.com", password };
    for (let i = 0; i < 4; i++) expect((await login({ ...carl, password: "wrong password 123" })).status).toBe(401);
    // A success before the fifth failure resets the counter.
    expect((await login(carl)).status).toBe(204);
    for (let i = 0; i < 5; i++) expect(await code(await login({ ...carl, password: "wrong password 123" }))).toBe("invalid_credentials");
    const locked = await login(carl);
    expect([locked.status, await code(locked)]).toEqual([429, "account_locked"]);

    await api.sql("UPDATE app_user SET locked_until = now() - interval '1 second' WHERE email = 'carl@example.com'");
    expect((await login(carl)).status).toBe(204);
  });
});

describe("two-factor authentication", () => {
  const dora = { email: "dora@example.com", password };
  let cookie: string;
  let secret: string;
  let clock: number;

  beforeAll(async () => {
    cookie = sessionCookie(await register({ ...dora, organizationName: "Dora" }));
    clock = Date.now();
    api.app.get(IdentityService).now = () => clock;
  });

  it("cannot be enabled before setup or with a wrong code", async () => {
    expect(await code(await api.request("POST", "/auth/totp/enable", { cookie, body: { code: "123456" } }))).toBe("totp_not_set_up");
    const setup = await api.request("POST", "/auth/totp/setup", { cookie });
    expect(setup.status).toBe(200);
    const body = (await setup.json()) as { secret: string; uri: string };
    secret = body.secret;
    expect(body.uri).toContain(`secret=${secret}`);
    expect(body.uri).toContain("dora%40example.com");

    const wrong = totpCode(secret, timeStep(clock) + 10);
    expect(await code(await api.request("POST", "/auth/totp/enable", { cookie, body: { code: wrong } }))).toBe("invalid_totp");
    // Not active yet: login still works with the password alone.
    expect((await login(dora)).status).toBe(204);
  });

  it("stores the secret encrypted", async () => {
    const [user] = await api.sql<{ totp_secret: string }>("SELECT totp_secret FROM app_user WHERE email = 'dora@example.com'");
    expect(user!.totp_secret).toMatch(/^v1\./);
    expect(user!.totp_secret).not.toContain(secret);
  });

  it("is required at login once enabled", async () => {
    const enable = await api.request("POST", "/auth/totp/enable", { cookie, body: { code: totpCode(secret, timeStep(clock)) } });
    expect(enable.status).toBe(204);
    expect((await (await api.request("GET", "/auth/me", { cookie })).json()).totpEnabled).toBe(true);

    const withoutCode = await login(dora);
    expect([withoutCode.status, await code(withoutCode)]).toEqual([401, "totp_required"]);
    expect(await code(await login({ ...dora, password: "wrong password 123", totpCode: "000000" }))).toBe("invalid_credentials");
  });

  it("refuses to reuse a code and accepts the next one", async () => {
    // The code used to enable two-factor authentication is spent.
    expect(await code(await login({ ...dora, totpCode: totpCode(secret, timeStep(clock)) }))).toBe("invalid_totp");
    clock += 30_000;
    const fresh = totpCode(secret, timeStep(clock));
    expect((await login({ ...dora, totpCode: fresh })).status).toBe(204);
    expect(await code(await login({ ...dora, totpCode: fresh }))).toBe("invalid_totp");
  });

  it("cannot be set up again once enabled", async () => {
    expect(await code(await api.request("POST", "/auth/totp/setup", { cookie }))).toBe("totp_already_enabled");
  });
});
