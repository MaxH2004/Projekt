import { Injectable } from "@nestjs/common";
import { ApiError } from "./api-error.js";

/** Attempts allowed per client address and window. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

export const DEFAULT_LIMITS = {
  /** Login and every check of a password or code. */
  credentials: { max: 20, windowMs: 60_000 },
  register: { max: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;
export type Bucket = keyof typeof DEFAULT_LIMITS;

/**
 * Fixed-window counter per client address, kept in memory. Enough for one
 * API process; several processes would each count on their own.
 */
@Injectable()
export class RateLimiter {
  /** Replaceable in tests. */
  limits: Record<Bucket, Limit> = { ...DEFAULT_LIMITS };
  now: () => number = Date.now;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /** Counts one attempt and throws `rate_limited` once the window is used up. */
  hit(bucket: Bucket, client: string): void {
    const limit = this.limits[bucket];
    const key = `${bucket}:${client}`;
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + limit.windowMs };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.prune(now);
    }
    window.count += 1;
    if (window.count > limit.max) throw new ApiError("rate_limited");
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
