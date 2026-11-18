import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { ExpenseController } from "./expense.controller.js";
import { ExpenseService } from "./expense.service.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

export { ExpenseService, type ExpenseInput } from "./expense.service.js";
export { FinanceService, type PaymentInput } from "./finance.service.js";

@Module({
  imports: [IdentityModule],
  controllers: [FinanceController, ExpenseController],
  providers: [FinanceService, ExpenseService],
  exports: [FinanceService, ExpenseService],
})
export class FinanceModule {}
