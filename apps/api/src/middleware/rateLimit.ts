import type { Context, Next } from "hono";

/**
 * A small in-memory fixed-window rate limiter (plan §5.5).
 *
 * Guild-scale, single-process: an in-memory window is enough and needs no Redis.
 * Kept as a pure class — no `Date.now`, no Hono — so the allow/deny/reset logic
 * is exhaustively testable; the middleware below is the thin adapter.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

/** Keep the map from growing without bound if many distinct keys appear once. */
const MAX_TRACKED_KEYS = 10_000;

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const entry = this.hits.get(key);

    if (!entry || t >= entry.resetAt) {
      if (this.hits.size >= MAX_TRACKED_KEYS) this.prune(t);
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (entry.count < this.limit) {
      entry.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: entry.resetAt - t };
  }

  private prune(t: number): void {
    for (const [key, entry] of this.hits) {
      if (t >= entry.resetAt) this.hits.delete(key);
    }
  }
}

/**
 * Best-effort client IP. Behind Caddy this is `X-Forwarded-For`'s first hop;
 * `local` is the dev fallback (no proxy), where everything shares one bucket —
 * fine, since dev isn't the thing being protected.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "local";
}

/**
 * A Hono middleware that rejects with 429 (+ `Retry-After`) once `limiter`'s
 * window is exhausted for the request's key (default: client IP).
 */
export function rateLimit(
  limiter: FixedWindowRateLimiter,
  keyOf: (c: Context) => string = clientIp,
) {
  return async (c: Context, next: Next) => {
    const { allowed, retryAfterMs } = limiter.check(keyOf(c));
    if (!allowed) {
      c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return c.json({ error: "Too many requests. Please slow down." }, 429);
    }
    await next();
  };
}
