import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { TenancyController } from "./tenancy.controller.js";
import { TenancyService } from "./tenancy.service.js";

@Module({ imports: [IdentityModule], controllers: [TenancyController], providers: [TenancyService] })
export class TenancyModule {}
