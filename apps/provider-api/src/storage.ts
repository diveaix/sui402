import { Pool } from "pg";
import { createClient } from "redis";
import { PostgresPaymentRecordStore, RedisChallengeStore, RedisReceiptSequenceStore } from "@sui402/storage";
import type { ReceiptSequenceStore } from "@sui402/receipts";
import type { ChallengeStore, PaymentRecordStore } from "@sui402/server";
import type { ProviderConfig } from "./config.js";
import { RedisRateLimiter, type RateLimiter } from "./rate-limit.js";

export type ProviderStorage = {
  challengeStore?: ChallengeStore;
  paymentRecords?: PaymentRecordStore;
  rateLimiter?: RateLimiter;
  receiptSequenceStore?: ReceiptSequenceStore;
  readinessChecks: Record<string, () => Promise<void>>;
  close: () => Promise<void>;
};

export async function createProviderStorage(config: ProviderConfig): Promise<ProviderStorage> {
  enforceProductionStorage(config);

  const closers: Array<() => Promise<void>> = [];
  let challengeStore: ChallengeStore | undefined;
  let paymentRecords: PaymentRecordStore | undefined;
  let rateLimiter: RateLimiter | undefined;
  let receiptSequenceStore: ReceiptSequenceStore | undefined;
  const readinessChecks: Record<string, () => Promise<void>> = {};

  if (config.SUI402_REDIS_URL) {
    const redis = createClient({ url: config.SUI402_REDIS_URL });
    redis.on("error", (error) => {
      console.error("Redis storage error", error);
    });
    await redis.connect();
    closers.push(async () => {
      await redis.quit();
    });
    challengeStore = new RedisChallengeStore({ client: redis });
    receiptSequenceStore = new RedisReceiptSequenceStore({ client: redis });
    rateLimiter = new RedisRateLimiter({
      client: redis,
      windowMs: config.SUI402_RATE_LIMIT_WINDOW_MS,
      maxRequests: config.SUI402_RATE_LIMIT_MAX_REQUESTS
    });
    readinessChecks.redis = async () => {
      if (!redis.isReady) {
        throw new Error("Redis client is not ready");
      }
      await redis.ping();
    };
  }

  if (config.SUI402_POSTGRES_URL) {
    const pool = new Pool({ connectionString: config.SUI402_POSTGRES_URL });
    closers.push(async () => {
      await pool.end();
    });
    const store = new PostgresPaymentRecordStore({
      client: pool,
      tableName: config.SUI402_PAYMENT_RECORD_TABLE
    });
    if (config.SUI402_RUN_STORAGE_MIGRATIONS) {
      await store.setup();
    }
    paymentRecords = store;
    readinessChecks.postgres = async () => {
      await pool.query("select 1");
    };
  }

  return {
    challengeStore,
    paymentRecords,
    rateLimiter,
    receiptSequenceStore,
    readinessChecks,
    close: async () => {
      await Promise.allSettled(closers.map((close) => close()));
    }
  };
}

function enforceProductionStorage(config: ProviderConfig): void {
  if (config.NODE_ENV !== "production") {
    return;
  }

  const missing: string[] = [];
  if (!config.SUI402_REDIS_URL) {
    missing.push("SUI402_REDIS_URL");
  }

  if (!config.SUI402_POSTGRES_URL) {
    missing.push("SUI402_POSTGRES_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Production provider requires durable storage: ${missing.join(", ")}`);
  }
}
