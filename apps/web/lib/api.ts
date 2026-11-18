import type { ErrorCode, ErrorResponse } from "@hv/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";

/** Cookie of the interface that carries the API session token. */
export const SESSION_COOKIE = "session";

/** Holds the two-factor secret between the two setup steps; never in the URL. */
export const TOTP_SETUP_COOKIE = "totp_setup";

/** Holds freshly created recovery codes until the user confirms having noted them. */
export const RECOVERY_CODES_COOKIE = "recovery_codes";

/** An error answer of the API. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly fields: readonly string[] = [],
  ) {
    super(`API answered ${status} ${code}`);
    this.name = "ApiFailure";
  }
}

/** Raw request to the API with the user's session. Never called from the browser. */
export async function apiRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // The client's address as the reverse proxy reported it, so the API can
  // rate-limit per client and not per web server (see TRUST_PROXY there).
  const forwardedFor = (await headers()).get("x-forwarded-for");
  return fetch(`${config.apiUrl}${path}`, {
    method,
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { cookie: `session=${token}` } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Calls the API and returns the parsed answer. Without a valid session the
 * user is sent to the login page; other errors throw ApiFailure.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, path, body);
  if (res.status === 401) {
    const error = await readError(res);
    if (error.code === "unauthenticated") redirect("/login");
    throw new ApiFailure(res.status, error.code, error.fields);
  }
  if (!res.ok) {
    const error = await readError(res);
    throw new ApiFailure(res.status, error.code, error.fields);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T>(path: string) => api<T>("GET", path);

/** Sends a file as the raw body. Errors throw ApiFailure like `api`. */
export async function apiUpload<T>(path: string, bytes: ArrayBuffer): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/octet-stream", ...(token ? { cookie: `session=${token}` } : {}) },
    body: bytes,
  });
  if (!res.ok) {
    const error = await readError(res);
    throw new ApiFailure(res.status, error.code, error.fields);
  }
  return (await res.json()) as T;
}

async function readError(res: Response): Promise<ErrorResponse> {
  try {
    const body = (await res.json()) as Partial<ErrorResponse>;
    if (typeof body.code === "string") return { code: body.code, fields: body.fields ?? [] };
  } catch {
    // fall through
  }
  throw new Error(`API answered ${res.status} without an error code`);
}

/** Takes the session token from the API's Set-Cookie header and stores it in the interface's cookie. */
export async function adoptSession(res: Response): Promise<void> {
  const match = /(?:^|,\s*)session=([^;]*);[^,]*Max-Age=(\d+)/i.exec(res.headers.get("set-cookie") ?? "");
  if (!match) throw new Error("API answered without a session cookie");
  (await cookies()).set(SESSION_COOKIE, match[1]!, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: Number(match[2]),
  });
}
