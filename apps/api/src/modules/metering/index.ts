import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { MeteringController } from "./metering.controller.js";
import { MeteringService } from "./metering.service.js";

@Module({ imports: [IdentityModule], controllers: [MeteringController], providers: [MeteringService] })
export class MeteringModule {}
