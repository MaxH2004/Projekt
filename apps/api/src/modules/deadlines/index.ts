import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { DeadlinesController } from "./deadlines.controller.js";
import { DeadlinesService } from "./deadlines.service.js";

@Module({ imports: [IdentityModule], controllers: [DeadlinesController], providers: [DeadlinesService] })
export class DeadlinesModule {}
