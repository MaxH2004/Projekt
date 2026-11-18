import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

export { FinanceService, type PaymentInput } from "./finance.service.js";

@Module({ imports: [IdentityModule], controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
