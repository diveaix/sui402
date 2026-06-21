import { Sui402ChallengeSchema, isExpired, type Sui402Challenge } from "@sui402/protocol";
import type { ReceiptSequenceStore } from "@sui402/receipts";
import type { ChallengeStore, PaymentRecord, PaymentRecordStore } from "@sui402/server";

export type RedisSetOptions = {
  EX?: number;
  NX?: boolean;
};

export type RedisLike = {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, options?: RedisSetOptions): Promise<unknown> | unknown;
  del(key: string): Promise<unknown> | unknown;
  incr?(key: string): Promise<number> | number;
};

export type RedisChallengeStoreOptions = {
  client: RedisLike;
  keyPrefix?: string;
  consumedTtlSeconds?: number;
};

export class RedisChallengeStore implements ChallengeStore {
  readonly #client: RedisLike;
  readonly #keyPrefix: string;
  readonly #consumedTtlSeconds: number;

  constructor(options: RedisChallengeStoreOptions) {
    this.#client = options.client;
    this.#keyPrefix = options.keyPrefix ?? "sui402";
    this.#consumedTtlSeconds = options.consumedTtlSeconds ?? 24 * 60 * 60;
  }

  async issue(challenge: Sui402Challenge): Promise<void> {
    const ttlSeconds = ttlUntil(challenge.expiresAt);
    if (ttlSeconds <= 0) {
      return;
    }

    await this.#client.set(this.#challengeKey(challenge.id), JSON.stringify(challenge), { EX: ttlSeconds });
  }

  async get(id: string): Promise<Sui402Challenge | undefined> {
    const raw = await this.#client.get(this.#challengeKey(id));
    if (!raw) {
      return undefined;
    }

    const challenge = Sui402ChallengeSchema.parse(JSON.parse(raw));
    if (isExpired(challenge.expiresAt)) {
      await this.#client.del(this.#challengeKey(id));
      return undefined;
    }

    return challenge;
  }

  async consume(id: string): Promise<boolean> {
    const consumed = await this.#client.set(this.#consumedKey(id), "1", {
      EX: this.#consumedTtlSeconds,
      NX: true
    });
    if (!isRedisSetSuccess(consumed)) {
      return false;
    }

    await this.#client.del(this.#challengeKey(id));
    return true;
  }

  #challengeKey(id: string): string {
    return `${this.#keyPrefix}:challenge:${id}`;
  }

  #consumedKey(id: string): string {
    return `${this.#keyPrefix}:consumed:${id}`;
  }
}

export type RedisReceiptSequenceStoreOptions = {
  client: RedisLike & { incr(key: string): Promise<number> | number };
  keyPrefix?: string;
};

export class RedisReceiptSequenceStore implements ReceiptSequenceStore {
  readonly #client: RedisLike & { incr(key: string): Promise<number> | number };
  readonly #keyPrefix: string;

  constructor(options: RedisReceiptSequenceStoreOptions) {
    this.#client = options.client;
    this.#keyPrefix = options.keyPrefix ?? "sui402";
  }

  async nextSequence(key: string): Promise<string> {
    const sequence = await this.#client.incr(`${this.#keyPrefix}:receipt-sequence:${key}`);
    return String(sequence);
  }
}

export type PostgresQueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

export type PostgresLike = {
  query<Row = unknown>(text: string, values?: unknown[]): Promise<PostgresQueryResult<Row>>;
};

export type PostgresPaymentRecordStoreOptions = {
  client: PostgresLike;
  tableName?: string;
};

export type PostgresChallengeStoreOptions = {
  client: PostgresLike;
  challengeTableName?: string;
  consumedTableName?: string;
};

export type PaymentRecordRow = {
  id: string;
  challenge: unknown;
  proof: unknown;
  verification: unknown;
  receipt?: unknown;
  resource: string;
  created_at: Date | string;
};

export type ChallengeRow = {
  challenge: unknown;
};

export class PostgresChallengeStore implements ChallengeStore {
  readonly #client: PostgresLike;
  readonly #challengeTableName: string;
  readonly #consumedTableName: string;

  constructor(options: PostgresChallengeStoreOptions) {
    this.#client = options.client;
    this.#challengeTableName = assertSafeSqlIdentifier(options.challengeTableName ?? "sui402_challenges");
    this.#consumedTableName = assertSafeSqlIdentifier(options.consumedTableName ?? "sui402_consumed_challenges");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#challengeTableName} (
        id text primary key,
        challenge jsonb not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      )
    `);
    await this.#client.query(`
      create table if not exists ${this.#consumedTableName} (
        id text primary key,
        consumed_at timestamptz not null default now()
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#challengeTableName}_expires_at_idx on ${this.#challengeTableName} (expires_at)`
    );
    await this.#client.query(
      `create index if not exists ${this.#consumedTableName}_consumed_at_idx on ${this.#consumedTableName} (consumed_at desc)`
    );
  }

  async issue(challenge: Sui402Challenge): Promise<void> {
    if (isExpired(challenge.expiresAt)) {
      return;
    }

    await this.#client.query(
      `
        insert into ${this.#challengeTableName} (id, challenge, expires_at)
        values ($1, $2::jsonb, $3)
        on conflict (id) do update set
          challenge = excluded.challenge,
          expires_at = excluded.expires_at
      `,
      [challenge.id, JSON.stringify(challenge), challenge.expiresAt]
    );
  }

  async get(id: string): Promise<Sui402Challenge | undefined> {
    const result = await this.#client.query<ChallengeRow>(
      `
        select challenge
        from ${this.#challengeTableName}
        where id = $1 and expires_at > now()
      `,
      [id]
    );
    const row = result.rows[0];
    if (!row) {
      await this.#client.query(`delete from ${this.#challengeTableName} where id = $1`, [id]);
      return undefined;
    }

    const challenge = Sui402ChallengeSchema.parse(row.challenge);
    if (isExpired(challenge.expiresAt)) {
      await this.#client.query(`delete from ${this.#challengeTableName} where id = $1`, [id]);
      return undefined;
    }

    return challenge;
  }

  async consume(id: string): Promise<boolean> {
    const result = await this.#client.query<{ id: string }>(
      `
        insert into ${this.#consumedTableName} (id)
        values ($1)
        on conflict (id) do nothing
        returning id
      `,
      [id]
    );
    if (result.rows.length === 0) {
      return false;
    }

    await this.#client.query(`delete from ${this.#challengeTableName} where id = $1`, [id]);
    return true;
  }
}

