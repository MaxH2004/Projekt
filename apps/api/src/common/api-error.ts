import { HttpException } from "@nestjs/common";
import type { ErrorCode, ErrorResponse } from "@hv/contracts";
import type { z } from "zod";

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  account_locked: 429,
  totp_required: 401,
  invalid_totp: 401,
  totp_not_set_up: 409,
  totp_already_enabled: 409,
  email_taken: 409,
  not_found: 404,
  conflict: 409,
};

/** An error the client can act on. The body is `{ code, fields? }`, never a sentence. */
export class ApiError extends HttpException {
  constructor(code: ErrorCode, fields?: readonly string[]) {
    const body: ErrorResponse = fields ? { code, fields } : { code };
    super(body, STATUS[code]);
  }
}

/** Validates a request body against a shared schema. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
  throw new ApiError("validation_failed", fields);
}
