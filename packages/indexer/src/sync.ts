#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Sui402Network } from "@sui402/protocol";
import {
  ConsoleHttpIndexerCursorStore,
  ConsoleHttpSessionSpendIndexStore,
  ConsoleHttpSettlementIndexStore,
  JsonlSessionSpendEventSource,
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
  type IndexerCursorStore,
  type SettlementIndexStore,
  type SessionSpendIndexStore,
  type SessionSpendEventSource
} from "./index.js";

export type IndexerSyncEventKind = "session-spend" | "settlement";
export type IndexerSyncSink = "postgres" | "console-http";

export type IndexerSyncConfig = {
  command: "sync";
  eventKind: IndexerSyncEventKind;
  source: "graphql" | "jsonl" | "grpc";
  sink: IndexerSyncSink;
  network: Sui402Network;
  packageId: string;
  coinType: string;
  graphqlUrl?: string;
  jsonlPath?: string;
  grpcUrl?: string;
  grpcStartCheckpoint?: string;
  grpcMaxCheckpointsPerPage: number;
  postgresUrl?: string;
  consoleUrl?: string;
  consoleApiKey?: string;
  tableName: string;
  cursorTableName: string;
  cursorKey: string;
  cursor?: string;
  pageLimit: number;
  maxPages: number;
  setup: boolean;
  summarize: boolean;
  loop: boolean;
  intervalMs: number;
  retryInitialMs: number;
  retryMaxMs: number;
  maxRuns?: number;
};

export async function runIndexerSync(config: IndexerSyncConfig): Promise<unknown> {
  if (config.loop) {
    return runIndexerSyncLoop(config);
  }

  return runIndexerSyncOnce(config);
}

export async function runIndexerSyncOnce(config: IndexerSyncConfig): Promise<unknown> {
  const sink = createIndexerSink(config);
  try {
    if (config.eventKind === "settlement") {
      if (config.setup) {
        await sink.setup();
      }
      const savedCursor = config.cursor ? undefined : await sink.cursorStore.getCursor(config.cursorKey);
      const cursor = config.cursor ?? savedCursor?.cursor;

      const source = await createSettlementEventSource(config);
      const result = await indexSettlementEvents({
        source,
        store: sink.settlementEvents,
        network: config.network,
        packageId: config.packageId,
        coinType: config.coinType,
        cursor,
        pageLimit: config.pageLimit,
        maxPages: config.maxPages
      });
      if (result.nextCursor !== undefined) {
        await sink.cursorStore.setCursor(config.cursorKey, result.nextCursor);
      }

      return {
        ok: true,
        eventKind: config.eventKind,
        result,
        cursor: {
          key: config.cursorKey,
          previous: cursor,
          next: result.nextCursor
        },
        settlements: config.summarize ? await sink.settlementEvents.list({ limit: 100 }) : undefined
      };
    }

    if (config.setup) {
      await sink.setup();
    }
    const savedCursor = config.cursor ? undefined : await sink.cursorStore.getCursor(config.cursorKey);
    const cursor = config.cursor ?? savedCursor?.cursor;

    const source = await createSessionSpendEventSource(config);
    const result = await indexSessionSpendEvents({
      source,
      store: sink.sessionSpends,
      network: config.network,
      packageId: config.packageId,
      coinType: config.coinType,
      cursor,
      pageLimit: config.pageLimit,
      maxPages: config.maxPages
    });
    if (result.nextCursor !== undefined) {
      await sink.cursorStore.setCursor(config.cursorKey, result.nextCursor);
    }

    return {
      ok: true,
      eventKind: config.eventKind,
      result,
      cursor: {
        key: config.cursorKey,
        previous: cursor,
        next: result.nextCursor
      },
      summaries: config.summarize
        ? aggregateSessionSpends(await sink.sessionSpends.list({ limit: 100 }))
        : undefined
    };
  } finally {
    await sink.close();
  }
}

type IndexerSink = {
  cursorStore: IndexerCursorStore;
  sessionSpends: SessionSpendIndexStore;
  settlementEvents: SettlementIndexStore;
  setup(): Promise<void>;
  close(): Promise<void>;
};

