import { describe, expect, it } from "vitest";
import { createChallenge } from "@sui402/protocol";
import {
  PostgresChallengeStore,
  PostgresPaymentRecordStore,
  RedisChallengeStore,
  RedisReceiptSequenceStore,
  type PostgresQueryResult,
  type RedisLike
} from "../src/index.js";
import type { PaymentRecord } from "@sui402/server";

const RECIPIENT = `0x${"a".repeat(64)}`;
const PAYER = `0x${"b".repeat(64)}`;

class FakeRedis implements RedisLike {
  values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string, options = {}): string | null {
    if (options.NX && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    return "OK";
  }

  del(key: string): number {
    return this.values.delete(key) ? 1 : 0;
  }

  incr(key: string): number {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }
}

class FakePostgres {
  rows = new Map<string, Record<string, unknown>>();
  challenges = new Map<string, Record<string, unknown>>();
  consumedChallengeIds = new Set<string>();

  async query<Row = unknown>(text: string, values: unknown[] = []): Promise<PostgresQueryResult<Row>> {
    if (text.includes("insert into sui402_challenges")) {
      const [id, challenge, expiresAt] = values;
      this.challenges.set(String(id), {
        id,
        challenge: JSON.parse(String(challenge)),
        expires_at: expiresAt
      });
      return { rows: [] };
    }

    if (text.includes("delete from sui402_challenges")) {
      this.challenges.delete(String(values[0]));
      return { rows: [] };
    }

    if (text.includes("from sui402_challenges") && text.includes("where id = $1")) {
      const row = this.challenges.get(String(values[0]));
      return { rows: row ? ([{ challenge: row.challenge }] as Row[]) : [] };
    }

    if (text.includes("insert into sui402_consumed_challenges")) {
      const id = String(values[0]);
      if (this.consumedChallengeIds.has(id)) {
        return { rows: [] };
      }

      this.consumedChallengeIds.add(id);
      return { rows: [{ id }] as Row[] };
    }

    if (text.includes("insert into")) {
      const [
        id,
        recipient,
        payer,
        network,
        txDigest,
        coinType,
        amount,
        resource,
        challenge,
        proof,
        verification,
        receipt,
        createdAt
      ] = values;
      const alreadyRecorded = [...this.rows.values()].some(
        (row) => row.id === id || (row.network === network && row.tx_digest === txDigest)
      );
      if (alreadyRecorded) {
        return { rows: [] };
      }

      this.rows.set(String(id), {
        id,
        recipient,
        payer,
        network,
        tx_digest: txDigest,
        coin_type: coinType,
        amount,
        resource,
        challenge: JSON.parse(String(challenge)),
        proof: JSON.parse(String(proof)),
        verification: JSON.parse(String(verification)),
        receipt: receipt ? JSON.parse(String(receipt)) : undefined,
        created_at: createdAt
      });
      return { rows: [{ id }] as Row[] };
    }

    if (text.includes("where id = $1")) {
      const row = this.rows.get(String(values[0]));
      return { rows: row ? ([row] as Row[]) : [] };
    }

    if (text.includes("where network = $1 and tx_digest = $2")) {
      const row = [...this.rows.values()].find(
        (entry) => entry.network === values[0] && entry.tx_digest === values[1]
      );
      return { rows: row ? ([row] as Row[]) : [] };
    }

    if (text.includes("where tx_digest = $1")) {
      const txDigest = values[0];
      const network = values[1];
      const row = [...this.rows.values()].find(
        (entry) => entry.tx_digest === txDigest && (!network || entry.network === network)
      );
      return { rows: row ? ([row] as Row[]) : [] };
    }

    if (text.includes("where lower(recipient) = lower($1)")) {
      const recipient = String(values[0]).toLowerCase();
      return {
        rows: [...this.rows.values()].filter((row) => String(row.recipient).toLowerCase() === recipient) as Row[]
      };
    }

    if (text.includes("order by created_at desc")) {
      return { rows: [...this.rows.values()].slice(0, Number(values[0])) as Row[] };
    }

    return { rows: [] };
  }
}

describe("RedisChallengeStore", () => {
  it("stores challenges and consumes them once", async () => {
    const redis = new FakeRedis();
    const store = new RedisChallengeStore({ client: redis });
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: RECIPIENT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await store.issue(challenge);

    expect(await store.get(challenge.id)).toEqual(challenge);
    expect(await store.consume(challenge.id)).toBe(true);
    expect(await store.consume(challenge.id)).toBe(false);
    expect(await store.get(challenge.id)).toBeUndefined();
  });
});

describe("RedisReceiptSequenceStore", () => {
  it("increments receipt sequences by key", async () => {
    const redis = new FakeRedis();
    const store = new RedisReceiptSequenceStore({ client: redis });

    expect(await store.nextSequence("session:one")).toBe("1");
    expect(await store.nextSequence("session:one")).toBe("2");
    expect(await store.nextSequence("session:two")).toBe("1");
  });
});

describe("PostgresChallengeStore", () => {
  it("stores challenges and atomically consumes them once", async () => {
    const postgres = new FakePostgres();
    const store = new PostgresChallengeStore({ client: postgres });
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: RECIPIENT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await store.issue(challenge);

    expect(await store.get(challenge.id)).toEqual(challenge);
    expect(await store.consume(challenge.id)).toBe(true);
    expect(await store.consume(challenge.id)).toBe(false);
    expect(await store.get(challenge.id)).toBeUndefined();
  });
});

describe("PostgresPaymentRecordStore", () => {
  it("records and reads payment ledger entries", async () => {
    const postgres = new FakePostgres();
    const store = new PostgresPaymentRecordStore({ client: postgres });
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: RECIPIENT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const payment: PaymentRecord = {
      id: "payment-1",
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

    await expect(store.record(payment)).resolves.toBe(true);

    expect(await store.get("payment-1")).toEqual(payment);
    expect(await store.getByProof("sui:testnet", "digest")).toEqual(payment);
    expect(await store.getByTxDigest("digest")).toEqual(payment);
    expect(await store.getByTxDigest("digest", "sui:testnet")).toEqual(payment);
    expect(await store.getByTxDigest("digest", "sui:mainnet")).toBeUndefined();
    expect(await store.listByRecipient(RECIPIENT.toUpperCase())).toHaveLength(1);
    expect(await store.listRecent(1)).toEqual([payment]);
  });

  it("rejects duplicate payment IDs and transaction digests atomically", async () => {
    const postgres = new FakePostgres();
    const store = new PostgresPaymentRecordStore({ client: postgres });
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: RECIPIENT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const payment: PaymentRecord = {
      id: "payment-1",
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "duplicate-digest",
        payer: PAYER,
        paidAt: "2026-05-19T00:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "duplicate-digest",
        payer: PAYER,
        recipient: RECIPIENT,
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      resource: "api:*",
      createdAt: "2026-05-19T00:00:00.000Z"
    };

    expect(await store.record(payment)).toBe(true);
    expect(await store.record(payment)).toBe(false);
    expect(
      await store.record({
        ...payment,
        id: "payment-2"
      })
    ).toBe(false);
    expect(await store.listRecent(10)).toHaveLength(1);
  });
});
