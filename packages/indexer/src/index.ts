import type { Sui402Network } from "@sui402/protocol";

export type SessionSpendEventLike = {
  id?: {
    txDigest?: string;
    eventSeq?: string | number;
  };
  packageId?: string;
  transactionModule?: string;
  type?: string;
  sender?: string;
  parsedJson?: unknown;
  timestampMs?: string | number;
};

export type SessionSpendRecord = {
  id: string;
  network: Sui402Network;
  packageId: string;
  coinType: string;
  txDigest: string;
  eventSeq?: string;
  sessionId: string;
  payer?: string;
  merchant: string;
  amount: string;
  spentTotal?: string;
  challengeId: string;
  resourceScopeHash: string;
  sender?: string;
  timestampMs?: string;
  indexedAt: string;
};

export type NormalizeSessionSpendEventOptions = {
  network?: Sui402Network;
  packageId?: string;
  coinType?: string;
};

export type SessionSpendQuery = {
  cursor?: string;
  limit?: number;
};

export type SessionSpendEventPage = {
  events: SessionSpendEventLike[];
  nextCursor?: string;
  hasNextPage?: boolean;
};

export type SessionSpendEventSource = {
  fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> | SessionSpendEventPage;
};

export type JsonlSessionSpendLineInput = Iterable<string> | AsyncIterable<string>;

export type JsonlSessionSpendEventSourceOptions = {
  lines: JsonlSessionSpendLineInput | (() => JsonlSessionSpendLineInput | Promise<JsonlSessionSpendLineInput>);
};

export type SuiGrpcUnaryCall<Response> =
  | PromiseLike<{ response: Response | Promise<Response> }>
  | { response: Response | Promise<Response> };

export type SuiGrpcCheckpointRequestLike = {
  checkpointId: {
    oneofKind: "sequenceNumber";
    sequenceNumber: bigint;
  };
  readMask?: {
    paths: string[];
  };
};

export type SuiGrpcLedgerServiceLike = {
  getCheckpoint(input: SuiGrpcCheckpointRequestLike): SuiGrpcUnaryCall<{ checkpoint?: SuiGrpcCheckpointLike }>;
};

export type SuiGrpcClientLike =
  | SuiGrpcLedgerServiceLike
  | {
      ledgerService: SuiGrpcLedgerServiceLike;
    };

export type SuiGrpcCheckpointLike = {
  sequenceNumber?: bigint | number | string;
  transactions?: SuiGrpcExecutedTransactionLike[];
};

export type SuiGrpcExecutedTransactionLike = {
  digest?: string;
  events?: {
    events?: SuiGrpcEventLike[];
  };
  timestamp?: {
    seconds?: bigint | number | string;
    nanos?: number;
  };
};

export type SuiGrpcEventLike = {
  packageId?: string;
  module?: string;
  sender?: string;
  eventType?: string;
  json?: unknown;
};

export type SuiGrpcCheckpointSessionSpendEventSourceOptions = {
  client: SuiGrpcClientLike;
  packageId: string;
  coinType?: string;
  startCheckpoint?: bigint | number | string;
  maxCheckpointsPerPage?: number;
  readMaskPaths?: string[];
};

export type SuiGrpcCheckpointSettlementEventSourceOptions = SuiGrpcCheckpointSessionSpendEventSourceOptions;

export type GraphQLFetch = (url: string, init: GraphQLFetchInit) => Promise<GraphQLFetchResponse>;

export type GraphQLFetchInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type GraphQLFetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type SuiGraphQLSessionSpendEventSourceOptions = {
  url?: string;
  network?: Sui402Network;
  packageId: string;
  coinType?: string;
  fetch?: GraphQLFetch;
  query?: string;
};

export type SuiGraphQLSettlementEventSourceOptions = SuiGraphQLSessionSpendEventSourceOptions;

export type SuiGraphQLEventNode = {
  digest?: string;
  transactionDigest?: string;
  transaction?: { digest?: string };
  eventSeq?: string | number;
  sequenceNumber?: string | number;
  packageId?: string;
  sendingModule?: string;
  transactionModule?: string;
  sender?: string;
  type?: { repr?: string } | string;
  contents?: { json?: unknown } | unknown;
  timestamp?: string | number;
  timestampMs?: string | number;
};

export type SessionSpendIndexStore = {
  upsert(record: SessionSpendRecord): Promise<void> | void;
  list(query?: SessionSpendRecordQuery): Promise<SessionSpendRecord[]> | SessionSpendRecord[];
};

export type IndexerCursorState = {
  key: string;
  cursor?: string;
  updatedAt: string;
};

export type IndexerCursorStore = {
  getCursor(key: string): Promise<IndexerCursorState | undefined> | IndexerCursorState | undefined;
  setCursor(key: string, cursor: string | undefined): Promise<void> | void;
};

export type PostgresQueryResult<Row> = {
  rows: Row[];
};

export type PostgresLike = {
  query<Row = unknown>(text: string, values?: unknown[]): Promise<PostgresQueryResult<Row>>;
};

export type PostgresSessionSpendIndexStoreOptions = {
  client: PostgresLike;
  tableName?: string;
};

export type PostgresIndexerCursorStoreOptions = {
  client: PostgresLike;
  tableName?: string;
};

export type ConsoleHttpIndexStoreOptions = {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
};

export type SessionSpendRecordRow = {
  id: string;
  network: Sui402Network;
  package_id: string;
  coin_type: string;
  tx_digest: string;
  event_seq?: string | null;
  session_id: string;
  payer?: string | null;
  merchant: string;
  amount: string | number;
  spent_total?: string | number | null;
  challenge_id: string;
  resource_scope_hash: string;
  sender?: string | null;
  timestamp_ms?: string | number | null;
  indexed_at: Date | string;
};

export type SessionSpendRecordQuery = {
  sessionId?: string;
  payer?: string;
  merchant?: string;
  limit?: number;
};

export type SettlementRecordKind = "receipt" | "batch";

export type SettlementRecord = {
  id: string;
  network: Sui402Network;
  packageId: string;
  coinType: string;
  txDigest: string;
  eventSeq?: string;
  kind: SettlementRecordKind;
  ledgerId: string;
  receiptId?: string;
  payer?: string;
  merchant: string;
  signer?: string;
  amount?: string;
  sequence?: string;
  resourceScopeHash?: string;
  submitter: string;
  receiptCount?: string;
  totalAmount?: string;
  sender?: string;
  timestampMs?: string;
  indexedAt: string;
};

export type SettlementRecordQuery = {
  kind?: SettlementRecordKind;
  ledgerId?: string;
  merchant?: string;
  submitter?: string;
  limit?: number;
};

export type SettlementIndexStore = {
  upsert(record: SettlementRecord): Promise<void> | void;
  list(query?: SettlementRecordQuery): Promise<SettlementRecord[]> | SettlementRecord[];
  getByIdentifier?(identifier: string): Promise<SettlementRecord | undefined> | SettlementRecord | undefined;
};

export type NormalizeSettlementEventOptions = {
  network?: Sui402Network;
  packageId?: string;
  coinType?: string;
};

export type SettlementRecordRow = {
  id: string;
  network: Sui402Network;
  package_id: string;
  coin_type: string;
  tx_digest: string;
  event_seq?: string | null;
  kind: SettlementRecordKind;
  ledger_id: string;
  receipt_id?: string | null;
  payer?: string | null;
  merchant: string;
  signer?: string | null;
  amount?: string | number | null;
  sequence?: string | number | null;
  resource_scope_hash?: string | null;
  submitter: string;
  receipt_count?: string | number | null;
  total_amount?: string | number | null;
  sender?: string | null;
  timestamp_ms?: string | number | null;
  indexed_at: Date | string;
};

export type PostgresSettlementIndexStoreOptions = {
  client: PostgresLike;
  tableName?: string;
};

