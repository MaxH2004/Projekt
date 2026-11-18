import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ErrorCode, LoginRequest, MeResponse, RecoveryCodesResponse, RegisterRequest, TotpSetupResponse } from "@hv/contracts";
import { enterTenant, seedChartOfAccounts, SKR04_RENTAL_2026, withIdentity } from "@hv/db";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { APP_CONFIG, type AppConfig } from "../../common/config.js";
import { PG_POOL } from "../../common/tokens.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.js";
import { SecretBox } from "./secret-box.js";
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";

/** Who is making the request. Set by SessionGuard. */
export interface AuthContext {
  readonly userId: string;
  readonly tenantId: string;
}

export interface NewSession {
  readonly token: string;
  readonly maxAgeSeconds: number;
}

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
const RECOVERY_CODE_COUNT = 10;

/** 60 random bits as twelve base32 characters, printed as XXXX-XXXX-XXXX. */
function newRecoveryCode(): string {
  return base32Encode(randomBytes(8)).slice(0, 12);
}
export const formatRecoveryCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;

/** The second factor a user gives: a code from the app or a recovery code. */
export type SecondFactor = { totpCode?: string; recoveryCode?: string };

@Injectable()
export class IdentityService {
  private readonly box: SecretBox;
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.authSecretKey);
  }

  /** Creates the organization with its first user and chart of accounts, and logs the user in. */
  async register(input: RegisterRequest): Promise<NewSession> {
    const passwordHash = await hashPassword(input.password);
    const tenantId = randomUUID();
    try {
      return await withIdentity(this.pool, async (c) => {
        await c.query("INSERT INTO organization (id, name) VALUES ($1, $2)", [tenantId, input.organizationName]);
        const userId = (
          await c.query<{ id: string }>("INSERT INTO app_user (email, password_hash, locale) VALUES ($1, $2, $3) RETURNING id", [
            input.email,
            passwordHash,
            input.locale ?? "de",
          ])
        ).rows[0]!.id;
        await c.query("INSERT INTO membership (user_id, tenant_id) VALUES ($1, $2)", [userId, tenantId]);
        const session = await this.createSession(c, userId, tenantId);
        // From here on the transaction acts inside the new tenant.
        await enterTenant(c, tenantId);
        await seedChartOfAccounts(c, tenantId, SKR04_RENTAL_2026);
        return session;
      });
    } catch (err) {
      if (isUniqueViolation(err, "app_user_email_key")) throw new ApiError("email_taken");
      throw err;
    }
  }

  async login(input: LoginRequest): Promise<NewSession> {
    // Failures are returned, not thrown, so the failed-login counter commits.
    const outcome = await withIdentity(this.pool, async (c): Promise<NewSession | ErrorCode> => {
      const user = (
        await c.query<{
          id: string;
          password_hash: string;
          totp_secret: string | null;
          totp_enabled_at: Date | null;
          totp_last_step: string | null;
          locked: boolean;
        }>(
          `SELECT id, password_hash, totp_secret, totp_enabled_at, totp_last_step,
                  coalesce(locked_until > now(), false) AS locked
           FROM app_user WHERE email = $1 FOR UPDATE`,
          [input.email],
        )
      ).rows[0];

      if (!user) {
        await verifyPassword(input.password, await DUMMY_HASH);
        return "invalid_credentials";
      }
      if (user.locked) return "account_locked";
      if (!(await verifyPassword(input.password, user.password_hash))) {
        await this.recordFailure(c, user.id);
        return "invalid_credentials";
      }

      if (user.totp_enabled_at && user.totp_secret) {
        if (!input.totpCode && !input.recoveryCode) return "totp_required";
        if (!(await this.checkSecondFactor(c, user, input))) {
          await this.recordFailure(c, user.id);
          return "invalid_totp";
        }
      }

      await c.query("UPDATE app_user SET failed_logins = 0, locked_until = NULL WHERE id = $1", [user.id]);
      await c.query("DELETE FROM session WHERE user_id = $1 AND expires_at <= now()", [user.id]);
      const membership = (
        await c.query<{ tenant_id: string }>("SELECT tenant_id FROM membership WHERE user_id = $1 ORDER BY created_at LIMIT 1", [user.id])
      ).rows[0];
      if (!membership) return "invalid_credentials";
      return this.createSession(c, user.id, membership.tenant_id);
    });
    if (typeof outcome === "string") throw new ApiError(outcome);
    return outcome;
  }

  async resolveSession(token: string): Promise<AuthContext | null> {
    const row = (
      await withIdentity(this.pool, (c) =>
        c.query<{ user_id: string; tenant_id: string }>("SELECT user_id, tenant_id FROM session WHERE token_hash = $1 AND expires_at > now()", [
          hashToken(token),
        ]),
      )
    ).rows[0];
    return row ? { userId: row.user_id, tenantId: row.tenant_id } : null;
  }

  async logout(token: string): Promise<void> {
    await withIdentity(this.pool, (c) => c.query("DELETE FROM session WHERE token_hash = $1", [hashToken(token)]));
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const row = (
      await withIdentity(this.pool, (c) =>
        c.query<{ email: string; locale: MeResponse["locale"]; totp_enabled: boolean; name: string }>(
          `SELECT u.email, u.locale, u.totp_enabled_at IS NOT NULL AS totp_enabled, o.name
           FROM app_user u, organization o WHERE u.id = $1 AND o.id = $2`,
          [auth.userId, auth.tenantId],
        ),
      )
    ).rows[0]!;
    return {
      userId: auth.userId,
      email: row.email,
      locale: row.locale,
      organizationId: auth.tenantId,
      organizationName: row.name,
      totpEnabled: row.totp_enabled,
    };
  }

  /** Stores a new TOTP secret. It only takes effect once confirmed by `enableTotp`. */
  async setupTotp(auth: AuthContext): Promise<TotpSetupResponse> {
    const secret = generateTotpSecret();
    const email = await withIdentity(this.pool, async (c) => {
      const user = (await c.query<{ email: string; enabled: boolean }>("SELECT email, totp_enabled_at IS NOT NULL AS enabled FROM app_user WHERE id = $1 FOR UPDATE", [auth.userId])).rows[0]!;
      if (user.enabled) return null;
      await c.query("UPDATE app_user SET totp_secret = $2 WHERE id = $1", [auth.userId, this.box.seal(secret)]);
      return user.email;
    });
    if (email === null) throw new ApiError("totp_already_enabled");
    return { secret, uri: otpauthUri(secret, email, this.config.totpIssuer) };
  }

  /** Turns two-factor authentication on and returns the recovery codes, shown once. */
  async enableTotp(auth: AuthContext, code: string): Promise<RecoveryCodesResponse> {
    const result = await withIdentity(this.pool, async (c): Promise<ErrorCode | RecoveryCodesResponse> => {
      const user = (await c.query<{ totp_secret: string | null; enabled: boolean }>("SELECT totp_secret, totp_enabled_at IS NOT NULL AS enabled FROM app_user WHERE id = $1 FOR UPDATE", [auth.userId])).rows[0]!;
      if (user.enabled) return "totp_already_enabled";
      if (!user.totp_secret) return "totp_not_set_up";
      const step = verifyTotp(this.box.open(user.totp_secret), code, this.now(), null);
      if (step === null) return "invalid_totp";
      await c.query("UPDATE app_user SET totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1", [auth.userId, step]);
      return { codes: await this.replaceRecoveryCodes(c, auth.userId) };
    });
    if (typeof result === "string") throw new ApiError(result);
    return result;
  }

  /** New recovery codes; the old ones stop working. Needs the password and a second factor. */
  async regenerateRecoveryCodes(auth: AuthContext, password: string, factor: SecondFactor): Promise<RecoveryCodesResponse> {
    return this.confirmed(auth, password, factor, true, async (c) => ({ codes: await this.replaceRecoveryCodes(c, auth.userId) }));
  }

  /** Turns two-factor authentication off. Needs the password and a second factor. */
  async disableTotp(auth: AuthContext, password: string, factor: SecondFactor): Promise<void> {
    await this.confirmed(auth, password, factor, true, async (c) => {
      await c.query("UPDATE app_user SET totp_enabled_at = NULL, totp_secret = NULL, totp_last_step = NULL WHERE id = $1", [auth.userId]);
      await c.query("DELETE FROM recovery_code WHERE user_id = $1", [auth.userId]);
    });
  }

  /** Sets a new password and ends every other session of the user. */
  async changePassword(auth: AuthContext, currentToken: string, currentPassword: string, newPassword: string): Promise<void> {
    const hash = await hashPassword(newPassword);
    await this.confirmed(auth, currentPassword, {}, false, async (c) => {
      await c.query("UPDATE app_user SET password_hash = $2 WHERE id = $1", [auth.userId, hash]);
      await c.query("DELETE FROM session WHERE user_id = $1 AND token_hash <> $2", [auth.userId, hashToken(currentToken)]);
    });
  }

  /** Changes the login e-mail. Not verified by a mail yet, see docs/BACKLOG.md. */
  async changeEmail(auth: AuthContext, password: string, email: string): Promise<void> {
    try {
      await this.confirmed(auth, password, {}, false, async (c) => {
        await c.query("UPDATE app_user SET email = $2 WHERE id = $1", [auth.userId, email]);
      });
    } catch (err) {
      if (isUniqueViolation(err, "app_user_email_key")) throw new ApiError("email_taken");
      throw err;
    }
  }

  /** Deletes sessions that have expired. Returns how many. */
  async deleteExpiredSessions(): Promise<number> {
    return (await withIdentity(this.pool, (c) => c.query("DELETE FROM session WHERE expires_at <= now()"))).rowCount ?? 0;
  }

  /**
   * Runs `fn` after checking the password and, if `needsSecondFactor` and
   * two-factor authentication is on, a code. Wrong answers count as failed
   * logins, so these checks cannot be used to guess the password.
   */
  private async confirmed<T>(auth: AuthContext, password: string, factor: SecondFactor, needsSecondFactor: boolean, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const outcome = await withIdentity(this.pool, async (c): Promise<{ ok: T } | ErrorCode> => {
      const user = (
        await c.query<{ id: string; password_hash: string; totp_secret: string | null; totp_enabled_at: Date | null; totp_last_step: string | null; locked: boolean }>(
          `SELECT id, password_hash, totp_secret, totp_enabled_at, totp_last_step, coalesce(locked_until > now(), false) AS locked
           FROM app_user WHERE id = $1 FOR UPDATE`,
          [auth.userId],
        )
      ).rows[0]!;
      if (user.locked) return "account_locked";
      if (!(await verifyPassword(password, user.password_hash))) {
        await this.recordFailure(c, user.id);
        return "invalid_credentials";
      }
      if (needsSecondFactor) {
        if (!user.totp_enabled_at) return "totp_not_set_up";
        if (!(await this.checkSecondFactor(c, user, factor))) {
          await this.recordFailure(c, user.id);
          return "invalid_totp";
        }
      }
      return { ok: await fn(c) };
    });
    if (typeof outcome === "string") throw new ApiError(outcome);
    return outcome.ok;
  }

  /** True for a fresh TOTP code (then remembered) or an unused recovery code (then spent). */
  private async checkSecondFactor(c: pg.PoolClient, user: { id: string; totp_secret: string | null; totp_last_step: string | null }, factor: SecondFactor): Promise<boolean> {
    if (factor.totpCode && user.totp_secret) {
      const lastStep = user.totp_last_step === null ? null : Number(user.totp_last_step);
      const step = verifyTotp(this.box.open(user.totp_secret), factor.totpCode, this.now(), lastStep);
      if (step === null) return false;
      await c.query("UPDATE app_user SET totp_last_step = $2 WHERE id = $1", [user.id, step]);
      return true;
    }
    if (factor.recoveryCode) {
      const used = await c.query("UPDATE recovery_code SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL", [
        user.id,
        hashToken(factor.recoveryCode),
      ]);
      return used.rowCount === 1;
    }
    return false;
  }

  private async replaceRecoveryCodes(c: pg.PoolClient, userId: string): Promise<string[]> {
    await c.query("DELETE FROM recovery_code WHERE user_id = $1", [userId]);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    for (const code of codes) await c.query("INSERT INTO recovery_code (user_id, code_hash) VALUES ($1, $2)", [userId, hashToken(code)]);
    return codes.map(formatRecoveryCode);
  }

  private async createSession(c: pg.PoolClient, userId: string, tenantId: string): Promise<NewSession> {
    const token = randomBytes(32).toString("base64url");
    await c.query("INSERT INTO session (token_hash, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))", [
      hashToken(token),
      userId,
      tenantId,
      SESSION_MAX_AGE_SECONDS,
    ]);
    return { token, maxAgeSeconds: SESSION_MAX_AGE_SECONDS };
  }

  private async recordFailure(c: pg.PoolClient, userId: string): Promise<void> {
    await c.query(
      `UPDATE app_user
       SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
           locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1`,
      [userId, MAX_FAILED_LOGINS, LOCK_MINUTES],
    );
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === constraint;
}
