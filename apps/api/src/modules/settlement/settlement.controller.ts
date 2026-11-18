import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  settlementConfigSchema,
  settlementFinalizeSchema,
  settlementPeriodSchema,
  type Settlement,
  type SettlementDraft,
  type SettlementResult,
  type SettlementSummary,
} from "@hv/contracts";
import { parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { SettlementService } from "./settlement.service.js";

@Controller("settlements")
@UseGuards(SessionGuard)
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query("propertyId") propertyId?: string): Promise<SettlementSummary[]> {
    return this.settlements.list(auth.tenantId, propertyId === undefined ? undefined : parseId(propertyId));
  }

  /** Data a settlement of the property for the period would use. */
  @Get("draft")
  draft(@Auth() auth: AuthContext, @Query() query: Record<string, string>): Promise<SettlementDraft> {
    const p = parseBody(settlementPeriodSchema, { propertyId: query.propertyId, from: query.from, to: query.to });
    return this.settlements.draft(auth.tenantId, p.propertyId, p.from, p.to);
  }

  @Post("preview")
  @HttpCode(200)
  preview(@Auth() auth: AuthContext, @Body() body: unknown): Promise<SettlementResult> {
    return this.settlements.preview(auth.tenantId, parseBody(settlementConfigSchema, body));
  }

  @Post()
  finalize(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Settlement> {
    return this.settlements.finalize(auth.tenantId, parseBody(settlementFinalizeSchema, body));
  }

  @Get(":id")
  get(@Auth() auth: AuthContext, @Param("id") id: string): Promise<Settlement> {
    return this.settlements.get(auth.tenantId, parseId(id));
  }
}