export const DEFAULT_SUI_GRAPHQL_SESSION_SPEND_QUERY = `
  query Sui402SessionSpendEvents($eventType: String!, $cursor: String, $limit: Int!) {
    events(first: $limit, after: $cursor, filter: { type: $eventType }) {
      nodes {
        sequenceNumber
        transaction {
          digest
        }
        transactionModule {
          name
          package {
            address
          }
        }
        sender {
          address
        }
        contents {
          type {
            repr
          }
          json
        }
        timestamp
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const DEFAULT_SUI_GRPC_CHECKPOINT_READ_MASK = [
  "sequence_number",
  "transactions.digest",
  "transactions.timestamp",
  "transactions.events.events.package_id",
  "transactions.events.events.module",
  "transactions.events.events.sender",
  "transactions.events.events.event_type",
  "transactions.events.events.json"
] as const;

export type IndexSessionSpendEventsOptions = {
  source: SessionSpendEventSource;
  store: SessionSpendIndexStore;
  network?: Sui402Network;
  packageId?: string;
  coinType?: string;
  cursor?: string;
  pageLimit?: number;
  maxPages?: number;
};

export type IndexSessionSpendEventsResult = {
  processed: number;
  skipped: number;
  nextCursor?: string;
  hasNextPage: boolean;
};

export type IndexSettlementEventsOptions = {
  source: SessionSpendEventSource;
  store: SettlementIndexStore;
  network?: Sui402Network;
  packageId?: string;
  coinType?: string;
  cursor?: string;
  pageLimit?: number;
  maxPages?: number;
};

export type IndexSettlementEventsResult = IndexSessionSpendEventsResult;

export type SessionSpendAggregate = {
  sessionId: string;
  network: Sui402Network;
  payer?: string;
  merchant: string;
  coinType: string;
  spendCount: number;
  spentAmount: string;
  spentTotal?: string;
  resourceScopeHashes: string[];
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastTxDigest: string;
  lastEventId: string;
};

export class MemorySessionSpendIndexStore implements SessionSpendIndexStore {
  #records = new Map<string, SessionSpendRecord>();

  upsert(record: SessionSpendRecord): void {
    this.#records.set(record.id, record);
  }

  list(query: SessionSpendRecordQuery = {}): SessionSpendRecord[] {
    return [...this.#records.values()]
      .filter((record) => {
        return (
          (!query.sessionId || normalizeAddress(record.sessionId) === normalizeAddress(query.sessionId)) &&
          (!query.payer || normalizeAddress(record.payer ?? "") === normalizeAddress(query.payer)) &&
          (!query.merchant || normalizeAddress(record.merchant) === normalizeAddress(query.merchant))
        );
      })
      .sort(compareRecordsDescending)
      .slice(0, query.limit ?? 100);
  }
}

export class MemoryIndexerCursorStore implements IndexerCursorStore {
  #states = new Map<string, IndexerCursorState>();

  getCursor(key: string): IndexerCursorState | undefined {
    return this.#states.get(key);
  }

  setCursor(key: string, cursor: string | undefined): void {
    this.#states.set(key, {
      key,
      cursor,
      updatedAt: new Date().toISOString()
    });
  }
}

export class ConsoleHttpIndexerCursorStore implements IndexerCursorStore {
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #fetch: typeof fetch;

  constructor(options: ConsoleHttpIndexStoreOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async getCursor(key: string): Promise<IndexerCursorState | undefined> {
    const response = await this.#fetch(
      `${this.#baseUrl}/v1/indexer/cursors/${encodeURIComponent(key)}`,
      { headers: consoleHttpHeaders(this.#apiKey) }
    );
    if (response.status === 404) {
      return undefined;
    }

    await assertConsoleHttpResponse(response, "read indexer cursor");
    const payload = (await response.json()) as { state?: IndexerCursorState };
    return payload.state;
  }

  async setCursor(key: string, cursor: string | undefined): Promise<void> {
    const response = await this.#fetch(
      `${this.#baseUrl}/v1/indexer/cursors/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: consoleHttpHeaders(this.#apiKey, true),
        body: JSON.stringify({ cursor })
      }
    );
    await assertConsoleHttpResponse(response, "update indexer cursor");
  }
}

export class ConsoleHttpSessionSpendIndexStore implements SessionSpendIndexStore {
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #fetch: typeof fetch;

  constructor(options: ConsoleHttpIndexStoreOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async upsert(record: SessionSpendRecord): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/v1/indexer/session-spends`, {
      method: "POST",
      headers: consoleHttpHeaders(this.#apiKey, true),
      body: JSON.stringify({ record })
    });
    await assertConsoleHttpResponse(response, "ingest session spend");
  }

  async list(query: SessionSpendRecordQuery = {}): Promise<SessionSpendRecord[]> {
    const response = await this.#fetch(
      consoleHttpUrl(this.#baseUrl, "/v1/indexer/session-spends", query),
      { headers: consoleHttpHeaders(this.#apiKey) }
    );
    await assertConsoleHttpResponse(response, "list session spends");
    const payload = (await response.json()) as { records?: SessionSpendRecord[] };
    return payload.records ?? [];
  }
}

export class MemorySettlementIndexStore implements SettlementIndexStore {
  #records = new Map<string, SettlementRecord>();

  upsert(record: SettlementRecord): void {
    this.#records.set(record.id, record);
  }

  list(query: SettlementRecordQuery = {}): SettlementRecord[] {
    return [...this.#records.values()]
      .filter((record) => matchesSettlementRecordQuery(record, query))
      .sort(compareSettlementRecordsDescending)
      .slice(0, query.limit ?? 100);
  }

  getByIdentifier(identifier: string): SettlementRecord | undefined {
    return [...this.#records.values()].find((record) => settlementRecordMatchesIdentifier(record, identifier));
  }
}

export class ConsoleHttpSettlementIndexStore implements SettlementIndexStore {
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #fetch: typeof fetch;

  constructor(options: ConsoleHttpIndexStoreOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async upsert(record: SettlementRecord): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/v1/indexer/settlement-events`, {
      method: "POST",
      headers: consoleHttpHeaders(this.#apiKey, true),
      body: JSON.stringify({ record })
    });
    await assertConsoleHttpResponse(response, "ingest settlement event");
  }

  async list(query: SettlementRecordQuery = {}): Promise<SettlementRecord[]> {
    const response = await this.#fetch(
      consoleHttpUrl(this.#baseUrl, "/v1/indexer/settlement-events", query),
      { headers: consoleHttpHeaders(this.#apiKey) }
    );
    await assertConsoleHttpResponse(response, "list settlement events");
    const payload = (await response.json()) as { records?: SettlementRecord[] };
    return payload.records ?? [];
  }
}

export class PostgresSessionSpendIndexStore implements SessionSpendIndexStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: PostgresSessionSpendIndexStoreOptions) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_session_spend_events");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        network text not null,
        package_id text not null,
        coin_type text not null,
        tx_digest text not null,
        event_seq text,
        session_id text not null,
        payer text,
        merchant text not null,
        amount numeric not null,
        spent_total numeric,
        challenge_id text not null,
        resource_scope_hash text not null,
        sender text,
        timestamp_ms numeric,
        indexed_at timestamptz not null default now()
      )
    `);
    await this.#client.query(
      `create unique index if not exists ${this.#tableName}_network_tx_event_uidx on ${this.#tableName} (network, tx_digest, event_seq)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_tx_digest_idx on ${this.#tableName} (tx_digest)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_session_timestamp_idx on ${this.#tableName} (session_id, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_payer_timestamp_idx on ${this.#tableName} (payer, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_merchant_timestamp_idx on ${this.#tableName} (merchant, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_package_timestamp_idx on ${this.#tableName} (package_id, timestamp_ms desc)`
    );
  }

  async upsert(record: SessionSpendRecord): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          network,
          package_id,
          coin_type,
          tx_digest,
          event_seq,
          session_id,
          payer,
          merchant,
          amount,
          spent_total,
          challenge_id,
          resource_scope_hash,
          sender,
          timestamp_ms,
          indexed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        on conflict (id) do update set
          network = excluded.network,
          package_id = excluded.package_id,
          coin_type = excluded.coin_type,
          tx_digest = excluded.tx_digest,
          event_seq = excluded.event_seq,
          session_id = excluded.session_id,
          payer = excluded.payer,
          merchant = excluded.merchant,
          amount = excluded.amount,
          spent_total = excluded.spent_total,
          challenge_id = excluded.challenge_id,
          resource_scope_hash = excluded.resource_scope_hash,
          sender = excluded.sender,
          timestamp_ms = excluded.timestamp_ms,
          indexed_at = excluded.indexed_at
      `,
      [
        record.id,
        record.network,
        record.packageId,
        record.coinType,
        record.txDigest,
        record.eventSeq ?? null,
        record.sessionId,
        record.payer ?? null,
        record.merchant,
        record.amount,
        record.spentTotal ?? null,
        record.challengeId,
        record.resourceScopeHash,
        record.sender ?? null,
        record.timestampMs ?? null,
        record.indexedAt
      ]
    );
  }

  async list(query: SessionSpendRecordQuery = {}): Promise<SessionSpendRecord[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    if (query.sessionId) {
      values.push(query.sessionId);
      filters.push(`lower(session_id) = lower($${values.length})`);
    }

    if (query.payer) {
      values.push(query.payer);
      filters.push(`lower(payer) = lower($${values.length})`);
    }

    if (query.merchant) {
      values.push(query.merchant);
      filters.push(`lower(merchant) = lower($${values.length})`);
    }

    values.push(query.limit ?? 100);
    const limitPlaceholder = `$${values.length}`;
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<SessionSpendRecordRow>(
      `
        select
          id,
          network,
          package_id,
          coin_type,
          tx_digest,
          event_seq,
          session_id,
          payer,
          merchant,
          amount,
          spent_total,
          challenge_id,
          resource_scope_hash,
          sender,
          timestamp_ms,
          indexed_at
        from ${this.#tableName}
        ${whereClause}
        order by timestamp_ms desc nulls last, indexed_at desc, id desc
        limit ${limitPlaceholder}
      `,
      values
    );

    return result.rows.map(rowToSessionSpendRecord);
  }
}

export class PostgresIndexerCursorStore implements IndexerCursorStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: PostgresIndexerCursorStoreOptions) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_indexer_cursors");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        key text primary key,
        cursor text,
        updated_at timestamptz not null default now()
      )
    `);
  }

  async getCursor(key: string): Promise<IndexerCursorState | undefined> {
    const result = await this.#client.query<{
      key: string;
      cursor?: string | null;
      updated_at: Date | string;
    }>(
      `
        select key, cursor, updated_at
        from ${this.#tableName}
        where key = $1
      `,
      [key]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      key: row.key,
      cursor: row.cursor ?? undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString()
    };
  }

  async setCursor(key: string, cursor: string | undefined): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (key, cursor, updated_at)
        values ($1, $2, now())
        on conflict (key) do update set
          cursor = excluded.cursor,
          updated_at = excluded.updated_at
      `,
      [key, cursor ?? null]
    );
  }
}

export class PostgresSettlementIndexStore implements SettlementIndexStore {
  readonly #client: PostgresLike;
  readonly #tableName: string;

  constructor(options: PostgresSettlementIndexStoreOptions) {
    this.#client = options.client;
    this.#tableName = assertSafeSqlIdentifier(options.tableName ?? "sui402_settlement_events");
  }

  async setup(): Promise<void> {
    await this.#client.query(`
      create table if not exists ${this.#tableName} (
        id text primary key,
        network text not null,
        package_id text not null,
        coin_type text not null,
        tx_digest text not null,
        event_seq text,
        kind text not null,
        ledger_id text not null,
        receipt_id text,
        payer text,
        merchant text not null,
        signer text,
        amount numeric,
        sequence numeric,
        resource_scope_hash text,
        submitter text not null,
        receipt_count numeric,
        total_amount numeric,
        sender text,
        timestamp_ms numeric,
        indexed_at timestamptz not null default now()
      )
    `);
    await this.#client.query(
      `create unique index if not exists ${this.#tableName}_network_tx_event_uidx on ${this.#tableName} (network, tx_digest, event_seq)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_tx_digest_idx on ${this.#tableName} (tx_digest)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_ledger_timestamp_idx on ${this.#tableName} (ledger_id, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_receipt_id_idx on ${this.#tableName} (receipt_id)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_merchant_timestamp_idx on ${this.#tableName} (merchant, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_submitter_timestamp_idx on ${this.#tableName} (submitter, timestamp_ms desc)`
    );
    await this.#client.query(
      `create index if not exists ${this.#tableName}_kind_idx on ${this.#tableName} (kind)`
    );
  }

  async upsert(record: SettlementRecord): Promise<void> {
    await this.#client.query(
      `
        insert into ${this.#tableName} (
          id,
          network,
          package_id,
          coin_type,
          tx_digest,
          event_seq,
          kind,
          ledger_id,
          receipt_id,
          payer,
          merchant,
          signer,
          amount,
          sequence,
          resource_scope_hash,
          submitter,
          receipt_count,
          total_amount,
          sender,
          timestamp_ms,
          indexed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        on conflict (id) do update set
          network = excluded.network,
          package_id = excluded.package_id,
          coin_type = excluded.coin_type,
          tx_digest = excluded.tx_digest,
          event_seq = excluded.event_seq,
          kind = excluded.kind,
          ledger_id = excluded.ledger_id,
          receipt_id = excluded.receipt_id,
          payer = excluded.payer,
          merchant = excluded.merchant,
          signer = excluded.signer,
          amount = excluded.amount,
          sequence = excluded.sequence,
          resource_scope_hash = excluded.resource_scope_hash,
          submitter = excluded.submitter,
          receipt_count = excluded.receipt_count,
          total_amount = excluded.total_amount,
          sender = excluded.sender,
          timestamp_ms = excluded.timestamp_ms,
          indexed_at = excluded.indexed_at
      `,
      [
        record.id,
        record.network,
        record.packageId,
        record.coinType,
        record.txDigest,
        record.eventSeq ?? null,
        record.kind,
        record.ledgerId,
        record.receiptId ?? null,
        record.payer ?? null,
        record.merchant,
        record.signer ?? null,
        record.amount ?? null,
        record.sequence ?? null,
        record.resourceScopeHash ?? null,
        record.submitter,
        record.receiptCount ?? null,
        record.totalAmount ?? null,
        record.sender ?? null,
        record.timestampMs ?? null,
        record.indexedAt
      ]
    );
  }

  async list(query: SettlementRecordQuery = {}): Promise<SettlementRecord[]> {
    const filters: string[] = [];
    const values: unknown[] = [];
    addSqlFilter(filters, values, "kind", query.kind);
    if (query.ledgerId) {
      values.push(query.ledgerId);
      filters.push(`lower(ledger_id) = lower($${values.length})`);
    }

    if (query.merchant) {
      values.push(query.merchant);
      filters.push(`lower(merchant) = lower($${values.length})`);
    }

    if (query.submitter) {
      values.push(query.submitter);
      filters.push(`lower(submitter) = lower($${values.length})`);
    }

    values.push(query.limit ?? 100);
    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
    const result = await this.#client.query<SettlementRecordRow>(
      `
        select
          id,
          network,
          package_id,
          coin_type,
          tx_digest,
          event_seq,
          kind,
          ledger_id,
          receipt_id,
          payer,
          merchant,
          signer,
          amount,
          sequence,
          resource_scope_hash,
          submitter,
          receipt_count,
          total_amount,
          sender,
          timestamp_ms,
          indexed_at
        from ${this.#tableName}
        ${whereClause}
        order by timestamp_ms desc nulls last, indexed_at desc, id desc
        limit $${values.length}
      `,
      values
    );

    return result.rows.map(rowToSettlementRecord);
  }

  async getByIdentifier(identifier: string): Promise<SettlementRecord | undefined> {
    const result = await this.#client.query<SettlementRecordRow>(
      `
        select
          id,
          network,
          package_id,
          coin_type,
          tx_digest,
          event_seq,
          kind,
          ledger_id,
          receipt_id,
          payer,
          merchant,
          signer,
          amount,
          sequence,
          resource_scope_hash,
          submitter,
          receipt_count,
          total_amount,
          sender,
          timestamp_ms,
          indexed_at
        from ${this.#tableName}
        where id = $1
          or tx_digest = $1
          or ledger_id = $1
          or receipt_id = $1
        order by timestamp_ms desc nulls last, indexed_at desc, id desc
        limit 1
      `,
      [identifier]
    );

    const row = result.rows[0];
    return row ? rowToSettlementRecord(row) : undefined;
  }
}

