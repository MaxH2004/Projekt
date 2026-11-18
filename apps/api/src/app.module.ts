import { Module } from "@nestjs/common";
import { ConfigModule } from "./common/config.module.js";
import { DatabaseModule } from "./common/database.module.js";
import { FinanceModule } from "./modules/finance/index.js";
import { HealthModule } from "./modules/health/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { MeteringModule } from "./modules/metering/index.js";
import { PropertyModule } from "./modules/property/index.js";
import { TenancyModule } from "./modules/tenancy/index.js";

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, IdentityModule, PropertyModule, TenancyModule, MeteringModule, FinanceModule],
})
export class AppModule {}
