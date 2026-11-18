import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/index.js";
import { IdentityModule } from "../identity/index.js";
import { BankingController } from "./banking.controller.js";
import { BankingService } from "./banking.service.js";

@Module({ imports: [IdentityModule, FinanceModule], controllers: [BankingController], providers: [BankingService] })
export class BankingModule {}