export class SuiGraphQLSessionSpendEventSource implements SessionSpendEventSource {
  readonly #url: string;
  readonly #network: Sui402Network;
  readonly #packageId: string;
  readonly #coinType: string;
  readonly #fetch: GraphQLFetch;
  readonly #query: string;

  constructor(options: SuiGraphQLSessionSpendEventSourceOptions) {
    this.#network = options.network ?? "sui:testnet";
    this.#url = options.url ?? graphQlUrlForNetwork(this.#network);
    this.#packageId = options.packageId;
    this.#coinType = options.coinType ?? "0x2::sui::SUI";
    this.#fetch = options.fetch ?? defaultGraphQLFetch;
    this.#query = options.query ?? DEFAULT_SUI_GRAPHQL_SESSION_SPEND_QUERY;
  }

  async fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: this.#query,
        variables: {
          eventType: `${this.#packageId}::sessions::SessionSpent<${this.#coinType}>`,
          cursor: query.cursor ?? null,
          limit: query.limit ?? 50
        }
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Sui GraphQL request failed with ${response.status}: ${text}`);
    }

    const payload = JSON.parse(text) as unknown;
    const parsed = parseGraphQLEventPayload(payload);
    if (parsed.errors.length > 0) {
      throw new Error(`Sui GraphQL returned errors: ${JSON.stringify(parsed.errors)}`);
    }

    return {
      events: parsed.nodes.map((node) => mapGraphQLEventNode(node, this.#packageId)),
      nextCursor: parsed.endCursor,
      hasNextPage: parsed.hasNextPage
    };
  }
}

export class SuiGraphQLSettlementEventSource implements SessionSpendEventSource {
  readonly #url: string;
  readonly #network: Sui402Network;
  readonly #packageId: string;
  readonly #coinType: string;
  readonly #fetch: GraphQLFetch;
  readonly #query: string;

  constructor(options: SuiGraphQLSettlementEventSourceOptions) {
    this.#network = options.network ?? "sui:testnet";
    this.#url = options.url ?? graphQlUrlForNetwork(this.#network);
    this.#packageId = options.packageId;
    this.#coinType = options.coinType ?? "0x2::sui::SUI";
    this.#fetch = options.fetch ?? defaultGraphQLFetch;
    this.#query = options.query ?? DEFAULT_SUI_GRAPHQL_SESSION_SPEND_QUERY;
  }

  async fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("GraphQL settlement event limit must be a positive integer");
    }

    const cursor = readGraphQLSettlementCursor(query.cursor);
    const perKindLimit = Math.max(1, Math.ceil(limit / 2));
    const receiptPage = await this.#fetchSettlementKind("ReceiptSettled", cursor.receipt, perKindLimit);
    const batchPage = await this.#fetchSettlementKind("BatchSettled", cursor.batch, perKindLimit);
    const nextCursor = formatGraphQLSettlementCursor({
      receipt: receiptPage.nextCursor,
      batch: batchPage.nextCursor
    });

    return {
      events: [...receiptPage.events, ...batchPage.events],
      nextCursor,
      hasNextPage: receiptPage.hasNextPage || batchPage.hasNextPage
    };
  }

  async #fetchSettlementKind(
    eventName: "ReceiptSettled" | "BatchSettled",
    cursor: string | undefined,
    limit: number
  ): Promise<SessionSpendEventPage> {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: this.#query,
        variables: {
          eventType: `${this.#packageId}::settlement::${eventName}<${this.#coinType}>`,
          cursor: cursor ?? null,
          limit
        }
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Sui GraphQL request failed with ${response.status}: ${text}`);
    }

    const payload = JSON.parse(text) as unknown;
    const parsed = parseGraphQLEventPayload(payload);
    if (parsed.errors.length > 0) {
      throw new Error(`Sui GraphQL returned errors: ${JSON.stringify(parsed.errors)}`);
    }

    return {
      events: parsed.nodes.map((node) => mapGraphQLEventNode(node, this.#packageId)),
      nextCursor: parsed.endCursor,
      hasNextPage: parsed.hasNextPage
    };
  }
}

export class JsonlSessionSpendEventSource implements SessionSpendEventSource {
  readonly #readLines: () => Promise<JsonlSessionSpendLineInput>;

  constructor(options: JsonlSessionSpendEventSourceOptions) {
    const lines = options.lines;
    this.#readLines =
      typeof lines === "function"
        ? async () => lines()
        : async () => lines;
  }

  async fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> {
    const startOffset = readJsonlCursor(query.cursor);
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("JSONL session spend event limit must be a positive integer");
    }

    const events: SessionSpendEventLike[] = [];
    let eventOffset = 0;
    let physicalLine = 0;
    let hasNextPage = false;

    for await (const line of toAsyncLines(await this.#readLines())) {
      physicalLine += 1;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const event = parseJsonlSessionSpendEvent(trimmed, physicalLine);
      if (eventOffset < startOffset) {
        eventOffset += 1;
        continue;
      }

      if (events.length >= limit) {
        hasNextPage = true;
        break;
      }

      events.push(event);
      eventOffset += 1;
    }

    return {
      events,
      nextCursor: events.length > 0 ? String(startOffset + events.length) : query.cursor,
      hasNextPage
    };
  }
}

export class SuiGrpcCheckpointSessionSpendEventSource implements SessionSpendEventSource {
  readonly #ledgerService: SuiGrpcLedgerServiceLike;
  readonly #packageId: string;
  readonly #coinType: string;
  readonly #startCheckpoint: bigint;
  readonly #maxCheckpointsPerPage: number;
  readonly #readMaskPaths: string[];

  constructor(options: SuiGrpcCheckpointSessionSpendEventSourceOptions) {
    this.#ledgerService = getGrpcLedgerService(options.client);
    this.#packageId = options.packageId;
    this.#coinType = options.coinType ?? "0x2::sui::SUI";
    this.#startCheckpoint = readBigIntOption(options.startCheckpoint ?? 0, "start checkpoint");
    this.#maxCheckpointsPerPage = options.maxCheckpointsPerPage ?? 10;
    if (!Number.isInteger(this.#maxCheckpointsPerPage) || this.#maxCheckpointsPerPage <= 0) {
      throw new Error("maxCheckpointsPerPage must be a positive integer");
    }
    this.#readMaskPaths = [...(options.readMaskPaths ?? DEFAULT_SUI_GRPC_CHECKPOINT_READ_MASK)];
  }

  async fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("gRPC session spend event limit must be a positive integer");
    }

    let cursor = readGrpcCheckpointCursor(query.cursor, this.#startCheckpoint);
    const events: SessionSpendEventLike[] = [];
    let scannedCheckpoints = 0;
    let hasNextPage = false;

    while (events.length < limit && scannedCheckpoints < this.#maxCheckpointsPerPage) {
      const response = await readGrpcUnaryResponse(
        this.#ledgerService.getCheckpoint({
          checkpointId: {
            oneofKind: "sequenceNumber",
            sequenceNumber: cursor.checkpoint
          },
          readMask: {
            paths: this.#readMaskPaths
          }
        })
      );
      const checkpoint = response.checkpoint;
      if (!checkpoint) {
        break;
      }

      const checkpointEvents = mapGrpcCheckpointSessionSpendEvents(checkpoint, {
        packageId: this.#packageId,
        coinType: this.#coinType
      });
      const remainingCheckpointEvents = checkpointEvents.slice(cursor.eventOffset);
      const available = limit - events.length;
      const selected = remainingCheckpointEvents.slice(0, available);
      events.push(...selected);

      if (selected.length < remainingCheckpointEvents.length) {
        cursor = {
          checkpoint: cursor.checkpoint,
          eventOffset: cursor.eventOffset + selected.length
        };
        hasNextPage = true;
        break;
      }

      cursor = {
        checkpoint: cursor.checkpoint + 1n,
        eventOffset: 0
      };
      scannedCheckpoints += 1;
    }

    if (!hasNextPage && (events.length >= limit || scannedCheckpoints >= this.#maxCheckpointsPerPage)) {
      hasNextPage = true;
    }

    return {
      events,
      nextCursor: formatGrpcCheckpointCursor(cursor),
      hasNextPage
    };
  }
}

export class SuiGrpcCheckpointSettlementEventSource implements SessionSpendEventSource {
  readonly #ledgerService: SuiGrpcLedgerServiceLike;
  readonly #packageId: string;
  readonly #coinType: string;
  readonly #startCheckpoint: bigint;
  readonly #maxCheckpointsPerPage: number;
  readonly #readMaskPaths: string[];

  constructor(options: SuiGrpcCheckpointSettlementEventSourceOptions) {
    this.#ledgerService = getGrpcLedgerService(options.client);
    this.#packageId = options.packageId;
    this.#coinType = options.coinType ?? "0x2::sui::SUI";
    this.#startCheckpoint = readBigIntOption(options.startCheckpoint ?? 0, "start checkpoint");
    this.#maxCheckpointsPerPage = options.maxCheckpointsPerPage ?? 10;
    if (!Number.isInteger(this.#maxCheckpointsPerPage) || this.#maxCheckpointsPerPage <= 0) {
      throw new Error("maxCheckpointsPerPage must be a positive integer");
    }
    this.#readMaskPaths = [...(options.readMaskPaths ?? DEFAULT_SUI_GRPC_CHECKPOINT_READ_MASK)];
  }

  async fetchSessionSpendEvents(query: SessionSpendQuery): Promise<SessionSpendEventPage> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("gRPC settlement event limit must be a positive integer");
    }

    let cursor = readGrpcCheckpointCursor(query.cursor, this.#startCheckpoint);
    const events: SessionSpendEventLike[] = [];
    let scannedCheckpoints = 0;
    let hasNextPage = false;

    while (events.length < limit && scannedCheckpoints < this.#maxCheckpointsPerPage) {
      const response = await readGrpcUnaryResponse(
        this.#ledgerService.getCheckpoint({
          checkpointId: {
            oneofKind: "sequenceNumber",
            sequenceNumber: cursor.checkpoint
          },
          readMask: {
            paths: this.#readMaskPaths
          }
        })
      );
      const checkpoint = response.checkpoint;
      if (!checkpoint) {
        break;
      }

      const checkpointEvents = mapGrpcCheckpointSettlementEvents(checkpoint, {
        packageId: this.#packageId,
        coinType: this.#coinType
      });
      const remainingCheckpointEvents = checkpointEvents.slice(cursor.eventOffset);
      const available = limit - events.length;
      const selected = remainingCheckpointEvents.slice(0, available);
      events.push(...selected);

      if (selected.length < remainingCheckpointEvents.length) {
        cursor = {
          checkpoint: cursor.checkpoint,
          eventOffset: cursor.eventOffset + selected.length
        };
        hasNextPage = true;
        break;
      }

      cursor = {
        checkpoint: cursor.checkpoint + 1n,
        eventOffset: 0
      };
      scannedCheckpoints += 1;
    }

    if (!hasNextPage && (events.length >= limit || scannedCheckpoints >= this.#maxCheckpointsPerPage)) {
      hasNextPage = true;
    }

    return {
      events,
      nextCursor: formatGrpcCheckpointCursor(cursor),
      hasNextPage
    };
  }
}

export async function indexSessionSpendEvents(
  options: IndexSessionSpendEventsOptions
): Promise<IndexSessionSpendEventsResult> {
  let cursor = options.cursor;
  let processed = 0;
  let skipped = 0;
  let hasNextPage = false;
  const maxPages = options.maxPages ?? 1;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await options.source.fetchSessionSpendEvents({
      cursor,
      limit: options.pageLimit
    });

    for (const event of page.events) {
      const record = normalizeSessionSpendEvent(event, {
        network: options.network,
        packageId: options.packageId,
        coinType: options.coinType
      });
      if (!record) {
        skipped += 1;
        continue;
      }

      await options.store.upsert(record);
      processed += 1;
    }

    cursor = page.nextCursor;
    hasNextPage = Boolean(page.hasNextPage && page.nextCursor);
    if (!hasNextPage) {
      break;
    }
  }

  return {
    processed,
    skipped,
    nextCursor: cursor,
    hasNextPage
  };
}

export async function indexSettlementEvents(
  options: IndexSettlementEventsOptions
): Promise<IndexSettlementEventsResult> {
  let cursor = options.cursor;
  let processed = 0;
  let skipped = 0;
  let hasNextPage = false;
  const maxPages = options.maxPages ?? 1;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await options.source.fetchSessionSpendEvents({
      cursor,
      limit: options.pageLimit
    });

    for (const event of page.events) {
      const record = normalizeSettlementEvent(event, {
        network: options.network,
        packageId: options.packageId,
        coinType: options.coinType
      });
      if (!record) {
        skipped += 1;
        continue;
      }

      await options.store.upsert(record);
      processed += 1;
    }

    cursor = page.nextCursor;
    hasNextPage = Boolean(page.hasNextPage && page.nextCursor);
    if (!hasNextPage) {
      break;
    }
  }

  return {
    processed,
    skipped,
    nextCursor: cursor,
    hasNextPage
  };
}

export function normalizeSessionSpendEvent(
  event: SessionSpendEventLike,
  options: NormalizeSessionSpendEventOptions = {}
): SessionSpendRecord | undefined {
  if (options.packageId && normalizeAddress(event.packageId ?? "") !== normalizeAddress(options.packageId)) {
    return undefined;
  }

  if (event.transactionModule && event.transactionModule !== "sessions") {
    return undefined;
  }

  if (!event.type || !event.type.includes("::sessions::SessionSpent<")) {
    return undefined;
  }

  const parsed = asRecord(event.parsedJson);
  if (!parsed) {
    return undefined;
  }

  const coinType = normalizeCoinType(extractSessionSpentCoinType(event.type));
  if (options.coinType && normalizeCoinType(coinType) !== normalizeCoinType(options.coinType)) {
    return undefined;
  }

  const txDigest = event.id?.txDigest;
  if (!txDigest) {
    throw new Error("Session spend event is missing tx digest");
  }

  const eventSeq = event.id?.eventSeq === undefined ? undefined : String(event.id.eventSeq);
  const amount = readRequiredString(parsed.amount, "amount");
  const sessionId = readRequiredString(parsed.session_id ?? parsed.sessionId, "session_id");
  const merchant = readRequiredString(parsed.merchant, "merchant");
  const challengeId = readBytesHex(parsed.challenge_id ?? parsed.challengeId, "challenge_id");
  const resourceScopeHash = readBytesHex(
    parsed.resource_scope_hash ?? parsed.resourceScopeHash,
    "resource_scope_hash"
  );

  return {
    id: `${txDigest}:${eventSeq ?? "0"}`,
    network: options.network ?? "sui:testnet",
    packageId: event.packageId ?? extractPackageId(event.type),
    coinType,
    txDigest,
    eventSeq,
    sessionId,
    payer: readOptionalString(parsed.payer),
    merchant,
    amount,
    spentTotal: readOptionalString(parsed.spent_total ?? parsed.spentTotal),
    challengeId,
    resourceScopeHash,
    sender: event.sender,
    timestampMs: normalizeTimestampMs(event.timestampMs),
    indexedAt: new Date().toISOString()
  };
}

export function normalizeSettlementEvent(
  event: SessionSpendEventLike,
  options: NormalizeSettlementEventOptions = {}
): SettlementRecord | undefined {
  if (options.packageId && normalizeAddress(event.packageId ?? "") !== normalizeAddress(options.packageId)) {
    return undefined;
  }

  if (event.transactionModule && event.transactionModule !== "settlement") {
    return undefined;
  }

  if (!event.type || !isSettlementEventType(event.type)) {
    return undefined;
  }

  const parsed = asRecord(event.parsedJson);
  if (!parsed) {
    return undefined;
  }

  const coinType = normalizeCoinType(extractSettlementCoinType(event.type));
  if (options.coinType && normalizeCoinType(coinType) !== normalizeCoinType(options.coinType)) {
    return undefined;
  }

  const txDigest = event.id?.txDigest;
  if (!txDigest) {
    throw new Error("Settlement event is missing tx digest");
  }

  const eventSeq = event.id?.eventSeq === undefined ? undefined : String(event.id.eventSeq);
  const kind = settlementKindFromType(event.type);
  const ledgerId = readRequiredSettlementString(parsed.ledger_id ?? parsed.ledgerId, "ledger_id");
  const merchant = readRequiredSettlementString(parsed.merchant, "merchant");
  const submitter = readRequiredSettlementString(parsed.submitter, "submitter");

  if (kind === "receipt") {
    return {
      id: `${txDigest}:${eventSeq ?? "0"}`,
      network: options.network ?? "sui:testnet",
      packageId: event.packageId ?? extractSettlementPackageId(event.type),
      coinType,
      txDigest,
      eventSeq,
      kind,
      ledgerId,
      receiptId: readBytesHex(parsed.receipt_id ?? parsed.receiptId, "receipt_id"),
      payer: readRequiredSettlementString(parsed.payer, "payer"),
      merchant,
      signer: readRequiredSettlementString(parsed.signer, "signer"),
      amount: readRequiredSettlementString(parsed.amount, "amount"),
      sequence: readRequiredSettlementString(parsed.sequence, "sequence"),
      resourceScopeHash: readBytesHex(
        parsed.resource_scope_hash ?? parsed.resourceScopeHash,
        "resource_scope_hash"
      ),
      submitter,
      sender: event.sender,
      timestampMs: normalizeTimestampMs(event.timestampMs),
      indexedAt: new Date().toISOString()
    };
  }

  return {
    id: `${txDigest}:${eventSeq ?? "0"}`,
    network: options.network ?? "sui:testnet",
    packageId: event.packageId ?? extractSettlementPackageId(event.type),
    coinType,
    txDigest,
    eventSeq,
    kind,
    ledgerId,
    merchant,
    receiptCount: readRequiredSettlementString(parsed.receipt_count ?? parsed.receiptCount, "receipt_count"),
    totalAmount: readRequiredSettlementString(parsed.total_amount ?? parsed.totalAmount, "total_amount"),
    submitter,
    sender: event.sender,
    timestampMs: normalizeTimestampMs(event.timestampMs),
    indexedAt: new Date().toISOString()
  };
}

export function mapCustomSessionSpendEvent(value: unknown): SessionSpendEventLike {
  const envelope = asRecord(value);
  const event = asRecord(envelope?.event) ?? envelope;
  if (!event) {
    throw new Error("Custom session spend event must be a JSON object");
  }

  const id = asRecord(event.id);
  const txDigest =
    readOptionalString(id?.txDigest) ??
    readOptionalString(event.txDigest) ??
    readOptionalString(event.tx_digest) ??
    readOptionalString(event.transactionDigest) ??
    readOptionalString(event.transaction_digest) ??
    readOptionalString(event.digest);
  const eventSeq =
    readOptionalString(id?.eventSeq) ??
    readOptionalString(event.eventSeq) ??
    readOptionalString(event.event_seq) ??
    readOptionalString(event.sequenceNumber) ??
    readOptionalString(event.sequence_number);

  return {
    id: {
      txDigest,
      eventSeq
    },
    packageId: readOptionalString(event.packageId) ?? readOptionalString(event.package_id),
    transactionModule:
      readOptionalString(event.transactionModule) ??
      readOptionalString(event.transaction_module) ??
      readOptionalString(event.module),
    sender: readOptionalString(event.sender),
    type: readOptionalString(event.type) ?? readOptionalString(event.eventType) ?? readOptionalString(event.event_type),
    parsedJson: event.parsedJson ?? event.parsed_json ?? event.json ?? event.contents,
    timestampMs:
      readOptionalString(event.timestampMs) ??
      readOptionalString(event.timestamp_ms) ??
      readOptionalString(event.timestamp)
  };
}

export function mapGrpcCheckpointSessionSpendEvents(
  checkpoint: SuiGrpcCheckpointLike,
  options: { packageId: string; coinType?: string }
): SessionSpendEventLike[] {
  const events: SessionSpendEventLike[] = [];
  const checkpointSequence = checkpoint.sequenceNumber === undefined ? undefined : String(checkpoint.sequenceNumber);

  for (const [transactionIndex, transaction] of (checkpoint.transactions ?? []).entries()) {
    const txDigest = transaction.digest;
    if (!txDigest) {
      continue;
    }

    for (const [eventIndex, event] of (transaction.events?.events ?? []).entries()) {
      if (!isMatchingSessionSpendEventType(event.eventType, options)) {
        continue;
      }

      events.push({
        id: {
          txDigest,
          eventSeq: `${checkpointSequence ?? "unknown"}:${transactionIndex}:${eventIndex}`
        },
        packageId: event.packageId,
        transactionModule: event.module,
        sender: event.sender,
        type: event.eventType,
        parsedJson: protobufValueToJson(event.json),
        timestampMs: grpcTimestampToMs(transaction.timestamp)
      });
    }
  }

  return events;
}

export function mapGrpcCheckpointSettlementEvents(
  checkpoint: SuiGrpcCheckpointLike,
  options: { packageId: string; coinType?: string }
): SessionSpendEventLike[] {
  const events: SessionSpendEventLike[] = [];
  const checkpointSequence = checkpoint.sequenceNumber === undefined ? undefined : String(checkpoint.sequenceNumber);

  for (const [transactionIndex, transaction] of (checkpoint.transactions ?? []).entries()) {
    const txDigest = transaction.digest;
    if (!txDigest) {
      continue;
    }

    for (const [eventIndex, event] of (transaction.events?.events ?? []).entries()) {
      if (!isMatchingSettlementEventType(event.eventType, options)) {
        continue;
      }

      events.push({
        id: {
          txDigest,
          eventSeq: `${checkpointSequence ?? "unknown"}:${transactionIndex}:${eventIndex}`
        },
        packageId: event.packageId,
        transactionModule: event.module,
        sender: event.sender,
        type: event.eventType,
        parsedJson: protobufValueToJson(event.json),
        timestampMs: grpcTimestampToMs(transaction.timestamp)
      });
    }
  }

  return events;
}

export function aggregateSessionSpends(records: SessionSpendRecord[]): SessionSpendAggregate[] {
  const bySession = new Map<string, SessionSpendAggregate>();
  const sorted = [...records].sort(compareRecordsAscending);

  for (const record of sorted) {
    const existing = bySession.get(record.sessionId);
    if (!existing) {
      bySession.set(record.sessionId, {
        sessionId: record.sessionId,
        network: record.network,
        payer: record.payer,
        merchant: record.merchant,
        coinType: record.coinType,
        spendCount: 1,
        spentAmount: record.amount,
        spentTotal: record.spentTotal,
        resourceScopeHashes: [record.resourceScopeHash],
        firstSeenAt: record.timestampMs,
        lastSeenAt: record.timestampMs,
        lastTxDigest: record.txDigest,
        lastEventId: record.id
      });
      continue;
    }

    existing.spendCount += 1;
    existing.spentAmount = (BigInt(existing.spentAmount) + BigInt(record.amount)).toString();
    existing.spentTotal = record.spentTotal ?? existing.spentTotal;
    if (!existing.resourceScopeHashes.includes(record.resourceScopeHash)) {
      existing.resourceScopeHashes.push(record.resourceScopeHash);
    }
    existing.lastSeenAt = record.timestampMs ?? existing.lastSeenAt;
    existing.lastTxDigest = record.txDigest;
    existing.lastEventId = record.id;
  }

  return [...bySession.values()].sort((left, right) => compareOptionalTimeDesc(left.lastSeenAt, right.lastSeenAt));
}

function extractPackageId(type: string): string {
  const index = type.indexOf("::sessions::SessionSpent<");
  return index < 0 ? "" : type.slice(0, index);
}

function extractSettlementPackageId(type: string): string {
  const receiptIndex = type.indexOf("::settlement::ReceiptSettled<");
  if (receiptIndex >= 0) {
    return type.slice(0, receiptIndex);
  }

  const batchIndex = type.indexOf("::settlement::BatchSettled<");
  return batchIndex < 0 ? "" : type.slice(0, batchIndex);
}

function extractSessionSpentCoinType(type: string): string {
  const start = type.indexOf("<");
  if (start < 0) {
    throw new Error(`SessionSpent event type is missing type argument: ${type}`);
  }

  let depth = 0;
  for (let index = start; index < type.length; index += 1) {
    const char = type[index];
    if (char === "<") {
      depth += 1;
      continue;
    }

    if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return type.slice(start + 1, index).trim();
      }
    }
  }

  throw new Error(`Could not parse SessionSpent event type argument: ${type}`);
}

function extractSettlementCoinType(type: string): string {
  const start = type.indexOf("<");
  if (start < 0) {
    throw new Error(`Settlement event type is missing type argument: ${type}`);
  }

  let depth = 0;
  for (let index = start; index < type.length; index += 1) {
    const char = type[index];
    if (char === "<") {
      depth += 1;
      continue;
    }

    if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return type.slice(start + 1, index).trim();
      }
    }
  }

  throw new Error(`Could not parse settlement event type argument: ${type}`);
}

function isSettlementEventType(type: string): boolean {
  return type.includes("::settlement::ReceiptSettled<") || type.includes("::settlement::BatchSettled<");
}

function settlementKindFromType(type: string): SettlementRecordKind {
  return type.includes("::settlement::ReceiptSettled<") ? "receipt" : "batch";
}

function readRequiredSettlementString(value: unknown, fieldName: string): string {
  const parsed = readOptionalString(value);
  if (parsed !== undefined) {
    return parsed;
  }

  throw new Error(`Settlement event is missing ${fieldName}`);
}

function readRequiredString(value: unknown, fieldName: string): string {
  const parsed = readOptionalString(value);
  if (parsed !== undefined) {
    return parsed;
  }

  throw new Error(`Session spend event is missing ${fieldName}`);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return undefined;
}

function readBytesHex(value: unknown, fieldName: string): string {
  if (Array.isArray(value)) {
    return bytesToHex(Uint8Array.from(value.map((byte) => Number(byte))));
  }

  if (typeof value !== "string") {
    throw new Error(`Session spend event is missing ${fieldName}`);
  }

  const normalized = stripHexPrefix(value).toLowerCase();
  if (normalized.length % 2 === 0 && /^[a-f0-9]+$/.test(normalized)) {
    return normalized;
  }

  try {
    return bytesToHex(Buffer.from(value, "base64"));
  } catch {
    throw new Error(`Session spend event field ${fieldName} must be hex, byte array, or base64`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function compareRecordsAscending(left: SessionSpendRecord, right: SessionSpendRecord): number {
  return compareOptionalTimeAsc(left.timestampMs, right.timestampMs) || left.id.localeCompare(right.id);
}

function compareRecordsDescending(left: SessionSpendRecord, right: SessionSpendRecord): number {
  return compareOptionalTimeDesc(left.timestampMs, right.timestampMs) || right.id.localeCompare(left.id);
}

function compareSettlementRecordsDescending(left: SettlementRecord, right: SettlementRecord): number {
  return compareOptionalTimeDesc(left.timestampMs, right.timestampMs) || right.id.localeCompare(left.id);
}

function matchesSettlementRecordQuery(record: SettlementRecord, query: SettlementRecordQuery): boolean {
  return (
    (!query.kind || record.kind === query.kind) &&
    (!query.ledgerId || normalizeAddress(record.ledgerId) === normalizeAddress(query.ledgerId)) &&
    (!query.merchant || normalizeAddress(record.merchant) === normalizeAddress(query.merchant)) &&
    (!query.submitter || normalizeAddress(record.submitter) === normalizeAddress(query.submitter))
  );
}

function settlementRecordMatchesIdentifier(record: SettlementRecord, identifier: string): boolean {
  return (
    record.id === identifier ||
    record.txDigest === identifier ||
    normalizeAddress(record.ledgerId) === normalizeAddress(identifier) ||
    record.receiptId === identifier
  );
}

function compareOptionalTimeAsc(left: string | undefined, right: string | undefined): number {
  return Number(left ?? 0) - Number(right ?? 0);
}

function compareOptionalTimeDesc(left: string | undefined, right: string | undefined): number {
  return Number(right ?? 0) - Number(left ?? 0);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function normalizeCoinType(value: string): string {
  return value.replace(/0x[a-f0-9]{64}(?=::)/gi, (address) => normalizeSuiAddressInType(address));
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSuiAddressInType(address: string): string {
  const stripped = stripHexPrefix(address).replace(/^0+/, "");
  return `0x${stripped.length > 0 ? stripped : "0"}`;
}

function normalizeTimestampMs(value: string | number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (/^\d+$/.test(value)) {
    return value;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? String(parsed) : value;
}

function getGrpcLedgerService(client: SuiGrpcClientLike): SuiGrpcLedgerServiceLike {
  const maybeClient = client as { ledgerService?: SuiGrpcLedgerServiceLike };
  return maybeClient.ledgerService ?? (client as SuiGrpcLedgerServiceLike);
}

async function readGrpcUnaryResponse<Response>(call: SuiGrpcUnaryCall<Response>): Promise<Response> {
  const awaited = await call;
  return awaited.response;
}

function readBigIntOption(value: bigint | number | string, name: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${name} must be an integer`);
  }
}