export class PostgresPaymentRecordStore implements PaymentRecordStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: PostgresPaymentRecordStoreOptions) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_payment_records");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        recipient text not null,
        payer text,
        network text not null,
        tx_digest text not null,
        coin_type text not null,
        amount numeric not null,
        resource text not null,
        challenge jsonb not null,
        proof jsonb not null,
        verification jsonb not null,
        receipt jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await this.#client.query(`alter table ${this.#tableName} add column if not exists tx_digest text`);
    await this.#client.query(`alter table ${this.#tableName} add column if not exists receipt jsonb`);
    await this.#client.query(`update ${this.#tableName} set tx_digest = proof->>'txDigest' where tx_digest is null`);
    await this.#client.query(`alter table ${this.#tableName} alter column tx_digest set not null`);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_recipient_created_at_idx on ${this.#tableName} (recipient, created_at desc)`
    );
    await this.#client.query(
      `create unique index if not exists ${this.#tableName}_network_tx_digest_uidx on ${this.#tableName} (network, tx_digest)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_tx_digest_idx on ${this.#tableName} (tx_digest)`
    );
  }

  async record(payment: PaymentRecord): Promise<boolean> {
    const result = await this.#client.query<{ id: string }>(
      `
        insert into ${this.#tableName} (
          id,
          recipient,
          payer,
          network,
          tx_digest,
          coin_type,
          amount,
          resource,
          challenge,
          proof,
          verification,
          receipt,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13)
        on conflict do nothing
        returning id
      `,
      [
        payment.id,
        payment.challenge.recipient,
        payment.proof.payer ?? payment.verification.payer,
        payment.challenge.network,
        payment.proof.txDigest,
        payment.challenge.coinType,
        payment.challenge.amount,
        payment.resource,
        JSON.stringify(payment.challenge),
        JSON.stringify(payment.proof),
        JSON.stringify(payment.verification),
        payment.receipt ? JSON.stringify(payment.receipt) : null,
        payment.createdAt
      ]
    );

    return result.rows.length > 0;
  }

  async getByProof(network: PaymentRecord["proof"]["network"], txDigest: string): Promise<PaymentRecord | undefined> {
    const result = await this.#client.query<PaymentRecordRow>(
      `
        select id, challenge, proof, verification, receipt, resource, created_at
        from ${this.#tableName}
        where network = $1 and tx_digest = $2
      `,
      [network, txDigest]
    );
    const row = result.rows[0];
    return row ? rowToPaymentRecord(row) : undefined;
  }

  async getByTxDigest(txDigest: string, network?: PaymentRecord["proof"]["network"]): Promise<PaymentRecord | undefined> {
    const filters = ["tx_digest = $1"];
    const values: unknown[] = [txDigest];
    if (network) {
      values.push(network);
      filters.push(`network = $${values.length}`);
    }

    const result = await this.#client.query<PaymentRecordRow>(
      `
        select id, challenge, proof, verification, receipt, resource, created_at
        from ${this.#tableName}
        where ${filters.join(" and ")}
        order by created_at desc, id desc
        limit 1
      `,
      values
    );
    const row = result.rows[0];
    return row ? rowToPaymentRecord(row) : undefined;
  }

  async get(id: string): Promise<PaymentRecord | undefined> {
    const result = await this.#client.query<PaymentRecordRow>(
      `
        select id, challenge, proof, verification, receipt, resource, created_at
        from ${this.#tableName}
        where id = $1
      `,
      [id]
    );
    const row = result.rows[0];
    return row ? rowToPaymentRecord(row) : undefined;
  }

  async listByRecipient(recipient: string): Promise<PaymentRecord[]> {
    const result = await this.#client.query<PaymentRecordRow>(
      `
        select id, challenge, proof, verification, receipt, resource, created_at
        from ${this.#tableName}
        where lower(recipient) = lower($1)
        order by created_at desc
      `,
      [recipient]
    );

    return result.rows.map(rowToPaymentRecord);
  }

  async listRecent(limit = 100): Promise<PaymentRecord[]> {
    const result = await this.#client.query<PaymentRecordRow>(
      `
        select id, challenge, proof, verification, receipt, resource, created_at
        from ${this.#tableName}
        order by created_at desc
        limit $1
      `,
      [limit]
    );

    return result.rows.map(rowToPaymentRecord);
  }
}

function ttlUntil(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

function isRedisSetSuccess(value: unknown): boolean {
  return value === "OK" || value === true;
}

function assertSafeSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}

function rowToPaymentRecord(row: PaymentRecordRow): PaymentRecord {
  return {
    id: row.id,
    challenge: row.challenge as PaymentRecord["challenge"],
    proof: row.proof as PaymentRecord["proof"],
    verification: row.verification as PaymentRecord["verification"],
    ...(row.receipt ? { receipt: row.receipt as PaymentRecord["receipt"] } : {}),
    resource: row.resource,
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString()
  };
}
