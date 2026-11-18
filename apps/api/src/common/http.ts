import type { NestExpressApplication } from "@nestjs/platform-express";
import { BANK_STATEMENT_MAX_LENGTH, DOCUMENT_MAX_BYTES } from "@hv/contracts";
import type { NextFunction, Request, Response } from "express";
import { requestContextMiddleware } from "./request-context.js";

/**
 * HTTP settings shared by the server and the tests.
 *
 * - JSON bodies may be large enough for an uploaded bank statement (the
 *   content travels as a JSON string), with some room for escaping.
 * - The API answers JSON only and is never shown in a browser frame; the
 *   headers say so. No CORS headers are sent, so browsers on other origins
 *   cannot read answers.
 * - TRUST_PROXY names the proxies whose X-Forwarded-For is believed (e.g.
 *   "loopback" when the web app runs on the same machine); without it the
 *   socket address counts, which is what rate limits are keyed by.
 */
export function configureHttp(app: NestExpressApplication, env: NodeJS.ProcessEnv = process.env): void {
  app.useBodyParser("json", { limit: BANK_STATEMENT_MAX_LENGTH * 2 });
  // Uploaded files arrive as the raw body; only the upload route reads it.
  app.useBodyParser("raw", { type: "application/octet-stream", limit: DOCUMENT_MAX_BYTES });
  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY);
  app.use(requestContextMiddleware);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
}
