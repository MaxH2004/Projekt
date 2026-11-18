import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { isoDateSchema, type Deadline } from "@hv/contracts";
import { ApiError } from "../../common/api-error.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { DeadlinesService } from "./deadlines.service.js";

@Controller("deadlines")
@UseGuards(SessionGuard)
export class DeadlinesController {
  constructor(private readonly deadlines: DeadlinesService) {}

  /** `today` can be given for tests and previews; it defaults to the server's date. */
  @Get()
  list(@Auth() auth: AuthContext, @Query("today") today?: string): Promise<Deadline[]> {
    const day = today === undefined ? new Date().toISOString().slice(0, 10) : isoDateSchema.safeParse(today).data;
    if (!day) throw new ApiError("validation_failed", ["today"]);
    return this.deadlines.list(auth.tenantId, day);
  }
}
