import { Inject, Injectable } from "@nestjs/common";
import { idSchema } from "@hv/contracts";
import { withTenant } from "@hv/db";
import type pg from "pg";
import { ApiError } from "./api-error.js";
import { currentRequest } from "./request-context.js";
import { PG_POOL } from "./tokens.js";

/** Access to tenant data. Every call is one transaction limited to the given tenant. */
@Injectable()
export class TenantDb {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /**
   * Runs `fn` for the tenant. Constraint violations become API errors:
   * a missing parent row (which includes rows of other tenants) is `not_found`,
   * everything else that the database refuses is `conflict`.
   */
  async run<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    try {
      return await withTenant(this.pool, tenantId, fn, currentRequest()?.userId);
    } catch (err) {
      const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
      const detail = String((err as { detail?: string }).detail ?? "");
      if (code === "23503") throw new ApiError(detail.includes("is still referenced") ? "conflict" : "not_found");
      // unique, exclusion, check and restrict violations
      if (code === "23505" || code === "23P01" || code === "23514" || code === "23001") throw new ApiError("conflict");
      throw err;
    }
  }
}

/** Validates a path parameter as an id; anything else cannot exist. */
export function parseId(value: string): string {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError("not_found");
  return result.data;
}

/** Returns the row or throws `not_found`. */
export function found<T>(row: T | undefined): T {
  if (row === undefined) throw new ApiError("not_found");
  return row;
}
