import { describe, expect, it } from "vitest";
import {
  ConsoleHttpIndexerCursorStore,
  ConsoleHttpSessionSpendIndexStore,
  ConsoleHttpSettlementIndexStore,
  JsonlSessionSpendEventSource,
  MemoryIndexerCursorStore,
  MemorySettlementIndexStore,
  MemorySessionSpendIndexStore,
  PostgresIndexerCursorStore,
  PostgresSettlementIndexStore,
  PostgresSessionSpendIndexStore,
  SuiGrpcCheckpointSettlementEventSource,
  SuiGrpcCheckpointSessionSpendEventSource,
  SuiGraphQLSettlementEventSource,
  SuiGraphQLSessionSpendEventSource,
  aggregateSessionSpends,
  indexSettlementEvents,
  indexSessionSpendEvents,
  mapGrpcCheckpointSettlementEvents,
  mapGrpcCheckpointSessionSpendEvents,
  mapCustomSessionSpendEvent,
  normalizeSettlementEvent,
  normalizeSessionSpendEvent,
  type GraphQLFetch,
  type PostgresQueryResult,
  type SuiGrpcCheckpointLike,
  type SessionSpendRecord,
  type SessionSpendEventLike
} from "../src/index.js";
import { loadIndexerSyncConfig, runIndexerSyncLoop, type IndexerSyncConfig } from "../src/sync.js";

const PACKAGE = `0x${"f".repeat(64)}`;
const SESSION = `0x${"e".repeat(64)}`;
const PAYER = `0x${"b".repeat(64)}`;
const MERCHANT = `0x${"a".repeat(64)}`;
const OTHER = `0x${"c".repeat(64)}`;
const LEDGER = `0x${"9".repeat(64)}`;
const CHALLENGE = "11".repeat(32);
const SCOPE = "22".repeat(32);
const RECEIPT = "33".repeat(32);