function createIndexerSink(config: IndexerSyncConfig): IndexerSink {
  if (config.sink === "console-http") {
    const options = {
      baseUrl: readRequired(config.consoleUrl, "console URL"),
      apiKey: config.consoleApiKey
    };
    return {
      cursorStore: new ConsoleHttpIndexerCursorStore(options),
      sessionSpends: new ConsoleHttpSessionSpendIndexStore(options),
      settlementEvents: new ConsoleHttpSettlementIndexStore(options),
      setup: async () => undefined,
      close: async () => undefined
    };
  }

  const pool = new pg.Pool({
    connectionString: readRequired(config.postgresUrl, "Postgres URL")
  });
  const cursorStore = new PostgresIndexerCursorStore({
    client: pool,
    tableName: config.cursorTableName
  });
  const sessionSpends = new PostgresSessionSpendIndexStore({
    client: pool,
    tableName: config.eventKind === "session-spend" ? config.tableName : undefined
  });
  const settlementEvents = new PostgresSettlementIndexStore({
    client: pool,
    tableName: config.eventKind === "settlement" ? config.tableName : undefined
  });

  return {
    cursorStore,
    sessionSpends,
    settlementEvents,
    setup: async () => {
      await cursorStore.setup();
      if (config.eventKind === "settlement") {
        await settlementEvents.setup();
      } else {
        await sessionSpends.setup();
      }
    },
    close: async () => {
      await pool.end();
    }
  };
}

export type IndexerSyncLoopResult = {
  ok: boolean;
  loop: true;
  attempts: number;
  successes: number;
  failures: number;
  lastResult?: unknown;
  lastError?: string;
};

export type IndexerSyncLoopDeps = {
  sleep?: (ms: number) => Promise<void>;
  runOnce?: (config: IndexerSyncConfig) => Promise<unknown>;
};

export async function runIndexerSyncLoop(
  config: IndexerSyncConfig,
  deps: IndexerSyncLoopDeps = {}
): Promise<IndexerSyncLoopResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const runOnce = deps.runOnce ?? runIndexerSyncOnce;
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let lastResult: unknown;
  let lastError: string | undefined;

  while (config.maxRuns === undefined || attempts < config.maxRuns) {
    attempts += 1;
    try {
      lastResult = await runOnce({ ...config, loop: false });
      lastError = undefined;
      successes += 1;
      consecutiveFailures = 0;
      if (config.maxRuns !== undefined && attempts >= config.maxRuns) {
        break;
      }

      await sleep(config.intervalMs);
    } catch (error) {
      failures += 1;
      consecutiveFailures += 1;
      lastError = error instanceof Error ? error.message : String(error);
      if (config.maxRuns !== undefined && attempts >= config.maxRuns) {
        break;
      }

      await sleep(backoffMs(config.retryInitialMs, config.retryMaxMs, consecutiveFailures));
    }
  }

  return {
    ok: failures === 0 || successes > 0,
    loop: true,
    attempts,
    successes,
    failures,
    lastResult,
    lastError
  };
}

