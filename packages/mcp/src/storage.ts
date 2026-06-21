import { Pool } from "pg";
import { createClient } from "redis";
import { PostgresPaymentRecordStore, RedisChallengeStore } from "@sui402/storage";
import type { ChallengeStore, PaymentRecordStore } from "@sui402/server";
import type { McpConfig } from "./config.js";

export type McpStorage = {
  challengeStore?: ChallengeStore;
  paymentRecords?: PaymentRecordStore;
  close: () => Promise<void>;
};

export async function createMcpStorage(config: McpConfig): Promise<McpStorage> {
  enforceProductionStorage(config);

  const closers: Array<() => Promise<void>> = [];
  let challengeStore: ChallengeStore | undefined;
  let paymentRecords: PaymentRecordStore | undefined;

  if (config.SUI402_REDIS_URL) {
    const redis = createClient({ url: config.SUI402_REDIS_URL });
    redis.on("error", (error) => {
      console.error("Redis MCP storage error", error);
    });
    await redis.connect();
    closers.push(async () => {
      await redis.quit();
    });
    challengeStore = new RedisChallengeStore({ client: redis });
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
  }

  return {
    challengeStore,
    paymentRecords,
    close: async () => {
      await Promise.allSettled(closers.map((close) => close()));
    }
  };
}

function enforceProductionStorage(config: McpConfig): void {
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
    throw new Error(`Production MCP server requires durable storage: ${missing.join(", ")}`);
  }
}