describe("session spend indexer", () => {
  it("normalizes Sui SessionSpent events", () => {
    const record = normalizeSessionSpendEvent(makeEvent({ amount: "1000" }), {
      network: "sui:testnet",
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI"
    });

    expect(record).toMatchObject({
      id: "digest-1:0",
      network: "sui:testnet",
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI",
      txDigest: "digest-1",
      eventSeq: "0",
      sessionId: SESSION,
      payer: PAYER,
      merchant: MERCHANT,
      amount: "1000",
      spentTotal: "1000",
      challengeId: CHALLENGE,
      resourceScopeHash: SCOPE,
      timestampMs: "1779215414854"
    });
  });

  it("skips non-matching package and coin type events", () => {
    expect(
      normalizeSessionSpendEvent(makeEvent({}), {
        packageId: `0x${"1".repeat(64)}`
      })
    ).toBeUndefined();
    expect(
      normalizeSessionSpendEvent(makeEvent({}), {
        coinType: "0x2::other::OTHER"
      })
    ).toBeUndefined();
  });

  it("indexes pages into a store", async () => {
    const store = new MemorySessionSpendIndexStore();
    const result = await indexSessionSpendEvents({
      store,
      network: "sui:testnet",
      packageId: PACKAGE,
      source: {
        fetchSessionSpendEvents: ({ cursor }) => ({
          events: cursor ? [makeEvent({ digest: "digest-2", eventSeq: "1", amount: "2000" })] : [makeEvent({})],
          nextCursor: cursor ? undefined : "cursor-2",
          hasNextPage: !cursor
        })
      },
      maxPages: 2
    });

    expect(result).toEqual({
      processed: 2,
      skipped: 0,
      nextCursor: undefined,
      hasNextPage: false
    });
    expect(store.list()).toHaveLength(2);
    expect(store.list({ sessionId: SESSION, limit: 1 })[0]?.txDigest).toBe("digest-2");
  });

  it("aggregates session spends", () => {
    const first = normalizeSessionSpendEvent(makeEvent({ amount: "1000", spentTotal: "1000" }))!;
    const second = normalizeSessionSpendEvent(
      makeEvent({ digest: "digest-2", eventSeq: "1", amount: "2000", spentTotal: "3000", resourceScopeHash: "33".repeat(32) })
    )!;

    expect(aggregateSessionSpends([second, first])).toEqual([
      {
        sessionId: SESSION,
        network: "sui:testnet",
        payer: PAYER,
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        spendCount: 2,
        spentAmount: "3000",
        spentTotal: "3000",
        resourceScopeHashes: [SCOPE, "33".repeat(32)],
        firstSeenAt: "1779215414854",
        lastSeenAt: "1779215414854",
        lastTxDigest: "digest-2",
        lastEventId: "digest-2:1"
      }
    ]);
  });

  it("stores session spend records in Postgres-compatible storage", async () => {
    const postgres = new FakePostgres();
    const store = new PostgresSessionSpendIndexStore({
      client: postgres,
      tableName: "sui402_session_spend_events_test"
    });
    const record = normalizeSessionSpendEvent(makeEvent({ amount: "1000" }))!;

    await store.setup();
    await store.upsert(record);
    await store.upsert({
      ...record,
      amount: "2000",
      spentTotal: "2000",
      indexedAt: "2026-06-03T00:00:00.000Z"
    });

    expect(postgres.queries.some((query) => query.includes("create table if not exists sui402_session_spend_events_test"))).toBe(true);
    expect(postgres.queries.some((query) => query.includes("_session_timestamp_idx"))).toBe(true);
    expect(await store.list({ sessionId: SESSION })).toEqual([
      {
        ...record,
        amount: "2000",
        spentTotal: "2000",
        indexedAt: "2026-06-03T00:00:00.000Z"
      }
    ]);
    expect(await store.list({ payer: PAYER })).toHaveLength(1);
    expect(await store.list({ merchant: MERCHANT })).toHaveLength(1);
  });

  it("normalizes settlement receipt and batch events", () => {
    const receipt = normalizeSettlementEvent(makeSettlementReceiptEvent(), {
      network: "sui:testnet",
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI"
    });
    const batch = normalizeSettlementEvent(makeSettlementBatchEvent(), {
      network: "sui:testnet",
      packageId: PACKAGE
    });

    expect(receipt).toMatchObject({
      id: "settlement-digest-1:0",
      kind: "receipt",
      ledgerId: LEDGER,
      receiptId: RECEIPT,
      payer: PAYER,
      merchant: MERCHANT,
      signer: OTHER,
      amount: "1000",
      sequence: "1",
      resourceScopeHash: SCOPE,
      submitter: PAYER,
      coinType: "0x2::sui::SUI"
    });
    expect(batch).toMatchObject({
      id: "settlement-digest-2:1",
      kind: "batch",
      ledgerId: LEDGER,
      merchant: MERCHANT,
      receiptCount: "2",
      totalAmount: "3000",
      submitter: PAYER
    });
  });

  it("filters settlement records in memory", () => {
    const store = new MemorySettlementIndexStore();
    const receipt = normalizeSettlementEvent(makeSettlementReceiptEvent())!;
    store.upsert(receipt);
    store.upsert(normalizeSettlementEvent(makeSettlementBatchEvent())!);

    expect(store.list({ ledgerId: LEDGER })).toHaveLength(2);
    expect(store.list({ kind: "receipt" })).toHaveLength(1);
    expect(store.list({ merchant: MERCHANT, submitter: PAYER })).toHaveLength(2);
    expect(store.getByIdentifier(receipt.id)).toEqual(receipt);
    expect(store.getByIdentifier(receipt.txDigest)).toEqual(receipt);
    expect(store.getByIdentifier(receipt.ledgerId.toUpperCase())).toEqual(receipt);
    expect(store.getByIdentifier(receipt.receiptId!)).toEqual(receipt);
  });

  it("indexes settlement events into a store", async () => {
    const store = new MemorySettlementIndexStore();
    const result = await indexSettlementEvents({
      store,
      network: "sui:testnet",
      packageId: PACKAGE,
      source: {
        fetchSessionSpendEvents: ({ cursor }) => ({
          events: cursor ? [makeSettlementBatchEvent()] : [makeSettlementReceiptEvent()],
          nextCursor: cursor ? undefined : "cursor-2",
          hasNextPage: !cursor
        })
      },
      maxPages: 2
    });

    expect(result).toEqual({
      processed: 2,
      skipped: 0,
      nextCursor: undefined,
      hasNextPage: false
    });
    expect(store.list({ ledgerId: LEDGER })).toHaveLength(2);
    expect(store.list({ kind: "batch" })[0]?.totalAmount).toBe("3000");
  });

  it("rejects unsafe Postgres table names", () => {
    expect(() => new PostgresSessionSpendIndexStore({ client: new FakePostgres(), tableName: "bad;drop" })).toThrow(
      "Unsafe SQL identifier"
    );
    expect(() => new PostgresIndexerCursorStore({ client: new FakePostgres(), tableName: "bad;drop" })).toThrow(
      "Unsafe SQL identifier"
    );
    expect(() => new PostgresSettlementIndexStore({ client: new FakePostgres(), tableName: "bad;drop" })).toThrow(
      "Unsafe SQL identifier"
    );
  });

  it("stores cursor state in memory and Postgres-compatible storage", async () => {
    const memory = new MemoryIndexerCursorStore();
    memory.setCursor("job-1", "cursor-1");

    expect(memory.getCursor("job-1")).toMatchObject({
      key: "job-1",
      cursor: "cursor-1"
    });

    const postgres = new FakePostgres();
    const store = new PostgresIndexerCursorStore({
      client: postgres,
      tableName: "sui402_indexer_cursors_test"
    });
    await store.setup();
    await store.setCursor("job-1", "cursor-1");
    await store.setCursor("job-1", "cursor-2");

    expect(postgres.queries.some((query) => query.includes("create table if not exists sui402_indexer_cursors_test"))).toBe(true);
    expect(await store.getCursor("job-1")).toMatchObject({
      key: "job-1",
      cursor: "cursor-2"
    });
  });

  it("fetches session spend events from Sui GraphQL", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch: GraphQLFetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return graphQlResponse({
        data: {
          events: {
            nodes: [
              {
                sequenceNumber: 0,
                transaction: {
                  digest: "digest-1"
                },
                transactionModule: {
                  name: "sessions",
                  package: {
                    address: PACKAGE
                  }
                },
                sender: {
                  address: PAYER
                },
                contents: {
                  type: {
                    repr: `${PACKAGE}::sessions::SessionSpent<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>`
                  },
                  json: {
                    amount: "1000",
                    challenge_id: Buffer.from(CHALLENGE, "hex").toString("base64"),
                    merchant: MERCHANT,
                    payer: PAYER,
                    resource_scope_hash: Buffer.from(SCOPE, "hex").toString("base64"),
                    session_id: SESSION,
                    spent_total: "1000"
                  }
                },
                timestamp: "2026-05-18T18:23:39.460Z"
              }
            ],
            pageInfo: {
              hasNextPage: true,
              endCursor: "cursor-2"
            }
          }
        }
      });
    };
    const source = new SuiGraphQLSessionSpendEventSource({
      network: "sui:testnet",
      packageId: PACKAGE,
      fetch
    });

    const page = await source.fetchSessionSpendEvents({ limit: 25 });
    const body = calls[0]?.body as { variables?: Record<string, unknown> };
    const query = (calls[0]?.body as { query?: string }).query ?? "";

    expect(calls[0]?.url).toBe("https://graphql.testnet.sui.io/graphql");
    expect(query).toContain("filter: { type: $eventType }");
    expect(query).toContain("transactionModule");
    expect(query).toContain("transaction");
    expect(body.variables).toMatchObject({
      eventType: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
      cursor: null,
      limit: 25
    });
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.hasNextPage).toBe(true);
    expect(normalizeSessionSpendEvent(page.events[0]!)).toMatchObject({
      sessionId: SESSION,
      amount: "1000",
      coinType: "0x2::sui::SUI",
      challengeId: CHALLENGE,
      resourceScopeHash: SCOPE,
      timestampMs: "1779128619460"
    });
  });

  it("fetches settlement events from Sui GraphQL", async () => {
    const calls: Array<{ url: string; body: { variables?: Record<string, unknown> } }> = [];
    const fetch: GraphQLFetch = async (url, init) => {
      const body = JSON.parse(init.body) as { variables?: Record<string, unknown> };
      calls.push({ url, body });
      const eventType = String(body.variables?.eventType ?? "");
      return graphQlResponse({
        data: {
          events: {
            nodes: [
              eventType.includes("ReceiptSettled")
                ? makeGraphQLSettlementNode("ReceiptSettled", makeSettlementReceiptEvent())
                : makeGraphQLSettlementNode("BatchSettled", makeSettlementBatchEvent())
            ],
            pageInfo: {
              hasNextPage: eventType.includes("ReceiptSettled"),
              endCursor: eventType.includes("ReceiptSettled") ? "receipt-cursor-2" : "batch-cursor-2"
            }
          }
        }
      });
    };
    const source = new SuiGraphQLSettlementEventSource({
      network: "sui:testnet",
      packageId: PACKAGE,
      fetch
    });

    const page = await source.fetchSessionSpendEvents({ limit: 10 });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.variables).toMatchObject({
      eventType: `${PACKAGE}::settlement::ReceiptSettled<0x2::sui::SUI>`,
      cursor: null,
      limit: 5
    });
    expect(calls[1]?.body.variables).toMatchObject({
      eventType: `${PACKAGE}::settlement::BatchSettled<0x2::sui::SUI>`,
      cursor: null,
      limit: 5
    });
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBeDefined();
    expect(normalizeSettlementEvent(page.events[0]!)).toMatchObject({
      kind: "receipt",
      receiptId: RECEIPT
    });
    expect(normalizeSettlementEvent(page.events[1]!)).toMatchObject({
      kind: "batch",
      totalAmount: "3000"
    });
  });

  it("throws on GraphQL errors", async () => {
    const source = new SuiGraphQLSessionSpendEventSource({
      packageId: PACKAGE,
      fetch: async () =>
        graphQlResponse({
          errors: [{ message: "bad filter" }]
        })
    });

    await expect(source.fetchSessionSpendEvents({})).rejects.toThrow("Sui GraphQL returned errors");
  });

  it("maps custom indexer session spend events", () => {
    expect(
      mapCustomSessionSpendEvent({
        tx_digest: "digest-2",
        event_seq: 1,
        package_id: PACKAGE,
        transaction_module: "sessions",
        sender: PAYER,
        event_type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
        json: makeEventPayload({ amount: "2000" }),
        timestamp: "2026-05-18T18:23:39.460Z"
      })
    ).toEqual({
      id: {
        txDigest: "digest-2",
        eventSeq: "1"
      },
      packageId: PACKAGE,
      transactionModule: "sessions",
      sender: PAYER,
      type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
      parsedJson: makeEventPayload({ amount: "2000" }),
      timestampMs: "2026-05-18T18:23:39.460Z"
    });
  });

  it("fetches custom indexer events from JSONL with event-offset cursors", async () => {
    const source = new JsonlSessionSpendEventSource({
      lines: [
        "",
        JSON.stringify({ event: makeEvent({ digest: "digest-1", amount: "1000" }) }),
        JSON.stringify({
          txDigest: "digest-2",
          eventSeq: 1,
          packageId: PACKAGE,
          transactionModule: "sessions",
          sender: PAYER,
          type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
          parsed_json: makeEventPayload({ amount: "2000", spentTotal: "3000" }),
          timestamp_ms: "1779215414855"
        })
      ]
    });

    const firstPage = await source.fetchSessionSpendEvents({ limit: 1 });
    expect(firstPage.nextCursor).toBe("1");
    expect(firstPage.hasNextPage).toBe(true);
    expect(normalizeSessionSpendEvent(firstPage.events[0]!)).toMatchObject({
      txDigest: "digest-1",
      amount: "1000"
    });

    const secondPage = await source.fetchSessionSpendEvents({ cursor: firstPage.nextCursor, limit: 10 });
    expect(secondPage.nextCursor).toBe("2");
    expect(secondPage.hasNextPage).toBe(false);
    expect(normalizeSessionSpendEvent(secondPage.events[0]!)).toMatchObject({
      txDigest: "digest-2",
      amount: "2000",
      spentTotal: "3000"
    });
  });

  it("throws on invalid JSONL source cursors and lines", async () => {
    const invalidLineSource = new JsonlSessionSpendEventSource({
      lines: ["not-json"]
    });
    await expect(invalidLineSource.fetchSessionSpendEvents({})).rejects.toThrow(
      "Invalid JSONL session spend event at line 1"
    );

    const invalidCursorSource = new JsonlSessionSpendEventSource({
      lines: [JSON.stringify({ event: makeEvent({}) })]
    });
    await expect(invalidCursorSource.fetchSessionSpendEvents({ cursor: "bad" })).rejects.toThrow(
      "Invalid JSONL session spend cursor"
    );
  });

  it("maps Sui gRPC checkpoint events into session spend events", () => {
    const [event] = mapGrpcCheckpointSessionSpendEvents(makeGrpcCheckpoint(), {
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI"
    });

    expect(normalizeSessionSpendEvent(event!)).toMatchObject({
      txDigest: "grpc-digest-1",
      eventSeq: "10:0:1",
      packageId: PACKAGE,
      sender: PAYER,
      amount: "1000",
      challengeId: CHALLENGE,
      resourceScopeHash: SCOPE,
      timestampMs: "1779215414854"
    });
  });

  it("maps Sui gRPC checkpoint events into settlement events", () => {
    const events = mapGrpcCheckpointSettlementEvents(makeGrpcSettlementCheckpoint(), {
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI"
    });

    expect(events).toHaveLength(2);
    expect(normalizeSettlementEvent(events[0]!)).toMatchObject({
      txDigest: "grpc-settlement-digest-1",
      eventSeq: "12:0:0",
      kind: "receipt",
      receiptId: RECEIPT,
      amount: "1000",
      timestampMs: "1779215414854"
    });
    expect(normalizeSettlementEvent(events[1]!)).toMatchObject({
      kind: "batch",
      receiptCount: "2",
      totalAmount: "3000"
    });
  });

  it("fetches Sui gRPC checkpoint events with checkpoint-offset cursors", async () => {
    const requests: unknown[] = [];
    const checkpoints = new Map<string, SuiGrpcCheckpointLike>([
      ["10", makeGrpcCheckpoint()],
      [
        "11",
        {
          sequenceNumber: 11n,
          transactions: [
            {
              digest: "grpc-digest-2",
              timestamp: {
                seconds: 1779215414n,
                nanos: 855_000_000
              },
              events: {
                events: [makeGrpcEvent({ amount: "2000", spentTotal: "3000" })]
              }
            }
          ]
        }
      ]
    ]);
    const source = new SuiGrpcCheckpointSessionSpendEventSource({
      client: {
        ledgerService: {
          getCheckpoint: (input) => {
            requests.push(input);
            return {
              response: Promise.resolve({
                checkpoint: checkpoints.get(input.checkpointId.sequenceNumber.toString())
              })
            };
          }
        }
      },
      packageId: PACKAGE,
      startCheckpoint: 10n,
      maxCheckpointsPerPage: 2
    });

    const firstPage = await source.fetchSessionSpendEvents({ limit: 1 });
    expect(firstPage).toMatchObject({
      nextCursor: "11:0",
      hasNextPage: true
    });
    expect(normalizeSessionSpendEvent(firstPage.events[0]!)).toMatchObject({
      txDigest: "grpc-digest-1",
      amount: "1000"
    });

    const secondPage = await source.fetchSessionSpendEvents({
      cursor: firstPage.nextCursor,
      limit: 10
    });
    expect(secondPage).toMatchObject({
      nextCursor: "12:0",
      hasNextPage: false
    });
    expect(normalizeSessionSpendEvent(secondPage.events[0]!)).toMatchObject({
      txDigest: "grpc-digest-2",
      amount: "2000",
      spentTotal: "3000",
      timestampMs: "1779215414855"
    });
    expect((requests[0] as { readMask?: { paths?: string[] } }).readMask?.paths).toContain(
      "transactions.events.events.json"
    );
  });

  it("fetches Sui gRPC settlement events with checkpoint-offset cursors", async () => {
    const source = new SuiGrpcCheckpointSettlementEventSource({
      client: {
        ledgerService: {
          getCheckpoint: () => ({
            response: Promise.resolve({
              checkpoint: makeGrpcSettlementCheckpoint()
            })
          })
        }
      },
      packageId: PACKAGE,
      startCheckpoint: 12n,
      maxCheckpointsPerPage: 1
    });

    const firstPage = await source.fetchSessionSpendEvents({ limit: 1 });
    const secondPage = await source.fetchSessionSpendEvents({
      cursor: firstPage.nextCursor,
      limit: 1
    });

    expect(firstPage).toMatchObject({
      nextCursor: "12:1",
      hasNextPage: true
    });
    expect(normalizeSettlementEvent(firstPage.events[0]!)).toMatchObject({
      kind: "receipt"
    });
    expect(secondPage).toMatchObject({
      nextCursor: "13:0",
      hasNextPage: true
    });
    expect(normalizeSettlementEvent(secondPage.events[0]!)).toMatchObject({
      kind: "batch"
    });
  });

  it("loads indexer sync config from env and args", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_POSTGRES_URL: "postgres://user:pass@localhost:5432/sui402"
        },
        ["sync", "--max-pages", "2", "--setup", "true", "--summarize", "true"]
      )
    ).toEqual({
      command: "sync",
      eventKind: "session-spend",
      source: "graphql",
      sink: "postgres",
      network: "sui:testnet",
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI",
      graphqlUrl: undefined,
      jsonlPath: undefined,
      grpcUrl: undefined,
      grpcStartCheckpoint: undefined,
      grpcMaxCheckpointsPerPage: 10,
      postgresUrl: "postgres://user:pass@localhost:5432/sui402",
      consoleUrl: undefined,
      consoleApiKey: undefined,
      tableName: "sui402_session_spend_events",
      cursorTableName: "sui402_indexer_cursors",
      cursorKey: `${PACKAGE}:0x2::sui::SUI`,
      cursor: undefined,
      pageLimit: 50,
      maxPages: 2,
      setup: true,
      summarize: true,
      loop: false,
      intervalMs: 30000,
      retryInitialMs: 1000,
      retryMaxMs: 60000,
      maxRuns: undefined
    });
  });

  it("uses the console HTTP sink for records and durable cursors", async () => {
    const spend = normalizeSessionSpendEvent(makeEvent({ amount: "1000" }))!;
    const settlement = normalizeSettlementEvent(makeSettlementReceiptEvent())!;
    const requests: Array<{ url: string; method: string; authorization?: string; body?: unknown }> = [];
    const mockFetch: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      requests.push({
        url,
        method,
        authorization: headers.get("authorization") ?? undefined,
        body: init.body ? JSON.parse(String(init.body)) : undefined
      });

      if (url.includes("/v1/indexer/cursors/") && method === "GET") {
        return Response.json({
          state: { key: "settlement:key", cursor: "100:0", updatedAt: "2026-06-11T00:00:00.000Z" }
        });
      }
      if (url.includes("/v1/indexer/session-spends") && method === "GET") {
        return Response.json({ records: [spend] });
      }
      if (url.includes("/v1/indexer/settlement-events") && method === "GET") {
        return Response.json({ records: [settlement] });
      }

      return Response.json({ ok: true });
    };
    const options = {
      baseUrl: "http://127.0.0.1:4030/",
      apiKey: "indexer-secret-key",
      fetch: mockFetch
    };
    const cursors = new ConsoleHttpIndexerCursorStore(options);
    const spends = new ConsoleHttpSessionSpendIndexStore(options);
    const settlements = new ConsoleHttpSettlementIndexStore(options);

    await cursors.setCursor("settlement:key", "100:0");
    expect(await cursors.getCursor("settlement:key")).toMatchObject({ cursor: "100:0" });
    await spends.upsert(spend);
    expect(await spends.list({ merchant: MERCHANT, limit: 5 })).toEqual([spend]);
    await settlements.upsert(settlement);
    expect(await settlements.list({ kind: "receipt", limit: 5 })).toEqual([settlement]);

    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.authorization === "Bearer indexer-secret-key")).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      body: { cursor: "100:0" }
    });
    expect(requests[2]).toMatchObject({
      method: "POST",
      body: { record: spend }
    });
    expect(requests[3]?.url).toContain("merchant=0x");
    expect(requests[4]).toMatchObject({
      method: "POST",
      body: { record: settlement }
    });
  });

  it("loads console HTTP sink config without Postgres", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_SINK: "console-http",
          SUI402_INDEXER_CONSOLE_URL: "http://127.0.0.1:4030",
          SUI402_INDEXER_CONSOLE_API_KEY: "indexer-secret-key"
        },
        ["sync"]
      )
    ).toMatchObject({
      sink: "console-http",
      postgresUrl: undefined,
      consoleUrl: "http://127.0.0.1:4030",
      consoleApiKey: "indexer-secret-key"
    });
  });

  it("loads continuous indexer sync config", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_POSTGRES_URL: "postgres://user:pass@localhost:5432/sui402",
          SUI402_INDEXER_LOOP: "true",
          SUI402_INDEXER_INTERVAL_MS: "100",
          SUI402_INDEXER_RETRY_INITIAL_MS: "10",
          SUI402_INDEXER_RETRY_MAX_MS: "30",
          SUI402_INDEXER_MAX_RUNS: "2"
        },
        ["sync"]
      )
    ).toMatchObject({
      loop: true,
      intervalMs: 100,
      retryInitialMs: 10,
      retryMaxMs: 30,
      maxRuns: 2
    });
  });

  it("loads JSONL indexer sync config", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_SOURCE: "jsonl",
          SUI402_INDEXER_JSONL_PATH: "events.jsonl",
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_POSTGRES_URL: "postgres://user:pass@localhost:5432/sui402"
        },
        ["sync", "--cursor", "5"]
      )
    ).toMatchObject({
      source: "jsonl",
      jsonlPath: "events.jsonl",
      cursor: "5"
    });
  });

  it("loads gRPC indexer sync config", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_SOURCE: "grpc",
          SUI402_INDEXER_GRPC_URL: "https://fullnode.testnet.sui.io:443",
          SUI402_INDEXER_GRPC_START_CHECKPOINT: "10",
          SUI402_INDEXER_GRPC_MAX_CHECKPOINTS_PER_PAGE: "5",
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_POSTGRES_URL: "postgres://user:pass@localhost:5432/sui402"
        },
        ["sync"]
      )
    ).toMatchObject({
      source: "grpc",
      grpcUrl: "https://fullnode.testnet.sui.io:443",
      grpcStartCheckpoint: "10",
      grpcMaxCheckpointsPerPage: 5
    });
  });

  it("loads settlement indexer sync config", () => {
    expect(
      loadIndexerSyncConfig(
        {
          SUI402_INDEXER_EVENT_KIND: "settlement",
          SUI402_INDEXER_SOURCE: "grpc",
          SUI402_INDEXER_PACKAGE_ID: PACKAGE,
          SUI402_INDEXER_POSTGRES_URL: "postgres://user:pass@localhost:5432/sui402"
        },
        ["sync"]
      )
    ).toMatchObject({
      eventKind: "settlement",
      source: "grpc",
      tableName: "sui402_settlement_events",
      cursorKey: `settlement:${PACKAGE}:0x2::sui::SUI`
    });
  });

  it("runs continuous sync with retry backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await runIndexerSyncLoop(
      makeSyncConfig({
        loop: true,
        maxRuns: 3,
        intervalMs: 100,
        retryInitialMs: 10,
        retryMaxMs: 15
      }),
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        runOnce: async () => {
          calls += 1;
          if (calls <= 2) {
            throw new Error(`failure-${calls}`);
          }

          return { ok: true, run: calls };
        }
      }
    );

    expect(result).toEqual({
      ok: true,
      loop: true,
      attempts: 3,
      successes: 1,
      failures: 2,
      lastResult: { ok: true, run: 3 },
      lastError: undefined
    });
    expect(sleeps).toEqual([10, 15]);
  });

  it("rejects incomplete indexer sync config", () => {
    expect(() => loadIndexerSyncConfig({}, ["sync"])).toThrow("Missing required package id");
  });
});

