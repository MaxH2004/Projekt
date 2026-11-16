export interface AppConfig {
  readonly databaseUrl: string;
  /** Base64 of 32 random bytes; encrypts TOTP secrets at rest. */
  readonly authSecretKey: string;
  /** Session cookies are sent over HTTPS only. Turn off only for local development. */
  readonly cookieSecure: boolean;
  /** Name shown in authenticator apps. */
  readonly totpIssuer: string;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    databaseUrl: required("DATABASE_URL"),
    authSecretKey: required("AUTH_SECRET_KEY"),
    cookieSecure: env.COOKIE_SECURE !== "false",
    totpIssuer: env.TOTP_ISSUER ?? "Hausverwaltung",
  };
}
