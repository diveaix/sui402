import {
  GatewayMerchantConfigSchema,
  type GatewayMerchantConfig,
  type MerchantStore
} from "@sui402/gateway";
import {
  Sui402ServiceListingSchema,
  type ListingQuery,
  type ListingStore,
  type Sui402ServiceListing
} from "@sui402/registry";
import {
  PostgresChallengeStore,
  PostgresPaymentRecordStore,
  type PostgresLike
} from "@sui402/storage";
import {
  PostgresIndexerCursorStore,
  PostgresSessionSpendIndexStore,
  PostgresSettlementIndexStore
} from "@sui402/indexer";
import {
  ConsoleArtifactExportSchema,
  type ArtifactExportStore,
  type ConsoleArtifactExport
} from "./exports.js";
import {
  MerchantApplicationSchema,
  type MerchantApplication,
  type MerchantApplicationQuery,
  type MerchantApplicationStore
} from "./onboarding.js";
import {
  MerchantChangeRequestSchema,
  type MerchantChangeRequest,
  type MerchantChangeRequestQuery,
  type MerchantChangeRequestStore
} from "./merchant-change-requests.js";
import {
  ConsoleAuditEventSchema,
  createChainedConsoleAuditEvent,
  type ConsoleAuditEvent,
  type ConsoleAuditEventInput,
  type ConsoleAuditEventQuery,
  type ConsoleAuditLogStore
} from "./audit.js";
import { PostgresWindowRateLimitStore } from "./rate-limit.js";

export type PostgresConsoleStoreBundleOptions = {
  client: PostgresLike;
  merchantTableName?: string;
  listingTableName?: string;
  challengeTableName?: string;
  consumedChallengeTableName?: string;
  paymentRecordTableName?: string;
  sessionSpendTableName?: string;
  settlementEventTableName?: string;
  indexerCursorTableName?: string;
  exportTableName?: string;
  merchantApplicationTableName?: string;
  merchantChangeRequestTableName?: string;
  auditTableName?: string;
  rateLimitTableName?: string;
};

export class PostgresMerchantStore implements MerchantStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_console_merchants");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        merchant jsonb not null,
        status text not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_status_idx on ${this.#tableName} (status)`
    );
  }

  async upsert(merchant: GatewayMerchantConfig): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (id, merchant, status, updated_at)
        values ($1, $2::jsonb, $3, now())
        on conflict (id) do update set
          merchant = excluded.merchant,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      [merchant.id, JSON.stringify(merchant), merchant.status]
    );
  }

  async get(id: string): Promise<GatewayMerchantConfig | undefined> {
    const result = await this.#client.query<{ merchant: unknown }>(
      `select merchant from ${this.#tableName} where id = $1`,
      [id]
    );
    return result.rows[0] ? GatewayMerchantConfigSchema.parse(result.rows[0].merchant) : undefined;
  }

  async list(): Promise<GatewayMerchantConfig[]> {
    const result = await this.#client.query<{ merchant: unknown }>(
      `select merchant from ${this.#tableName} order by id asc`
    );
    return result.rows.map((row) => GatewayMerchantConfigSchema.parse(row.merchant));
  }
}

export class PostgresListingStore implements ListingStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_console_listings");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        listing jsonb not null,
        network text not null,
        transport text not null,
        merchant text not null,
        status text not null,
        tags text[] not null default '{}',
        updated_at timestamptz not null
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_network_idx on ${this.#tableName} (network)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_merchant_idx on ${this.#tableName} (merchant)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_updated_at_idx on ${this.#tableName} (updated_at desc)`
    );
  }

  async upsert(listing: Sui402ServiceListing): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          listing,
          network,
          transport,
          merchant,
          status,
          tags,
          updated_at
        )
        values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update set
          listing = excluded.listing,
          network = excluded.network,
          transport = excluded.transport,
          merchant = excluded.merchant,
          status = excluded.status,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `,
      [
        listing.id,
        JSON.stringify(listing),
        listing.network,
        listing.transport,
        listing.merchant,
        listing.status,
        listing.tags,
        listing.updatedAt
      ]
    );
  }

  async get(id: string): Promise<Sui402ServiceListing | undefined> {
    const result = await this.#client.query<{ listing: unknown }>(
      `select listing from ${this.#tableName} where id = $1`,
      [id]
    );
    return result.rows[0] ? Sui402ServiceListingSchema.parse(result.rows[0].listing) : undefined;
  }

  async list(query: ListingQuery = {}): Promise<Sui402ServiceListing[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    addFilter(filters, values, "network", query.network);
    addFilter(filters, values, "transport", query.transport);
    addFilter(filters, values, "status", query.status);
    if (query.merchant) {
      values.push(query.merchant);
      filters.push(`lower(merchant) = lower($${values.length})`);
    }

    if (query.tag) {
      values.push(query.tag);
      filters.push(`$${values.length} = any(tags)`);
    }

    values.push(query.limit ?? 100);
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<{ listing: unknown }>(
      `
        select listing
        from ${this.#tableName}
        ${whereClause}
        order by updated_at desc
        limit $${values.length}
      `,
      values
    );
    return result.rows.map((row) => Sui402ServiceListingSchema.parse(row.listing));
  }
}