function makeEvent(input: {
  digest?: string;
  eventSeq?: string;
  amount?: string;
  spentTotal?: string;
  resourceScopeHash?: string;
}): SessionSpendEventLike {
  return {
    id: {
      txDigest: input.digest ?? "digest-1",
      eventSeq: input.eventSeq ?? "0"
    },
    packageId: PACKAGE,
    transactionModule: "sessions",
    sender: PAYER,
    type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
    parsedJson: makeEventPayload(input),
    timestampMs: "1779215414854"
  };
}

function makeEventPayload(input: {
  amount?: string;
  spentTotal?: string;
  resourceScopeHash?: string;
}): Record<string, unknown> {
  return {
    amount: input.amount ?? "1000",
    challenge_id: Buffer.from(CHALLENGE, "hex").toString("base64"),
    merchant: MERCHANT,
    payer: PAYER,
    resource_scope_hash: Buffer.from(input.resourceScopeHash ?? SCOPE, "hex").toString("base64"),
    session_id: SESSION,
    spent_total: input.spentTotal ?? input.amount ?? "1000"
  };
}

function makeSettlementReceiptEvent(): SessionSpendEventLike {
  return {
    id: {
      txDigest: "settlement-digest-1",
      eventSeq: "0"
    },
    packageId: PACKAGE,
    transactionModule: "settlement",
    sender: PAYER,
    type: `${PACKAGE}::settlement::ReceiptSettled<0x2::sui::SUI>`,
    parsedJson: {
      ledger_id: LEDGER,
      receipt_id: Buffer.from(RECEIPT, "hex").toString("base64"),
      payer: PAYER,
      merchant: MERCHANT,
      signer: OTHER,
      amount: "1000",
      sequence: "1",
      resource_scope_hash: Buffer.from(SCOPE, "hex").toString("base64"),
      submitter: PAYER
    },
    timestampMs: "1779215414854"
  };
}