function isMatchingSessionSpendEventType(
  eventType: string | undefined,
  options: { packageId: string; coinType?: string }
): boolean {
  if (!eventType || !eventType.includes("::sessions::SessionSpent<")) {
    return false;
  }

  if (normalizeAddress(extractPackageId(eventType)) !== normalizeAddress(options.packageId)) {
    return false;
  }

  return !options.coinType || normalizeCoinType(extractSessionSpentCoinType(eventType)) === normalizeCoinType(options.coinType);
}

function isMatchingSettlementEventType(
  eventType: string | undefined,
  options: { packageId: string; coinType?: string }
): boolean {
  if (!eventType || !isSettlementEventType(eventType)) {
    return false;
  }

  if (normalizeAddress(extractSettlementPackageId(eventType)) !== normalizeAddress(options.packageId)) {
    return false;
  }

  return !options.coinType || normalizeCoinType(extractSettlementCoinType(eventType)) === normalizeCoinType(options.coinType);
}

function readGraphQLSettlementCursor(cursor: string | undefined): { receipt?: string; batch?: string } {
  if (cursor === undefined || cursor === "") {
    return {};
  }

  try {
    const parsed = asRecord(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return {
      receipt: readOptionalString(parsed?.receipt),
      batch: readOptionalString(parsed?.batch)
    };
  } catch {
    throw new Error(`Invalid GraphQL settlement cursor: ${cursor}`);
  }
}

function formatGraphQLSettlementCursor(cursor: { receipt?: string; batch?: string }): string | undefined {
  if (!cursor.receipt && !cursor.batch) {
    return undefined;
  }

  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function readGrpcCheckpointCursor(
  cursor: string | undefined,
  startCheckpoint: bigint
): { checkpoint: bigint; eventOffset: number } {
  if (cursor === undefined || cursor === "") {
    return {
      checkpoint: startCheckpoint,
      eventOffset: 0
    };
  }

  const [checkpointPart, offsetPart = "0"] = cursor.split(":");
  const checkpoint = readBigIntOption(checkpointPart ?? "", "gRPC checkpoint cursor");
  const eventOffset = Number(offsetPart);
  if (!Number.isInteger(eventOffset) || eventOffset < 0) {
    throw new Error(`Invalid gRPC checkpoint cursor: ${cursor}`);
  }

  return {
    checkpoint,
    eventOffset
  };
}

function formatGrpcCheckpointCursor(cursor: { checkpoint: bigint; eventOffset: number }): string {
  return `${cursor.checkpoint.toString()}:${cursor.eventOffset}`;
}

function grpcTimestampToMs(value: SuiGrpcExecutedTransactionLike["timestamp"]): string | undefined {
  if (!value?.seconds) {
    return undefined;
  }

  const seconds = readBigIntOption(value.seconds, "gRPC timestamp seconds");
  const nanos = BigInt(value.nanos ?? 0);
  return (seconds * 1000n + nanos / 1_000_000n).toString();
}

function protobufValueToJson(value: unknown): unknown {
  const record = asRecord(value);
  const kind = asRecord(record?.kind);
  const oneofKind = readOptionalString(kind?.oneofKind);
  if (!record || !kind || !oneofKind) {
    return value;
  }

  if (oneofKind === "nullValue") {
    return null;
  }

  if (oneofKind === "numberValue") {
    return kind.numberValue;
  }

  if (oneofKind === "stringValue") {
    return kind.stringValue;
  }

  if (oneofKind === "boolValue") {
    return kind.boolValue;
  }

  if (oneofKind === "listValue") {
    const listValue = asRecord(kind.listValue);
    return Array.isArray(listValue?.values) ? listValue.values.map(protobufValueToJson) : [];
  }

  if (oneofKind === "structValue") {
    const structValue = asRecord(kind.structValue);
    const fields = asRecord(structValue?.fields) ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, protobufValueToJson(field)]));
  }

  return undefined;
}

function readJsonlCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") {
    return 0;
  }

  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid JSONL session spend cursor: ${cursor}`);
  }

  return parsed;
}

async function* toAsyncLines(lines: JsonlSessionSpendLineInput): AsyncIterable<string> {
  for await (const line of lines) {
    yield String(line);
  }
}

function parseJsonlSessionSpendEvent(line: string, physicalLine: number): SessionSpendEventLike {
  try {
    return mapCustomSessionSpendEvent(JSON.parse(line));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSONL session spend event at line ${physicalLine}: ${message}`);
  }
}

function graphQlUrlForNetwork(network: Sui402Network): string {
  switch (network) {
    case "sui:mainnet":
      return "https://graphql.mainnet.sui.io/graphql";
    case "sui:testnet":
      return "https://graphql.testnet.sui.io/graphql";
    case "sui:devnet":
      return "https://graphql.devnet.sui.io/graphql";
    case "sui:localnet":
      return "http://127.0.0.1:9125/graphql";
  }
}

async function defaultGraphQLFetch(url: string, init: GraphQLFetchInit): Promise<GraphQLFetchResponse> {
  return fetch(url, init);
}

function parseGraphQLEventPayload(payload: unknown): {
  nodes: SuiGraphQLEventNode[];
  endCursor?: string;
  hasNextPage: boolean;
  errors: unknown[];
} {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const events = asRecord(data?.events);
  const pageInfo = asRecord(events?.pageInfo);
  const nodes = Array.isArray(events?.nodes) ? events.nodes.map(asRecord).filter((node) => node !== undefined) : [];

  return {
    nodes: nodes as SuiGraphQLEventNode[],
    endCursor: readOptionalString(pageInfo?.endCursor),
    hasNextPage: Boolean(pageInfo?.hasNextPage),
    errors: Array.isArray(root?.errors) ? root.errors : []
  };
}

