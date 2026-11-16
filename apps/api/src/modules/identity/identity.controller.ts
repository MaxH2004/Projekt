import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  loginRequestSchema,
  registerRequestSchema,
  totpEnableRequestSchema,
  type MeResponse,
  type TotpSetupResponse,
} from "@hv/contracts";
import type { Response } from "express";
import { parseBody } from "../../common/api-error.js";
import { APP_CONFIG, type AppConfig } from "../../common/config.js";
import { IdentityService, type AuthContext, type NewSession } from "./identity.service.js";
import { Auth, SESSION_COOKIE, SessionGuard, type AuthenticatedRequest } from "./session.guard.js";

@Controller("auth")
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.setCookie(res, await this.identity.register(parseBody(registerRequestSchema, body)));
  }

  @Post("login")
  @HttpCode(204)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.setCookie(res, await this.identity.login(parseBody(loginRequestSchema, body)));
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

  @Post("totp/setup")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  setupTotp(@Auth() auth: AuthContext): Promise<TotpSetupResponse> {
    return this.identity.setupTotp(auth);
  }

  @Post("totp/enable")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async enableTotp(@Auth() auth: AuthContext, @Body() body: unknown): Promise<void> {
    await this.identity.enableTotp(auth, parseBody(totpEnableRequestSchema, body).code);
  }

  private setCookie(res: Response, session: NewSession): void {
    const attributes = [`${SESSION_COOKIE}=${session.token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${session.maxAgeSeconds}`];
    if (this.config.cookieSecure) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
  }
}