export class PostgresArtifactExportStore implements ArtifactExportStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_console_exports");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        export jsonb not null,
        kind text not null,
        blob_id text not null,
        payment_count integer not null,
        created_at timestamptz not null
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_created_at_idx on ${this.#tableName} (created_at desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_kind_idx on ${this.#tableName} (kind)`
    );
  }

  async record(exportRecord: ConsoleArtifactExport): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          export,
          kind,
          blob_id,
          payment_count,
          created_at
        )
        values ($1, $2::jsonb, $3, $4, $5, $6)
        on conflict (id) do update set
          export = excluded.export,
          kind = excluded.kind,
          blob_id = excluded.blob_id,
          payment_count = excluded.payment_count,
          created_at = excluded.created_at
      `,
      [
        exportRecord.id,
        JSON.stringify(exportRecord),
        exportRecord.kind,
        exportRecord.blobId,
        exportRecord.paymentCount,
        exportRecord.createdAt
      ]
    );
  }

  async get(id: string): Promise<ConsoleArtifactExport | undefined> {
    const result = await this.#client.query<{ export: unknown }>(
      `select export from ${this.#tableName} where id = $1`,
      [id]
    );
    return result.rows[0] ? ConsoleArtifactExportSchema.parse(result.rows[0].export) : undefined;
  }

  async list(limit = 100): Promise<ConsoleArtifactExport[]> {
    const result = await this.#client.query<{ export: unknown }>(
      `
        select export
        from ${this.#tableName}
        order by created_at desc
        limit $1
      `,
      [limit]
    );
    return result.rows.map((row) => ConsoleArtifactExportSchema.parse(row.export));
  }
}

