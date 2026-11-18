import { Module } from "@nestjs/common";
import { ConfigModule } from "./common/config.module.js";
import { DatabaseModule } from "./common/database.module.js";
import { BankingModule } from "./modules/banking/index.js";
import { DeadlinesModule } from "./modules/deadlines/index.js";
import { DocumentsModule } from "./modules/documents/index.js";
import { FinanceModule } from "./modules/finance/index.js";
import { HealthModule } from "./modules/health/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { MeteringModule } from "./modules/metering/index.js";
import { OrganizationModule } from "./modules/organization/index.js";
import { PropertyModule } from "./modules/property/index.js";
import { SettlementModule } from "./modules/settlement/index.js";
import { TenancyModule } from "./modules/tenancy/index.js";

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, IdentityModule, PropertyModule, TenancyModule, MeteringModule, FinanceModule, BankingModule, SettlementModule, OrganizationModule, DocumentsModule, DeadlinesModule],
})
export class AppModule {}
