import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  bankImportSchema,
  bankTransactionBookSchema,
  bankTransactionExpenseSchema,
  bankTransactionOtherSchema,
  bankTransactionRefundSchema,
  paymentReverseSchema,
  type CreditRefund,
  bankTransactionIgnoreSchema,
  type BankImportResult,
  type BankTransactionView,
  type Expense,
  type Payment,
} from "@hv/contracts";
import { ApiError, parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { BankingService } from "./banking.service.js";

@Controller()
@UseGuards(SessionGuard)
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  /** Imports a statement file. The body carries the file content as text. */
  @Post("bank-imports")
  @HttpCode(200)
  import(@Auth() auth: AuthContext, @Body() body: unknown): Promise<BankImportResult> {
    return this.banking.importCamt(auth.tenantId, parseBody(bankImportSchema, body).content);
  }

  /** `status=open` returns only transactions that are neither booked nor ignored. */
  @Get("bank-transactions")
  list(@Auth() auth: AuthContext, @Query("status") status?: string): Promise<BankTransactionView[]> {
    if (status !== undefined && status !== "open") throw new ApiError("validation_failed", ["status"]);
    return this.banking.listTransactions(auth.tenantId, status === "open");
  }

  @Post("bank-transactions/:id/book")
  book(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Payment> {
    return this.banking.book(auth.tenantId, parseId(id), parseBody(bankTransactionBookSchema, body));
  }

  @Post("bank-transactions/:id/book-expense")
  bookExpense(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Expense> {
    return this.banking.bookExpense(auth.tenantId, parseId(id), parseBody(bankTransactionExpenseSchema, body));
  }

  @Post("bank-transactions/:id/book-refund")
  bookRefund(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<CreditRefund> {
    return this.banking.bookRefund(auth.tenantId, parseId(id), parseBody(bankTransactionRefundSchema, body));
  }

  @Post("bank-transactions/:id/book-other")
  bookOther(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<BankTransactionView> {
    return this.banking.bookOther(auth.tenantId, parseId(id), parseBody(bankTransactionOtherSchema, body));
  }

  @Post("bank-bookings/:id/reverse")
  @HttpCode(204)
  reverseOther(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    return this.banking.reverseOther(auth.tenantId, parseId(id), parseBody(paymentReverseSchema, body).bookingDate);
  }

  @Put("bank-transactions/:id/ignored")
  setIgnored(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<BankTransactionView> {
    return this.banking.setIgnored(auth.tenantId, parseId(id), parseBody(bankTransactionIgnoreSchema, body).ignored);
  }
}
