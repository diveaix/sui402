import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, RedisRateLimiter } from "./rate-limit.js";

class FakeRedis {
  counts = new Map<string, number>();
  expirations = new Map<string, number>();

  incr(key: string): number {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }

  pExpire(key: string, milliseconds: number): true {
    this.expirations.set(key, milliseconds);
    return true;
  }
}

describe("rate limiters", () => {
  it("limits in-memory fixed windows", () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, maxRequests: 2 });

    expect(limiter.check("client", 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check("client", 1)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check("client", 2)).toMatchObject({ allowed: false });
    expect(limiter.check("client", 1000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("limits across Redis-backed fixed windows", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter({
      client: redis,
      windowMs: 1000,
      maxRequests: 2
    });

    await expect(limiter.check("client", 0)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.check("client", 1)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter.check("client", 2)).resolves.toMatchObject({ allowed: false });
    expect([...redis.expirations.values()]).toEqual([1000]);
  });
});
