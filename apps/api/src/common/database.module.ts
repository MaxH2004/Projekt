import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import pg from "pg";
import { APP_CONFIG, type AppConfig } from "./config.js";

export const PG_POOL = Symbol("PG_POOL");

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new pg.Pool({ connectionString: config.databaseUrl }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