function makeSettlementBatchEvent(): SessionSpendEventLike {
  return {
    id: {
      txDigest: "settlement-digest-2",
      eventSeq: "1"
    },
    packageId: PACKAGE,
    transactionModule: "settlement",
    sender: PAYER,
    type: `${PACKAGE}::settlement::BatchSettled<0x2::sui::SUI>`,
    parsedJson: {
      ledger_id: LEDGER,
      merchant: MERCHANT,
      receipt_count: "2",
      total_amount: "3000",
      submitter: PAYER
    },
    timestampMs: "1779215414855"
  };
}

function makeGraphQLSettlementNode(
  eventName: "ReceiptSettled" | "BatchSettled",
  event: SessionSpendEventLike
): Record<string, unknown> {
  return {
    sequenceNumber: event.id?.eventSeq,
    transaction: {
      digest: event.id?.txDigest
    },
    transactionModule: {
      name: "settlement",
      package: {
        address: PACKAGE
      }
    },
    sender: {
      address: event.sender
    },
    contents: {
      type: {
        repr: `${PACKAGE}::settlement::${eventName}<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>`
      },
      json: event.parsedJson
    },
    timestamp: "2026-05-18T18:23:39.460Z"
  };
}

function makeGrpcCheckpoint(): SuiGrpcCheckpointLike {
  return {
    sequenceNumber: 10n,
    transactions: [
      {
        digest: "grpc-digest-1",
        timestamp: {
          seconds: 1779215414n,
          nanos: 854_000_000
        },
        events: {
          events: [
            {
              packageId: PACKAGE,
              module: "other",
              sender: PAYER,
              eventType: `${PACKAGE}::other::OtherEvent`,
              json: protoStruct({})
            },
            makeGrpcEvent({})
          ]
        }
      }
    ]
  };
}

