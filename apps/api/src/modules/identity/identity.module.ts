import { Module } from "@nestjs/common";
import { RateLimiter } from "../../common/rate-limit.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, SessionGuard, RateLimiter],
  exports: [IdentityService, SessionGuard, RateLimiter],
})
export class IdentityModule {}
