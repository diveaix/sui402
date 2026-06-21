import type { PostgresLike } from "@sui402/storage";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type WindowRateLimitStore = {
  setup?(): Promise<void>;
  consume(key: string, options: { max: number; windowMs: number; now?: number }): Promise<RateLimitDecision>;
};

export class MemoryWindowRateLimitStore implements WindowRateLimitStore {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();

  async consume(
    key: string,
    options: { max: number; windowMs: number; now?: number }
  ): Promise<RateLimitDecision> {
    if (options.max === 0) {
      return { allowed: true };
    }

    const now = options.now ?? Date.now();
    const existing = this.#buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.#buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return { allowed: true };
    }

    if (existing.count >= options.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      };
    }

    existing.count += 1;
    return { allowed: true };
  }
}

export class PostgresWindowRateLimitStore implements WindowRateLimitStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_console_rate_limits");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        key text primary key,
        count integer not null,
        reset_at timestamptz not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_reset_at_idx on ${this.#tableName} (reset_at)`
    );
  }

  async consume(key: string, options: { max: number; windowMs: number }): Promise<RateLimitDecision> {
    if (options.max === 0) {
      return { allowed: true };
    }

    const result = await this.#client.query<{ count: number; reset_at: Date | string }>(
      `
        insert into ${this.#tableName} (key, count, reset_at, updated_at)
        values ($1, 1, now() + ($2::integer * interval '1 millisecond'), now())
        on conflict (key) do update set
          count = case
            when ${this.#tableName}.reset_at <= now() then 1
            else ${this.#tableName}.count + 1
          end,
          reset_at = case
            when ${this.#tableName}.reset_at <= now() then now() + ($2::integer * interval '1 millisecond')
            else ${this.#tableName}.reset_at
          end,
          updated_at = now()
        returning count, reset_at
      `,
      [key, options.windowMs]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Rate limit store did not return a decision row");
    }

    if (Number(row.count) <= options.max) {
      return { allowed: true };
    }

    const resetAt = row.reset_at instanceof Date ? row.reset_at.getTime() : Date.parse(row.reset_at);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    };
  }
}

function assertSafeSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}
