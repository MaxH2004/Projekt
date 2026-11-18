import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  applyCreditSchema,
  creditRefundSchema,
  type CreditRefund,
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
import { CreditService } from "./credit.service.js";
import { FinanceService } from "./finance.service.js";

@Controller()
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly credit: CreditService,
  ) {}

  /** Covers open charges with the tenancy's credit. */
  @Post("tenancies/:id/apply-credit")
  @HttpCode(200)
  applyCredit(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<{ appliedCents: number }> {
    return this.credit.applyCredit(auth.tenantId, parseId(id), parseBody(applyCreditSchema, body).bookingDate);
  }

  @Get("tenancies/:id/refunds")
  refunds(@Auth() auth: AuthContext, @Param("id") id: string): Promise<CreditRefund[]> {
    return this.credit.listRefunds(auth.tenantId, parseId(id));
  }

  /** Money paid back to the tenant from the bank, without an imported transaction. */
  @Post("tenancies/:id/refunds")
  refund(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<CreditRefund> {
    return this.credit.refund(auth.tenantId, { tenancyId: parseId(id), ...parseBody(creditRefundSchema, body) });
  }

  @Post("refunds/:id/reverse")
  @HttpCode(200)
  reverseRefund(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<CreditRefund> {
    return this.credit.reverseRefund(auth.tenantId, parseId(id), parseBody(paymentReverseSchema, body).bookingDate);
  }

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
