import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { ApiError } from "../../common/api-error.js";
import { currentRequest } from "../../common/request-context.js";
import { IdentityService, type AuthContext } from "./identity.service.js";

export const SESSION_COOKIE = "session";

export type AuthenticatedRequest = Request & { auth?: AuthContext; sessionToken?: string };

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Requires a valid session and attaches the user and tenant to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const auth = token ? await this.identity.resolveSession(token) : null;
    if (!auth || !token) throw new ApiError("unauthenticated");
    request.auth = auth;
    request.sessionToken = token;
    // Read by TenantDb, so the audit log knows who made a change.
    const requestContext = currentRequest();
    if (requestContext) requestContext.userId = auth.userId;
    return true;
  }
}

/** Injects the AuthContext set by SessionGuard into a handler parameter. */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new ApiError("unauthenticated");
  return auth;
});
