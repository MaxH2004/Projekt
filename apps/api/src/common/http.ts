import type { NestExpressApplication } from "@nestjs/platform-express";
import { BANK_STATEMENT_MAX_LENGTH } from "@hv/contracts";

/**
 * HTTP settings shared by the server and the tests. JSON bodies may be large
 * enough for an uploaded bank statement (the content travels as a JSON
 * string), with some room for escaping.
 */
export function configureHttp(app: NestExpressApplication): void {
  app.useBodyParser("json", { limit: BANK_STATEMENT_MAX_LENGTH * 2 });
}