function makeGrpcSettlementCheckpoint(): SuiGrpcCheckpointLike {
  return {
    sequenceNumber: 12n,
    transactions: [
      {
        digest: "grpc-settlement-digest-1",
        timestamp: {
          seconds: 1779215414n,
          nanos: 854_000_000
        },
        events: {
          events: [makeGrpcSettlementEvent("ReceiptSettled"), makeGrpcSettlementEvent("BatchSettled")]
        }
      }
    ]
  };
}

function makeGrpcEvent(input: {
  amount?: string;
  spentTotal?: string;
  resourceScopeHash?: string;
}) {
  return {
    packageId: PACKAGE,
    module: "sessions",
    sender: PAYER,
    eventType: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
    json: protoStruct(makeEventPayload(input))
  };
}

function makeGrpcSettlementEvent(eventName: "ReceiptSettled" | "BatchSettled") {
  const parsed =
    eventName === "ReceiptSettled"
      ? makeSettlementReceiptEvent().parsedJson
      : makeSettlementBatchEvent().parsedJson;
  return {
    packageId: PACKAGE,
    module: "settlement",
    sender: PAYER,
    eventType: `${PACKAGE}::settlement::${eventName}<0x2::sui::SUI>`,
    json: protoStruct(parsed as Record<string, unknown>)
  };
}

