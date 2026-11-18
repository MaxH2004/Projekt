import { Body, Controller, Get, Put, Query, UseGuards } from "@nestjs/common";
import { auditQuerySchema, organizationDetailsSchema, type AuditEntry, type OrganizationDetails } from "@hv/contracts";
import { parseBody } from "../../common/api-error.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { OrganizationService } from "./organization.service.js";

@Controller("organization")
@UseGuards(SessionGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get("details")
  details(@Auth() auth: AuthContext): Promise<OrganizationDetails> {
    return this.organization.details(auth.tenantId);
  }

  @Put("details")
  save(@Auth() auth: AuthContext, @Body() body: unknown): Promise<OrganizationDetails> {
    return this.organization.saveDetails(auth.tenantId, parseBody(organizationDetailsSchema, body));
  }

  @Get("audit-log")
  auditLog(@Auth() auth: AuthContext, @Query() query: Record<string, string>): Promise<AuditEntry[]> {
    const q = parseBody(auditQuerySchema, query);
    return this.organization.auditLog(auth.tenantId, q.limit, q.before);
  }
}
