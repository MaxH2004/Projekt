import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  emailChangeSchema,
  localeChangeSchema,
  loginRequestSchema,
  passwordChangeSchema,
  registerRequestSchema,
  secondFactorConfirmSchema,
  totpEnableRequestSchema,
  type MeResponse,
  type RecoveryCodesResponse,
  type TotpSetupResponse,
} from "@hv/contracts";
import type { Request, Response } from "express";
import { parseBody } from "../../common/api-error.js";
import { APP_CONFIG, type AppConfig } from "../../common/config.js";
import { RateLimiter } from "../../common/rate-limit.js";
import { IdentityService, type AuthContext, type NewSession } from "./identity.service.js";
import { Auth, SESSION_COOKIE, SessionGuard, type AuthenticatedRequest } from "./session.guard.js";

@Controller("auth")
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("register")
  async register(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.limiter.hit("register", clientOf(req));
    this.setCookie(res, await this.identity.register(parseBody(registerRequestSchema, body)));
  }

  @Post("login")
  @HttpCode(204)
  async login(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.limiter.hit("credentials", clientOf(req));
    this.setCookie(res, await this.identity.login(parseBody(loginRequestSchema, body)));
  }

  @Post("password")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changePassword(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    this.limiter.hit("credentials", clientOf(req));
    const input = parseBody(passwordChangeSchema, body);
    await this.identity.changePassword(req.auth!, req.sessionToken!, input.currentPassword, input.newPassword);
  }

  @Post("email")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changeEmail(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    this.limiter.hit("credentials", clientOf(req));
    const input = parseBody(emailChangeSchema, body);
    await this.identity.changeEmail(req.auth!, input.password, input.email);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.identity.logout(req.sessionToken!);
    this.setCookie(res, { token: "", maxAgeSeconds: 0 });
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return this.identity.me(auth);
  }

  @Post("locale")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async setLocale(@Auth() auth: AuthContext, @Body() body: unknown): Promise<void> {
    await this.identity.setLocale(auth, parseBody(localeChangeSchema, body).locale);
  }

  @Post("totp/setup")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  setupTotp(@Auth() auth: AuthContext): Promise<TotpSetupResponse> {
    return this.identity.setupTotp(auth);
  }

  /** Returns the recovery codes; they are shown only this once. */
  @Post("totp/enable")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  enableTotp(@Auth() auth: AuthContext, @Body() body: unknown): Promise<RecoveryCodesResponse> {
    return this.identity.enableTotp(auth, parseBody(totpEnableRequestSchema, body).code);
  }

  @Post("totp/disable")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async disableTotp(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    this.limiter.hit("credentials", clientOf(req));
    const { password, ...factor } = parseBody(secondFactorConfirmSchema, body);
    await this.identity.disableTotp(req.auth!, password, factor);
  }

  @Post("totp/recovery-codes")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  regenerateRecoveryCodes(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<RecoveryCodesResponse> {
    this.limiter.hit("credentials", clientOf(req));
    const { password, ...factor } = parseBody(secondFactorConfirmSchema, body);
    return this.identity.regenerateRecoveryCodes(req.auth!, password, factor);
  }

  private setCookie(res: Response, session: NewSession): void {
    const attributes = [`${SESSION_COOKIE}=${session.token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${session.maxAgeSeconds}`];
    if (this.config.cookieSecure) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
  }
}

/** The client's address; behind a trusted proxy taken from X-Forwarded-For (see TRUST_PROXY). */
function clientOf(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
