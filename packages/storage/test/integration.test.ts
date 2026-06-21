import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import pg from "pg";
import { createChallenge } from "@sui402/protocol";
import { PostgresPaymentRecordStore, RedisChallengeStore } from "../src/index.js";
import type { PaymentRecord } from "@sui402/server";

const REDIS_URL = process.env.SUI402_REDIS_URL;
const POSTGRES_URL = process.env.SUI402_POSTGRES_URL;
const maybeDescribe = REDIS_URL && POSTGRES_URL ? describe : describe.skip;
const RECIPIENT = `0x${"a".repeat(64)}`;
const PAYER = `0x${"b".repeat(64)}`;

maybeDescribe("storage live integration", () => {
  let redis: RedisClientType;
  let pool: pg.Pool;
  let tableName: string;

  beforeAll(async () => {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();

    pool = new pg.Pool({ connectionString: POSTGRES_URL });
    tableName = `sui402_payment_records_${randomUUID().replaceAll("-", "_")}`;
  });

  afterAll(async () => {
    if (pool && tableName) {
      await pool.query(`drop table if exists ${tableName}`);
      await pool.end();
    }

    if (redis) {
      await redis.quit();
    }
  });

  it("round-trips challenge and payment records against live Redis/Postgres", async () => {
    const challengeStore = new RedisChallengeStore({
      client: redis,
      keyPrefix: `sui402:test:${randomUUID()}`
    });
    const paymentStore = new PostgresPaymentRecordStore({
      client: pool,
      tableName
    });
    await paymentStore.setup();

    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: RECIPIENT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const payment: PaymentRecord = {
      id: `payment-${randomUUID()}`,
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "digest",
        payer: PAYER,
        paidAt: "2026-05-19T00:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest",
        payer: PAYER,
        recipient: RECIPIENT,
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      resource: "api:*",
      createdAt: "2026-05-19T00:00:00.000Z"
    };

    await challengeStore.issue(challenge);
    expect(await challengeStore.get(challenge.id)).toEqual(challenge);
    expect(await challengeStore.consume(challenge.id)).toBe(true);
    expect(await challengeStore.consume(challenge.id)).toBe(false);

    await expect(paymentStore.record(payment)).resolves.toBe(true);
    await expect(paymentStore.record({ ...payment, id: `payment-${randomUUID()}` })).resolves.toBe(false);
    expect(await paymentStore.get(payment.id)).toEqual(payment);
    expect(await paymentStore.listByRecipient(RECIPIENT)).toHaveLength(1);
  });
});
