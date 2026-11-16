import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PropertyController } from "./property.controller.js";
import { PropertyService } from "./property.service.js";

@Module({ imports: [IdentityModule], controllers: [PropertyController], providers: [PropertyService] })
export class PropertyModule {}
