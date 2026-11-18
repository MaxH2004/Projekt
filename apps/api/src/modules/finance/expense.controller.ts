import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  expenseInputSchema,
  expenseReverseSchema,
  incomeStatementQuerySchema,
  isoDateSchema,
  type Account,
  type Expense,
  type IncomeStatement,
} from "@hv/contracts";
import { ApiError, parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { ExpenseService } from "./expense.service.js";

@Controller()
@UseGuards(SessionGuard)
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get("accounts")
  accounts(@Auth() auth: AuthContext): Promise<Account[]> {
    return this.expenses.listAccounts(auth.tenantId);
  }

  @Get("expenses")
  list(@Auth() auth: AuthContext, @Query("propertyId") propertyId?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<Expense[]> {
    for (const [name, value] of [["from", from], ["to", to]] as const) {
      if (value !== undefined && !isoDateSchema.safeParse(value).success) throw new ApiError("validation_failed", [name]);
    }
    return this.expenses.listExpenses(auth.tenantId, { propertyId: propertyId === undefined ? undefined : parseId(propertyId), from, to });
  }

  @Post("expenses")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Expense> {
    return this.expenses.recordExpense(auth.tenantId, parseBody(expenseInputSchema, body));
  }

  @Post("expenses/:id/reverse")
  @HttpCode(200)
  reverse(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Expense> {
    return this.expenses.reverseExpense(auth.tenantId, parseId(id), parseBody(expenseReverseSchema, body).bookingDate);
  }

  /** Income and expenses per property for a period, e.g. a calendar year. */
  @Get("reports/income-statement")
  incomeStatement(@Auth() auth: AuthContext, @Query("from") from?: string, @Query("to") to?: string): Promise<IncomeStatement> {
    const query = parseBody(incomeStatementQuerySchema, { from, to });
    return this.expenses.incomeStatement(auth.tenantId, query.from, query.to);
  }
}