function protoStruct(fields: Record<string, unknown>): unknown {
  return {
    kind: {
      oneofKind: "structValue",
      structValue: {
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, protoValue(value)]))
      }
    }
  };
}

function protoValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return {
      kind: {
        oneofKind: "nullValue",
        nullValue: 0
      }
    };
  }

  if (typeof value === "number") {
    return {
      kind: {
        oneofKind: "numberValue",
        numberValue: value
      }
    };
  }

  if (typeof value === "boolean") {
    return {
      kind: {
        oneofKind: "boolValue",
        boolValue: value
      }
    };
  }

  return {
    kind: {
      oneofKind: "stringValue",
      stringValue: String(value)
    }
  };
}

class FakePostgres {
  rows = new Map<string, SessionSpendRecord>();
  cursors = new Map<string, { key: string; cursor?: string; updated_at: string }>();
  queries: string[] = [];

  async query<Row = unknown>(text: string, values: unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.queries.push(text);
    if (text.includes("insert into")) {
      if (text.includes("sui402_indexer_cursors")) {
        const [key, cursor] = values;
        this.cursors.set(String(key), {
          key: String(key),
          cursor: cursor === null || cursor === undefined ? undefined : String(cursor),
          updated_at: "2026-06-03T00:00:00.000Z"
        });
        return { rows: [] };
      }

      const [
        id,
        network,
        packageId,
        coinType,
        txDigest,
        eventSeq,
        sessionId,
        payer,
        merchant,
        amount,
        spentTotal,
        challengeId,
        resourceScopeHash,
        sender,
        timestampMs,
        indexedAt
      ] = values;
      this.rows.set(String(id), {
        id: String(id),
        network: network as SessionSpendRecord["network"],
        packageId: String(packageId),
        coinType: String(coinType),
        txDigest: String(txDigest),
        eventSeq: eventSeq === null || eventSeq === undefined ? undefined : String(eventSeq),
        sessionId: String(sessionId),
        payer: payer === null || payer === undefined ? undefined : String(payer),
        merchant: String(merchant),
        amount: String(amount),
        spentTotal: spentTotal === null || spentTotal === undefined ? undefined : String(spentTotal),
        challengeId: String(challengeId),
        resourceScopeHash: String(resourceScopeHash),
        sender: sender === null || sender === undefined ? undefined : String(sender),
        timestampMs: timestampMs === null || timestampMs === undefined ? undefined : String(timestampMs),
        indexedAt: String(indexedAt)
      });
      return { rows: [] };
    }

    if (text.includes("select")) {
      if (text.includes("from sui402_indexer_cursors")) {
        const row = this.cursors.get(String(values[0]));
        return { rows: row ? ([row] as Row[]) : [] };
      }

      let rows = [...this.rows.values()];
      let valueIndex = 0;
      if (text.includes("lower(session_id)")) {
        const sessionId = String(values[valueIndex]).toLowerCase();
        valueIndex += 1;
        rows = rows.filter((row) => row.sessionId.toLowerCase() === sessionId);
      }

      if (text.includes("lower(payer)")) {
        const payer = String(values[valueIndex]).toLowerCase();
        valueIndex += 1;
        rows = rows.filter((row) => row.payer?.toLowerCase() === payer);
      }

      if (text.includes("lower(merchant)")) {
        const merchant = String(values[valueIndex]).toLowerCase();
        valueIndex += 1;
        rows = rows.filter((row) => row.merchant.toLowerCase() === merchant);
      }

      const limit = Number(values.at(-1) ?? 100);
      return {
        rows: rows
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            network: row.network,
            package_id: row.packageId,
            coin_type: row.coinType,
            tx_digest: row.txDigest,
            event_seq: row.eventSeq,
            session_id: row.sessionId,
            payer: row.payer,
            merchant: row.merchant,
            amount: row.amount,
            spent_total: row.spentTotal,
            challenge_id: row.challengeId,
            resource_scope_hash: row.resourceScopeHash,
            sender: row.sender,
            timestamp_ms: row.timestampMs,
            indexed_at: row.indexedAt
          })) as Row[]
      };
    }

    return { rows: [] };
  }
}

function graphQlResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload)
  };
}

function makeSyncConfig(overrides: Partial<IndexerSyncConfig> = {}): IndexerSyncConfig {
  return {
    command: "sync",
    eventKind: "session-spend",
    sink: "postgres",
    network: "sui:testnet",
    packageId: PACKAGE,
    coinType: "0x2::sui::SUI",
    source: "graphql",
    graphqlUrl: undefined,
    jsonlPath: undefined,
    grpcUrl: undefined,
    grpcStartCheckpoint: undefined,
    grpcMaxCheckpointsPerPage: 10,
    postgresUrl: "postgres://user:pass@localhost:5432/sui402",
    consoleUrl: undefined,
    consoleApiKey: undefined,
    tableName: "sui402_session_spend_events",
    cursorTableName: "sui402_indexer_cursors",
    cursorKey: `${PACKAGE}:0x2::sui::SUI`,
    cursor: undefined,
    pageLimit: 50,
    maxPages: 1,
    setup: false,
    summarize: false,
    loop: false,
    intervalMs: 30000,
    retryInitialMs: 1000,
    retryMaxMs: 60000,
    maxRuns: undefined,
    ...overrides
  };
}