export function loadIndexerSyncConfig(env: NodeJS.ProcessEnv = process.env, argv = process.argv.slice(2)): IndexerSyncConfig {
  const args = parseArgs(argv);
  const command = args.command ?? "sync";
  if (command !== "sync") {
    throw new Error(`Unknown sui402-indexer command: ${command}`);
  }
  const eventKind = readEventKind(args.eventKind ?? env.SUI402_INDEXER_EVENT_KIND ?? "session-spend");
  const sink = readSink(args.sink ?? env.SUI402_INDEXER_SINK ?? "postgres");
  const packageId = readRequired(args.packageId ?? env.SUI402_INDEXER_PACKAGE_ID ?? env.SUI402_SESSION_PACKAGE_ID, "package id");
  const coinType = args.coinType ?? env.SUI402_INDEXER_COIN_TYPE ?? env.SUI402_COIN_TYPE ?? "0x2::sui::SUI";
  const postgresUrl = args.postgresUrl ?? env.SUI402_INDEXER_POSTGRES_URL ?? env.SUI402_POSTGRES_URL;
  const consoleUrl = args.consoleUrl ?? env.SUI402_INDEXER_CONSOLE_URL;
  if (sink === "postgres") {
    readRequired(postgresUrl, "Postgres URL");
  } else {
    readRequired(consoleUrl, "console URL");
  }

  return {
    command,
    eventKind,
    sink,
    source: readSource(args.source ?? env.SUI402_INDEXER_SOURCE ?? "graphql"),
    network: readNetwork(args.network ?? env.SUI402_INDEXER_NETWORK ?? env.SUI402_NETWORK ?? "sui:testnet"),
    packageId,
    coinType,
    graphqlUrl: args.graphqlUrl ?? env.SUI402_INDEXER_GRAPHQL_URL,
    jsonlPath: args.jsonlPath ?? env.SUI402_INDEXER_JSONL_PATH,
    grpcUrl: args.grpcUrl ?? env.SUI402_INDEXER_GRPC_URL,
    grpcStartCheckpoint: args.grpcStartCheckpoint ?? env.SUI402_INDEXER_GRPC_START_CHECKPOINT,
    grpcMaxCheckpointsPerPage: readPositiveInteger(
      args.grpcMaxCheckpointsPerPage ?? env.SUI402_INDEXER_GRPC_MAX_CHECKPOINTS_PER_PAGE ?? "10",
      "gRPC max checkpoints per page"
    ),
    postgresUrl,
    consoleUrl,
    consoleApiKey: args.consoleApiKey ?? env.SUI402_INDEXER_CONSOLE_API_KEY,
    tableName: args.tableName ?? env.SUI402_INDEXER_TABLE ?? defaultTableName(eventKind),
    cursorTableName: args.cursorTableName ?? env.SUI402_INDEXER_CURSOR_TABLE ?? "sui402_indexer_cursors",
    cursorKey: args.cursorKey ?? env.SUI402_INDEXER_CURSOR_KEY ?? defaultCursorKey(eventKind, packageId, coinType),
    cursor: args.cursor ?? env.SUI402_INDEXER_CURSOR,
    pageLimit: readPositiveInteger(args.pageLimit ?? env.SUI402_INDEXER_PAGE_LIMIT ?? "50", "page limit"),
    maxPages: readPositiveInteger(args.maxPages ?? env.SUI402_INDEXER_MAX_PAGES ?? "1", "max pages"),
    setup: readBoolean(args.setup ?? env.SUI402_INDEXER_SETUP ?? "false"),
    summarize: readBoolean(args.summarize ?? env.SUI402_INDEXER_SUMMARIZE ?? "false"),
    loop: readBoolean(args.loop ?? env.SUI402_INDEXER_LOOP ?? "false"),
    intervalMs: readPositiveInteger(args.intervalMs ?? env.SUI402_INDEXER_INTERVAL_MS ?? "30000", "interval ms"),
    retryInitialMs: readPositiveInteger(
      args.retryInitialMs ?? env.SUI402_INDEXER_RETRY_INITIAL_MS ?? "1000",
      "retry initial ms"
    ),
    retryMaxMs: readPositiveInteger(args.retryMaxMs ?? env.SUI402_INDEXER_RETRY_MAX_MS ?? "60000", "retry max ms"),
    maxRuns:
      args.maxRuns ?? env.SUI402_INDEXER_MAX_RUNS
        ? readPositiveInteger(args.maxRuns ?? env.SUI402_INDEXER_MAX_RUNS ?? "", "max runs")
        : undefined
  };
}

