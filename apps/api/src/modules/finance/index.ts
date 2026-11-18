import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { CreditService } from "./credit.service.js";
import { ExpenseController } from "./expense.controller.js";
import { ExpenseService } from "./expense.service.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

export { CreditService, type RefundInput } from "./credit.service.js";
export { ExpenseService, type ExpenseInput } from "./expense.service.js";
export { FinanceService, type PaymentInput } from "./finance.service.js";
export { ENTRY_DESCRIPTION, NOT_FOR_OTHER_BOOKINGS, POSTING_ACCOUNTS } from "./posting-rules.js";

@Module({
  imports: [IdentityModule],
  controllers: [FinanceController, ExpenseController],
  providers: [FinanceService, ExpenseService, CreditService],
  exports: [FinanceService, ExpenseService, CreditService],
})
export class FinanceModule {}
