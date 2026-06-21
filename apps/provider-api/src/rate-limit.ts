import type { Request, RequestHandler } from "express";

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  key?: (req: Request) => string;
  limiter?: RateLimiter;
};

type Bucket = {
  resetAt: number;
  count: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; retryAfterSeconds: number; resetAt: number };

export type RateLimiter = {
  check(key: string, now?: number): RateLimitResult | Promise<RateLimitResult>;
};

export type RedisRateLimitClient = {
  incr(key: string): Promise<number> | number;
  pExpire(key: string, milliseconds: number): Promise<unknown> | unknown;
};

export type RedisRateLimiterOptions = {
  client: RedisRateLimitClient;
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
};

export class InMemoryRateLimiter {
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    this.#windowMs = options.windowMs;
    this.#maxRequests = options.maxRequests;
  }

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.#buckets.get(key);
    const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + this.#windowMs } : existing;

    if (bucket.count >= this.#maxRequests) {
      this.#buckets.set(key, bucket);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        resetAt: bucket.resetAt
      };
    }

    bucket.count += 1;
    this.#buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(0, this.#maxRequests - bucket.count),
      resetAt: bucket.resetAt
    };
  }

  cleanup(now = Date.now()): void {
    for (const [key, bucket] of this.#buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
      }
    }
  }
}

export class RedisRateLimiter implements RateLimiter {
  readonly #client: RedisRateLimitClient;
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #keyPrefix: string;

  constructor(options: RedisRateLimiterOptions) {
    this.#client = options.client;
    this.#windowMs = options.windowMs;
    this.#maxRequests = options.maxRequests;
    this.#keyPrefix = options.keyPrefix ?? "sui402:rate-limit";
  }

  async check(key: string, now = Date.now()): Promise<RateLimitResult> {
    const windowStart = Math.floor(now / this.#windowMs) * this.#windowMs;
    const resetAt = windowStart + this.#windowMs;
    const redisKey = `${this.#keyPrefix}:${Buffer.from(key).toString("base64url")}:${windowStart}`;
    const count = await this.#client.incr(redisKey);
    if (count === 1) {
      await this.#client.pExpire(redisKey, this.#windowMs);
    }

    if (count > this.#maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        resetAt
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.#maxRequests - count),
      resetAt
    };
  }
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const limiter = options.limiter ?? new InMemoryRateLimiter(options);
  const key = options.key ?? ((req) => req.ip ?? "unknown");

  return async (req, res, next) => {
    const result = await limiter.check(key(req));
    res.setHeader("ratelimit-limit", String(options.maxRequests));
    res.setHeader("ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      res.setHeader("retry-after", String(result.retryAfterSeconds));
      res.status(429).json({
        error: "rate_limited",
        message: "Too many requests"
      });
      return;
    }

    res.setHeader("ratelimit-remaining", String(result.remaining));
    next();
  };
}
