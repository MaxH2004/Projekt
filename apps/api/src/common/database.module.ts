import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import pg from "pg";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { TenantDb } from "./tenant-db.js";

import { PG_POOL } from "./tokens.js";

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new pg.Pool({ connectionString: config.databaseUrl }),
    },
    TenantDb,
  ],
  exports: [PG_POOL, TenantDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
