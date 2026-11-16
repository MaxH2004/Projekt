import { Module } from "@nestjs/common";
import { ConfigModule } from "./common/config.module.js";
import { DatabaseModule } from "./common/database.module.js";
import { HealthModule } from "./modules/health/index.js";
import { IdentityModule } from "./modules/identity/index.js";

@Module({ imports: [ConfigModule, DatabaseModule, HealthModule, IdentityModule] })
export class AppModule {}