function parseArgs(argv: string[]): {
  command?: string;
  eventKind?: string;
  source?: string;
  sink?: string;
  network?: string;
  packageId?: string;
  coinType?: string;
  graphqlUrl?: string;
  jsonlPath?: string;
  grpcUrl?: string;
  grpcStartCheckpoint?: string;
  grpcMaxCheckpointsPerPage?: string;
  postgresUrl?: string;
  consoleUrl?: string;
  consoleApiKey?: string;
  tableName?: string;
  cursorTableName?: string;
  cursorKey?: string;
  cursor?: string;
  pageLimit?: string;
  maxPages?: string;
  setup?: string;
  summarize?: string;
  loop?: string;
  intervalMs?: string;
  retryInitialMs?: string;
  retryMaxMs?: string;
  maxRuns?: string;
  help?: string;
} {
  const parsed: ReturnType<typeof parseArgs> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = "true";
      continue;
    }

    if (!arg.startsWith("--") && !parsed.command) {
      parsed.command = arg;
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--event-kind") parsed.eventKind = value;
    else if (arg === "--network") parsed.network = value;
    else if (arg === "--source") parsed.source = value;
    else if (arg === "--sink") parsed.sink = value;
    else if (arg === "--package-id") parsed.packageId = value;
    else if (arg === "--coin-type") parsed.coinType = value;
    else if (arg === "--graphql-url") parsed.graphqlUrl = value;
    else if (arg === "--jsonl-path") parsed.jsonlPath = value;
    else if (arg === "--grpc-url") parsed.grpcUrl = value;
    else if (arg === "--grpc-start-checkpoint") parsed.grpcStartCheckpoint = value;
    else if (arg === "--grpc-max-checkpoints-per-page") parsed.grpcMaxCheckpointsPerPage = value;
    else if (arg === "--postgres-url") parsed.postgresUrl = value;
    else if (arg === "--console-url") parsed.consoleUrl = value;
    else if (arg === "--console-api-key") parsed.consoleApiKey = value;
    else if (arg === "--table") parsed.tableName = value;
    else if (arg === "--cursor-table") parsed.cursorTableName = value;
    else if (arg === "--cursor-key") parsed.cursorKey = value;
    else if (arg === "--cursor") parsed.cursor = value;
    else if (arg === "--page-limit") parsed.pageLimit = value;
    else if (arg === "--max-pages") parsed.maxPages = value;
    else if (arg === "--setup") parsed.setup = value;
    else if (arg === "--summarize") parsed.summarize = value;
    else if (arg === "--loop") parsed.loop = value;
    else if (arg === "--interval-ms") parsed.intervalMs = value;
    else if (arg === "--retry-initial-ms") parsed.retryInitialMs = value;
    else if (arg === "--retry-max-ms") parsed.retryMaxMs = value;
    else if (arg === "--max-runs") parsed.maxRuns = value;
    else throw new Error(`Unknown argument ${arg}`);
    index += 1;
  }

  return parsed;
}

