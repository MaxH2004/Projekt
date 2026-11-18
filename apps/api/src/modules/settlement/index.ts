import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { SettlementController } from "./settlement.controller.js";
import { SettlementService } from "./settlement.service.js";

@Module({ imports: [IdentityModule], controllers: [SettlementController], providers: [SettlementService] })
export class SettlementModule {}