export class PostgresMerchantApplicationStore implements MerchantApplicationStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_merchant_applications");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        application jsonb not null,
        merchant_id text not null,
        status text not null,
        submitted_at timestamptz not null,
        reviewed_at timestamptz
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_status_idx on ${this.#tableName} (status)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_submitted_at_idx on ${this.#tableName} (submitted_at desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_merchant_id_idx on ${this.#tableName} (merchant_id)`
    );
  }

  async submit(application: MerchantApplication): Promise<void> {
    await this.upsert(application);
  }

  async update(application: MerchantApplication): Promise<void> {
    await this.upsert(application);
  }

  async get(id: string): Promise<MerchantApplication | undefined> {
    const result = await this.#client.query<{ application: unknown }>(
      `select application from ${this.#tableName} where id = $1`,
      [id]
    );
    return result.rows[0] ? MerchantApplicationSchema.parse(result.rows[0].application) : undefined;
  }

  async list(query: MerchantApplicationQuery = {}): Promise<MerchantApplication[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    addFilter(filters, values, "status", query.status);
    values.push(query.limit ?? 100);
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<{ application: unknown }>(
      `
        select application
        from ${this.#tableName}
        ${whereClause}
        order by submitted_at desc, id desc
        limit $${values.length}
      `,
      values
    );
    return result.rows.map((row) => MerchantApplicationSchema.parse(row.application));
  }

  private async upsert(application: MerchantApplication): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          application,
          merchant_id,
          status,
          submitted_at,
          reviewed_at
        )
        values ($1, $2::jsonb, $3, $4, $5, $6)
        on conflict (id) do update set
          application = excluded.application,
          merchant_id = excluded.merchant_id,
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          reviewed_at = excluded.reviewed_at
      `,
      [
        application.id,
        JSON.stringify(application),
        application.request.id,
        application.status,
        application.submittedAt,
        application.reviewedAt ?? null
      ]
    );
  }
}

export class PostgresMerchantChangeRequestStore implements MerchantChangeRequestStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_merchant_change_requests");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        request jsonb not null,
        merchant_id text not null,
        status text not null,
        submitted_at timestamptz not null,
        reviewed_at timestamptz
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_status_idx on ${this.#tableName} (status)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_submitted_at_idx on ${this.#tableName} (submitted_at desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_merchant_id_idx on ${this.#tableName} (merchant_id)`
    );
  }

  async submit(request: MerchantChangeRequest): Promise<void> {
    await this.upsert(request);
  }

  async update(request: MerchantChangeRequest): Promise<void> {
    await this.upsert(request);
  }

  async get(id: string): Promise<MerchantChangeRequest | undefined> {
    const result = await this.#client.query<{ request: unknown }>(
      `select request from ${this.#tableName} where id = $1`,
      [id]
    );
    return result.rows[0] ? MerchantChangeRequestSchema.parse(result.rows[0].request) : undefined;
  }

  async list(query: MerchantChangeRequestQuery = {}): Promise<MerchantChangeRequest[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    addFilter(filters, values, "status", query.status);
    addFilter(filters, values, "merchant_id", query.merchantId);
    values.push(query.limit ?? 100);
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<{ request: unknown }>(
      `
        select request
        from ${this.#tableName}
        ${whereClause}
        order by submitted_at desc, id desc
        limit $${values.length}
      `,
      values
    );
    return result.rows.map((row) => MerchantChangeRequestSchema.parse(row.request));
  }

  private async upsert(request: MerchantChangeRequest): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          request,
          merchant_id,
          status,
          submitted_at,
          reviewed_at
        )
        values ($1, $2::jsonb, $3, $4, $5, $6)
        on conflict (id) do update set
          request = excluded.request,
          merchant_id = excluded.merchant_id,
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          reviewed_at = excluded.reviewed_at
      `,
      [
        request.id,
        JSON.stringify(request),
        request.merchantId,
        request.status,
        request.submittedAt,
        request.reviewedAt ?? null
      ]
    );
  }
}

export class PostgresConsoleAuditLogStore implements ConsoleAuditLogStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: { client: PostgresLike; tableName?: string }) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_console_audit_events");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        event jsonb not null,
        action text not null,
        actor_id text,
        target_type text,
        target_id text,
        created_at timestamptz not null
      )
    `);
    await this.#client.query(
      `create index if not exists ${this.#tableName}_created_at_idx on ${this.#tableName} (created_at desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_action_idx on ${this.#tableName} (action)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_actor_id_idx on ${this.#tableName} (actor_id)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_target_idx on ${this.#tableName} (target_type, target_id)`
    );
  }

  async record(event: ConsoleAuditEvent): Promise<void> {
    await this.#insert(this.#client, event);
  }

  async append(input: ConsoleAuditEventInput): Promise<ConsoleAuditEvent> {
    const transactional = this.#client as PostgresLike & {
      connect?: () => Promise<PostgresLike & { release(): void }>;
    };
    if (!transactional.connect) {
      const previous = (await this.list({ limit: 1 }))[0];
      const event = createChainedConsoleAuditEvent(input, previous);
      await this.record(event);
      return event;
    }

    const client = await transactional.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [this.#tableName]);
      const previousResult = await client.query<{ event: unknown }>(
        `
          select event
          from ${this.#tableName}
          order by created_at desc, id desc
          limit 1
        `
      );
      const previous = previousResult.rows[0]
        ? ConsoleAuditEventSchema.parse(previousResult.rows[0].event)
        : undefined;
      const event = createChainedConsoleAuditEvent(input, previous);
      await this.#insert(client, event);
      await client.query("commit");
      return event;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async #insert(client: PostgresLike, event: ConsoleAuditEvent): Promise<void> {
    await client.query(
      `
        insert into ${this.#tableName} (
          id,
          event,
          action,
          actor_id,
          target_type,
          target_id,
          created_at
        )
        values ($1, $2::jsonb, $3, $4, $5, $6, $7)
        on conflict (id) do nothing
      `,
      [
        event.id,
        JSON.stringify(event),
        event.action,
        event.actorId ?? null,
        event.targetType ?? null,
        event.targetId ?? null,
        event.createdAt
      ]
    );
  }

  async list(query: ConsoleAuditEventQuery = { limit: 100 }): Promise<ConsoleAuditEvent[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    addFilter(filters, values, "action", query.action);
    addFilter(filters, values, "actor_id", query.actorId);
    addFilter(filters, values, "target_type", query.targetType);
    addFilter(filters, values, "target_id", query.targetId);
    values.push(query.limit);
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<{ event: unknown }>(
      `
        select event
        from ${this.#tableName}
        ${whereClause}
        order by created_at desc, id desc
        limit $${values.length}
      `,
      values
    );
    return result.rows.map((row) => ConsoleAuditEventSchema.parse(row.event));
  }
}