function readRequired(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required ${name}`);
  }

  return value;
}

function readNetwork(value: string): Sui402Network {
  if (value === "sui:mainnet" || value === "sui:testnet" || value === "sui:devnet" || value === "sui:localnet") {
    return value;
  }

  throw new Error(`Unsupported Sui402 network: ${value}`);
}

function readSource(value: string): IndexerSyncConfig["source"] {
  if (value === "graphql" || value === "jsonl" || value === "grpc") {
    return value;
  }

  throw new Error(`Unsupported indexer source: ${value}`);
}

function readSink(value: string): IndexerSyncSink {
  if (value === "postgres" || value === "console-http") {
    return value;
  }

  throw new Error(`Unsupported indexer sink: ${value}`);
}

function readEventKind(value: string): IndexerSyncEventKind {
  if (value === "session-spend" || value === "settlement") {
    return value;
  }

  throw new Error(`Unsupported indexer event kind: ${value}`);
}

function defaultTableName(eventKind: IndexerSyncEventKind): string {
  return eventKind === "settlement" ? "sui402_settlement_events" : "sui402_session_spend_events";
}

function defaultCursorKey(eventKind: IndexerSyncEventKind, packageId: string, coinType: string): string {
  const base = `${packageId}:${coinType}`;
  return eventKind === "settlement" ? `settlement:${base}` : base;
}

async function createSessionSpendEventSource(config: IndexerSyncConfig): Promise<SessionSpendEventSource> {
  if (config.source === "jsonl") {
    const jsonlPath = readRequired(config.jsonlPath, "JSONL path");
    return new JsonlSessionSpendEventSource({
      lines: () => readJsonlLines(jsonlPath)
    });
  }

  if (config.source === "grpc") {
    const { SuiGrpcClient } = await import("@mysten/sui/grpc");
    const client = new SuiGrpcClient({
      network: grpcNetworkForSui402Network(config.network),
      baseUrl: config.grpcUrl ?? grpcUrlForNetwork(config.network)
    });
    return new SuiGrpcCheckpointSessionSpendEventSource({
      client,
      packageId: config.packageId,
      coinType: config.coinType,
      startCheckpoint: config.grpcStartCheckpoint ?? (await readGrpcLowestAvailableCheckpoint(client)),
      maxCheckpointsPerPage: config.grpcMaxCheckpointsPerPage
    });
  }

  return new SuiGraphQLSessionSpendEventSource({
    network: config.network,
    url: config.graphqlUrl,
    packageId: config.packageId,
    coinType: config.coinType
  });
}

async function createSettlementEventSource(config: IndexerSyncConfig): Promise<SessionSpendEventSource> {
  if (config.source === "jsonl") {
    const jsonlPath = readRequired(config.jsonlPath, "JSONL path");
    return new JsonlSessionSpendEventSource({
      lines: () => readJsonlLines(jsonlPath)
    });
  }

  if (config.source === "grpc") {
    const { SuiGrpcClient } = await import("@mysten/sui/grpc");
    const client = new SuiGrpcClient({
      network: grpcNetworkForSui402Network(config.network),
      baseUrl: config.grpcUrl ?? grpcUrlForNetwork(config.network)
    });
    return new SuiGrpcCheckpointSettlementEventSource({
      client,
      packageId: config.packageId,
      coinType: config.coinType,
      startCheckpoint: config.grpcStartCheckpoint ?? (await readGrpcLowestAvailableCheckpoint(client)),
      maxCheckpointsPerPage: config.grpcMaxCheckpointsPerPage
    });
  }

  return new SuiGraphQLSettlementEventSource({
    network: config.network,
    url: config.graphqlUrl,
    packageId: config.packageId,
    coinType: config.coinType
  });
}

function grpcNetworkForSui402Network(network: Sui402Network): "mainnet" | "testnet" | "devnet" | "localnet" {
  switch (network) {
    case "sui:mainnet":
      return "mainnet";
    case "sui:testnet":
      return "testnet";
    case "sui:devnet":
      return "devnet";
    case "sui:localnet":
      return "localnet";
  }
}

function grpcUrlForNetwork(network: Sui402Network): string {
  switch (network) {
    case "sui:mainnet":
      return "https://fullnode.mainnet.sui.io:443";
    case "sui:testnet":
      return "https://fullnode.testnet.sui.io:443";
    case "sui:devnet":
      return "https://fullnode.devnet.sui.io:443";
    case "sui:localnet":
      return "http://127.0.0.1:9000";
  }
}

async function readGrpcLowestAvailableCheckpoint(client: {
  ledgerService: { getServiceInfo(input: object): unknown };
}): Promise<string> {
  const response = await readServiceInfoResponse(client.ledgerService.getServiceInfo({}));
  const serviceInfo = response as { lowestAvailableCheckpoint?: bigint | number | string };
  return serviceInfo.lowestAvailableCheckpoint === undefined ? "0" : String(serviceInfo.lowestAvailableCheckpoint);
}

async function readServiceInfoResponse(call: unknown): Promise<unknown> {
  const awaited = await (call as PromiseLike<{ response: unknown }> | { response: unknown });
  return awaited.response;
}

function readJsonlLines(path: string): AsyncIterable<string> {
  return createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readBoolean(value: string): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function backoffMs(initialMs: number, maxMs: number, consecutiveFailures: number): number {
  return Math.min(maxMs, initialMs * 2 ** Math.max(0, consecutiveFailures - 1));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`sui402-indexer sync --package-id <0x...> --postgres-url <postgres://...>

Options:
  --event-kind <kind>         session-spend or settlement, default session-spend
  --network <network>          default sui:testnet
  --source <source>            graphql, jsonl, or grpc, default graphql
  --package-id <id>            Sui402 package id
  --coin-type <coinType>       default 0x2::sui::SUI
  --graphql-url <url>          override Sui GraphQL endpoint
  --jsonl-path <path>          append-only normalized event JSONL source
  --grpc-url <url>             override Sui gRPC endpoint
  --grpc-start-checkpoint <n>  starting checkpoint for gRPC source; defaults to fullnode lowest available
  --grpc-max-checkpoints-per-page <n>
                              max checkpoints scanned per sync page, default 10
  --postgres-url <url>         Postgres connection string
  --table <name>               default sui402_session_spend_events or sui402_settlement_events
  --cursor-table <name>        default sui402_indexer_cursors
  --cursor-key <key>           default <packageId>:<coinType> or settlement:<packageId>:<coinType>
  --cursor <cursor>            starting GraphQL cursor
  --page-limit <n>             default 50
  --max-pages <n>              default 1
  --setup true                 create table/indexes before sync
  --summarize true             include aggregate session summaries in output
  --loop true                  run continuously until stopped
  --interval-ms <n>            delay after successful sync, default 30000
  --retry-initial-ms <n>       first retry delay after failure, default 1000
  --retry-max-ms <n>           maximum retry delay, default 60000
  --max-runs <n>               stop after n attempts, mainly for tests/jobs
`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  try {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      printHelp();
      process.exit(0);
    }

    const result = await runIndexerSync(loadIndexerSyncConfig());
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