function mapGraphQLEventNode(node: SuiGraphQLEventNode, fallbackPackageId: string): SessionSpendEventLike {
  const transaction = asRecord(node.transaction);
  const transactionModule = asRecord(node.transactionModule);
  const sendingModule = asRecord(node.sendingModule) ?? transactionModule;
  const sendingPackage = asRecord(sendingModule?.package);
  const sender = asRecord(node.sender);
  const type = asRecord(node.type);
  const contents = asRecord(node.contents);
  const contentsType = asRecord(contents?.type);

  return {
    id: {
      txDigest: node.transactionDigest ?? node.digest ?? readOptionalString(transaction?.digest),
      eventSeq: node.eventSeq ?? node.sequenceNumber
    },
    packageId: readOptionalString(sendingPackage?.address) ?? node.packageId ?? fallbackPackageId,
    transactionModule: readOptionalString(sendingModule?.name) ?? node.transactionModule,
    sender: readOptionalString(sender?.address) ?? node.sender,
    type:
      readOptionalString(type?.repr) ??
      readOptionalString(contentsType?.repr) ??
      (typeof node.type === "string" ? node.type : undefined),
    parsedJson: contents?.json ?? node.contents,
    timestampMs: normalizeTimestampMs(node.timestampMs ?? node.timestamp)
  };
}

function assertSafeSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}

function addSqlFilter(filters: string[], values: unknown[], column: string, value: unknown): void {
  if (!value) {
    return;
  }

  values.push(value);
  filters.push(`${column} = $${values.length}`);
}

function rowToSessionSpendRecord(row: SessionSpendRecordRow): SessionSpendRecord {
  return {
    id: row.id,
    network: row.network,
    packageId: row.package_id,
    coinType: row.coin_type,
    txDigest: row.tx_digest,
    eventSeq: row.event_seq ?? undefined,
    sessionId: row.session_id,
    payer: row.payer ?? undefined,
    merchant: row.merchant,
    amount: String(row.amount),
    spentTotal: row.spent_total === null || row.spent_total === undefined ? undefined : String(row.spent_total),
    challengeId: row.challenge_id,
    resourceScopeHash: row.resource_scope_hash,
    sender: row.sender ?? undefined,
    timestampMs: row.timestamp_ms === null || row.timestamp_ms === undefined ? undefined : String(row.timestamp_ms),
    indexedAt: typeof row.indexed_at === "string" ? row.indexed_at : row.indexed_at.toISOString()
  };
}

function rowToSettlementRecord(row: SettlementRecordRow): SettlementRecord {
  return {
    id: row.id,
    network: row.network,
    packageId: row.package_id,
    coinType: row.coin_type,
    txDigest: row.tx_digest,
    eventSeq: row.event_seq ?? undefined,
    kind: row.kind,
    ledgerId: row.ledger_id,
    receiptId: row.receipt_id ?? undefined,
    payer: row.payer ?? undefined,
    merchant: row.merchant,
    signer: row.signer ?? undefined,
    amount: row.amount === null || row.amount === undefined ? undefined : String(row.amount),
    sequence: row.sequence === null || row.sequence === undefined ? undefined : String(row.sequence),
    resourceScopeHash: row.resource_scope_hash ?? undefined,
    submitter: row.submitter,
    receiptCount: row.receipt_count === null || row.receipt_count === undefined ? undefined : String(row.receipt_count),
    totalAmount: row.total_amount === null || row.total_amount === undefined ? undefined : String(row.total_amount),
    sender: row.sender ?? undefined,
    timestampMs: row.timestamp_ms === null || row.timestamp_ms === undefined ? undefined : String(row.timestamp_ms),
    indexedAt: typeof row.indexed_at === "string" ? row.indexed_at : row.indexed_at.toISOString()
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function consoleHttpHeaders(apiKey: string | undefined, json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  if (json) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

function consoleHttpUrl(
  baseUrl: string,
  path: string,
  query: object
): string {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query) as Array<[string, string | number | undefined]>) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function assertConsoleHttpResponse(response: Response, action: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(
    `Console HTTP sink failed to ${action}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`
  );
}