export function createPostgresConsoleStoreBundle(options: PostgresConsoleStoreBundleOptions): {
  merchants: PostgresMerchantStore;
  listings: PostgresListingStore;
  challenges: PostgresChallengeStore;
  payments: PostgresPaymentRecordStore;
  sessionSpends: PostgresSessionSpendIndexStore;
  settlementEvents: PostgresSettlementIndexStore;
  indexerCursors: PostgresIndexerCursorStore;
  exports: PostgresArtifactExportStore;
  merchantApplications: PostgresMerchantApplicationStore;
  merchantChangeRequests: PostgresMerchantChangeRequestStore;
  audit: PostgresConsoleAuditLogStore;
  rateLimits: PostgresWindowRateLimitStore;
  setup(): Promise<void>;
} {
  const merchants = new PostgresMerchantStore({
    client: options.client,
    tableName: options.merchantTableName
  });
  const listings = new PostgresListingStore({
    client: options.client,
    tableName: options.listingTableName
  });
  const challenges = new PostgresChallengeStore({
    client: options.client,
    challengeTableName: options.challengeTableName,
    consumedTableName: options.consumedChallengeTableName
  });
  const payments = new PostgresPaymentRecordStore({
    client: options.client,
    tableName: options.paymentRecordTableName
  });
  const sessionSpends = new PostgresSessionSpendIndexStore({
    client: options.client,
    tableName: options.sessionSpendTableName
  });
  const settlementEvents = new PostgresSettlementIndexStore({
    client: options.client,
    tableName: options.settlementEventTableName
  });
  const indexerCursors = new PostgresIndexerCursorStore({
    client: options.client,
    tableName: options.indexerCursorTableName
  });
  const exports = new PostgresArtifactExportStore({
    client: options.client,
    tableName: options.exportTableName
  });
  const merchantApplications = new PostgresMerchantApplicationStore({
    client: options.client,
    tableName: options.merchantApplicationTableName
  });
  const merchantChangeRequests = new PostgresMerchantChangeRequestStore({
    client: options.client,
    tableName: options.merchantChangeRequestTableName
  });
  const audit = new PostgresConsoleAuditLogStore({
    client: options.client,
    tableName: options.auditTableName
  });
  const rateLimits = new PostgresWindowRateLimitStore({
    client: options.client,
    tableName: options.rateLimitTableName
  });

  return {
    merchants,
    listings,
    challenges,
    payments,
    sessionSpends,
    settlementEvents,
    indexerCursors,
    exports,
    merchantApplications,
    merchantChangeRequests,
    audit,
    rateLimits,
    setup: async () => {
      await merchants.setup();
      await listings.setup();
      await challenges.setup();
      await payments.setup();
      await sessionSpends.setup();
      await settlementEvents.setup();
      await indexerCursors.setup();
      await exports.setup();
      await merchantApplications.setup();
      await merchantChangeRequests.setup();
      await audit.setup();
      await rateLimits.setup();
    }
  };
}

function addFilter(filters: string[], values: unknown[], column: string, value: unknown): void {
  if (!value) {
    return;
  }

  values.push(value);
  filters.push(`${column} = $${values.length}`);
}

function assertSafeSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}
