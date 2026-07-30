import type { RequestHandler } from "express";

export interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private requestsSeen = 0;

  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitResult {
    const currentTime = this.now();
    this.requestsSeen += 1;
    if (this.requestsSeen % 1_000 === 0) {
      for (const [entryKey, value] of this.entries) {
        if (value.resetAt <= currentTime) this.entries.delete(entryKey);
      }
    }
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= currentTime) {
      entry = { count: 0, resetAt: currentTime + this.rule.windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    const allowed = entry.count <= this.rule.maxRequests;
    return {
      allowed,
      limit: this.rule.maxRequests,
      remaining: Math.max(0, this.rule.maxRequests - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000)),
      resetAt: entry.resetAt,
    };
  }
}

export interface RequestLimitPolicy {
  general: RateLimitRule;
  auth: RateLimitRule;
  heavy: RateLimitRule;
}

export function getRequestLimitPolicy(env: NodeJS.ProcessEnv = process.env): RequestLimitPolicy {
  return {
    general: {
      maxRequests: positiveInteger(env.API_RATE_LIMIT, 180, "API_RATE_LIMIT"),
      windowMs: 60_000,
    },
    auth: {
      maxRequests: positiveInteger(env.AUTH_RATE_LIMIT, 5, "AUTH_RATE_LIMIT"),
      windowMs: 15 * 60_000,
    },
    heavy: {
      maxRequests: positiveInteger(env.HEAVY_RATE_LIMIT, 20, "HEAVY_RATE_LIMIT"),
      windowMs: 10 * 60_000,
    },
  };
}

export function createRateLimitMiddleware(
  limiter: FixedWindowRateLimiter,
  label: string,
  skip?: (path: string) => boolean,
): RequestHandler {
  return (req, res, next) => {
    if (skip?.(req.path)) {
      next();
      return;
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const result = limiter.consume(key);
    res.setHeader("X-RateLimit-Limit", result.limit);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));
    if (result.allowed) {
      next();
      return;
    }

    res.setHeader("Retry-After", result.retryAfterSeconds);
    res.status(429).json({
      error: `Muitas requisicoes em ${label}. Tente novamente em ${result.retryAfterSeconds} segundos.`,
    });
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} deve ser um numero inteiro maior que zero.`);
  }
  return parsed;
}
