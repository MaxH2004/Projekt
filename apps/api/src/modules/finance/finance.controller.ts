import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  chargeGenerateSchema,
  monthSchema,
  paymentInputSchema,
  paymentReverseSchema,
  type Payment,
  type RentCharge,
  type TenancyBalance,
} from "@hv/contracts";
import { ApiError, parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { FinanceService } from "./finance.service.js";

@Controller()
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Creates the missing charges of all tenancies for a month. */
  @Post("charges/generate")
  @HttpCode(200)
  generate(@Auth() auth: AuthContext, @Body() body: unknown): Promise<RentCharge[]> {
    return this.finance.generateCharges(auth.tenantId, parseBody(chargeGenerateSchema, body).month);
  }

  /** `status=open` returns only charges with an amount still open. */
  @Get("charges")
  listCharges(
    @Auth() auth: AuthContext,
    @Query("tenancyId") tenancyId?: string,
    @Query("month") month?: string,
    @Query("status") status?: string,
  ): Promise<RentCharge[]> {
    if (month !== undefined && !monthSchema.safeParse(month).success) throw new ApiError("validation_failed", ["month"]);
    if (status !== undefined && status !== "open") throw new ApiError("validation_failed", ["status"]);
    return this.finance.listCharges(auth.tenantId, {
      tenancyId: tenancyId === undefined ? undefined : parseId(tenancyId),
      month,
      openOnly: status === "open",
    });
  }

  @Post("charges/:id/cancel")
  @HttpCode(200)
  cancelCharge(@Auth() auth: AuthContext, @Param("id") id: string): Promise<RentCharge> {
    return this.finance.cancelCharge(auth.tenantId, parseId(id));
  }

  @Get("payments")
  listPayments(@Auth() auth: AuthContext, @Query("tenancyId") tenancyId?: string): Promise<Payment[]> {
    return this.finance.listPayments(auth.tenantId, tenancyId === undefined ? undefined : parseId(tenancyId));
  }

  @Post("payments")
  recordPayment(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Payment> {
    return this.finance.recordPayment(auth.tenantId, parseBody(paymentInputSchema, body));
  }

  @Post("payments/:id/reverse")
  @HttpCode(200)
  reversePayment(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Payment> {
    return this.finance.reversePayment(auth.tenantId, parseId(id), parseBody(paymentReverseSchema, body).bookingDate);
  }

  @Get("tenancies/:id/balance")
  balance(@Auth() auth: AuthContext, @Param("id") id: string): Promise<TenancyBalance> {
    return this.finance.balance(auth.tenantId, parseId(id));
  }
}
