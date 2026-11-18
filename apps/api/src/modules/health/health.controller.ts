import { Controller, Get, HttpException, Inject } from "@nestjs/common";
import type pg from "pg";
import { PG_POOL } from "../../common/tokens.js";

/** For load balancers and monitoring: 200 when the API can reach its database, 503 otherwise. */
@Controller("health")
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  async check(): Promise<{ status: "ok"; database: "ok" }> {
    try {
      await this.pool.query("SELECT 1");
    } catch {
      throw new HttpException({ status: "unavailable", database: "unreachable" }, 503);
    }
    return { status: "ok", database: "ok" };
  }
}
