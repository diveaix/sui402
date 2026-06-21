# Session Indexer

`@sui402/indexer` is the foundation for full session analytics.

It provides the stable core pieces that GraphQL RPC, direct Sui gRPC checkpoint
scanning, gRPC sidecars, and custom Sui indexer pipelines can plug into:

- `normalizeSessionSpendEvent` for Sui `SessionSpent<T>` event payloads.
- `indexSessionSpendEvents` for page-based source ingestion.
- `MemorySessionSpendIndexStore` for local tests and prototypes.
- `PostgresSessionSpendIndexStore` for durable indexed session spend events.
- `PostgresIndexerCursorStore` for durable sync cursors.
- `SuiGraphQLSessionSpendEventSource` for Sui GraphQL RPC event pagination.
- `SuiGrpcCheckpointSessionSpendEventSource` for direct Sui gRPC checkpoint
  scanning.
- `SuiGraphQLSettlementEventSource` and
  `SuiGrpcCheckpointSettlementEventSource` for `ReceiptSettled<T>` and
  `BatchSettled<T>` reconciliation.
- `JsonlSessionSpendEventSource` for append-only custom-indexer/gRPC sidecar
  ingestion.
- `aggregateSessionSpends` for session-level spend summaries.
- Console API ingestion and reporting through `/v1/indexer/session-spends`
  and `/v1/indexer/sessions`.
- Postgres-backed hosted console storage for indexed session spend records.
- `sui402-indexer sync --loop true` for continuous unattended sync with
  retry/backoff.
- `sui402-indexer sync --event-kind settlement` for standalone settlement
  receipt/batch indexing into `sui402_settlement_events`.

The package intentionally avoids adding new JSON-RPC reads. Sui JSON-RPC is
deprecated. GraphQL is useful for dashboard/history sync. Direct gRPC checkpoint
scanning is useful for operators who want to read from full nodes without
GraphQL. The JSONL source is intended for production workers that already
consume Sui through gRPC or a custom indexer and need a stable way to feed
normalized events into Sui402.

## Shape

```ts
import {
  MemorySessionSpendIndexStore,
  aggregateSessionSpends,
  indexSessionSpendEvents
} from "@sui402/indexer";

const store = new MemorySessionSpendIndexStore();

await indexSessionSpendEvents({
  store,
  network: "sui:testnet",
  packageId: "0x...",
  source: graphQlOrJsonlSource
});

const summaries = aggregateSessionSpends(await store.list());
```

## Console API Integration

`@sui402/console-api` can store and serve normalized session spend records.
This lets the dashboard distinguish provider-verified session payments from
chain-observed `SessionSpent<T>` events.

Routes:

- `GET /v1/indexer/session-spends`
- `GET /v1/indexer/sessions`
- `POST /v1/indexer/session-spends`

The routes support `sessionId`, `payer`, `merchant`, and `limit` filters.
Production writes require a console operator key with the `indexer` or `admin`
role.

## Postgres Store

```ts
import { PostgresSessionSpendIndexStore } from "@sui402/indexer";

const store = new PostgresSessionSpendIndexStore({
  client: pgPool,
  tableName: "sui402_session_spend_events"
});

await store.setup();
await store.upsert(record);

const recent = await store.list({
  sessionId: "0x...",
  limit: 50
});
```

The setup helper creates:

- primary key on indexed event `id`
- unique index on `network + tx_digest + event_seq`
- lookup indexes for `tx_digest`, `session_id`, `payer`, `merchant`,
  `package_id`, and descending `timestamp_ms`

## Cursor Store

```ts
import { PostgresIndexerCursorStore } from "@sui402/indexer";

const cursors = new PostgresIndexerCursorStore({
  client: pgPool,
  tableName: "sui402_indexer_cursors"
});

await cursors.setup();
await cursors.setCursor("sessions:0xpackage:0x2::sui::SUI", "cursor...");
```

The sync runner uses this store automatically. If `--cursor` is omitted, it
loads the saved cursor for `--cursor-key`; when the selected source returns a
next cursor, the runner stores it.

## GraphQL Source

```ts
import { SuiGraphQLSessionSpendEventSource } from "@sui402/indexer";

const source = new SuiGraphQLSessionSpendEventSource({
  network: "sui:testnet",
  packageId: "0x...",
  coinType: "0x2::sui::SUI"
});
```

By default, the source queries:

- `https://graphql.mainnet.sui.io/graphql`
- `https://graphql.testnet.sui.io/graphql`
- `https://graphql.devnet.sui.io/graphql`

for `SessionSpent<T>` events using cursor pagination.

The default query shape was verified against the public Sui testnet GraphQL
endpoint using the published Sui402 session package. It filters events with
`filter: { type: $eventType }`, reads the digest from `transaction.digest`, the
event sequence from `sequenceNumber`, the module/package from
`transactionModule`, and the Move payload from `contents.json`.

Sui GraphQL returns fully expanded package addresses inside Move type strings,
for example `0x000...0002::sui::SUI`; the indexer normalizes those addresses
back to compact form such as `0x2::sui::SUI` before coin-type comparison and
record storage. GraphQL `DateTime` timestamps are normalized to millisecond
strings.

## Direct gRPC Source

`SuiGrpcCheckpointSessionSpendEventSource` scans checkpoints and extracts
`SessionSpent<T>` events from transaction event payloads.
`SuiGrpcCheckpointSettlementEventSource` uses the same checkpoint-offset cursor
model for `ReceiptSettled<T>` and `BatchSettled<T>`. Both accept structural
clients, so you can pass a real `SuiGrpcClient` from `@mysten/sui/grpc` without
forcing the core mapper to depend on a specific transport implementation.

```ts
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGrpcCheckpointSessionSpendEventSource } from "@sui402/indexer";

const grpcClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443"
});

const source = new SuiGrpcCheckpointSessionSpendEventSource({
  client: grpcClient,
  packageId: "0x...",
  coinType: "0x2::sui::SUI",
  startCheckpoint: "0",
  maxCheckpointsPerPage: 10
});
```

CLI usage:

```powershell
$env:SUI402_INDEXER_SOURCE="grpc"
$env:SUI402_INDEXER_PACKAGE_ID="0x..."
$env:SUI402_INDEXER_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
npm run indexer:sync -- --setup true --grpc-max-checkpoints-per-page 25
```

The gRPC source uses `checkpoint:eventOffset` cursors. This prevents events from
being skipped when a sync page ends partway through a checkpoint. The CLI uses
the public fullnode gRPC URL for the selected network by default, and
`SUI402_INDEXER_GRPC_URL` or `--grpc-url` can override it. If no
`SUI402_INDEXER_GRPC_START_CHECKPOINT` or `--grpc-start-checkpoint` is set, the
CLI starts from the fullnode's `lowestAvailableCheckpoint`; public fullnodes
usually prune older checkpoints.

## Custom JSONL Source

For production ingestion beyond hosted GraphQL, run your own Sui gRPC/custom
indexer worker and emit append-only JSONL. Each non-empty line can be either a
`SessionSpendEventLike` object or an envelope with an `event` field:

```json
{"txDigest":"...","eventSeq":0,"packageId":"0x...","transactionModule":"sessions","sender":"0x...","type":"0x...::sessions::SessionSpent<0x2::sui::SUI>","parsedJson":{"session_id":"0x...","payer":"0x...","merchant":"0x...","amount":"1000","spent_total":"1000","challenge_id":"...","resource_scope_hash":"..."},"timestampMs":"1779215414854"}
```

Snake-case aliases are also accepted, including `tx_digest`, `event_seq`,
`package_id`, `transaction_module`, `event_type`, `parsed_json`, and
`timestamp_ms`. The mapper also accepts `json` for the Move payload.

Library usage:

```ts
import { JsonlSessionSpendEventSource } from "@sui402/indexer";

const source = new JsonlSessionSpendEventSource({
  lines: () => readLinesFromYourIndexerOutput()
});
```

CLI usage:

```powershell
$env:SUI402_INDEXER_SOURCE="jsonl"
$env:SUI402_INDEXER_JSONL_PATH="F:\path\to\session-spends.jsonl"
$env:SUI402_INDEXER_PACKAGE_ID="0x..."
$env:SUI402_INDEXER_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
npm run indexer:sync -- --setup true
```

JSONL cursors are event offsets, not byte offsets or physical line numbers.
Blank lines are ignored. Treat the source file as append-only so durable cursor
resumes stay deterministic.

The JSONL source is event-shape generic even though the class name is still
`JsonlSessionSpendEventSource` for backwards compatibility. When the sync runner
uses `--event-kind settlement`, each JSONL line is normalized as a settlement
event and written to the settlement table instead.

## Sync Runner

The runner supports two durable sinks:

- `postgres`: writes records and cursor state directly to Postgres.
- `console-http`: writes through the authenticated console indexer API. The
  console persists both records and cursor state using its configured memory,
  file, or Postgres storage driver.

Direct Postgres:

```powershell
$env:SUI402_INDEXER_PACKAGE_ID="0x..."
$env:SUI402_INDEXER_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
npm run indexer:sync -- --setup true --max-pages 5
```

Console HTTP:

```powershell
$env:SUI402_INDEXER_PACKAGE_ID="0x..."
$env:SUI402_INDEXER_SINK="console-http"
$env:SUI402_INDEXER_CONSOLE_URL="http://127.0.0.1:4030"
$env:SUI402_INDEXER_CONSOLE_API_KEY="role-scoped-indexer-key"
npm run indexer:sync:console -- --max-pages 5
```

`SUI402_INDEXER_CONSOLE_API_KEY` is optional only when the console is running
without auth in development or test mode. In production, use an operator key
with the `indexer` role. The console HTTP sink is useful for a single-node file
rehearsal and for deployments where the indexer must not receive direct database
credentials. Direct Postgres remains the higher-throughput sink.

The runner prints a JSON result:

```json
{
  "ok": true,
  "result": {
    "processed": 12,
    "skipped": 0,
    "nextCursor": "...",
    "hasNextPage": true
  }
}
```

Set `SUI402_INDEXER_CURSOR` or pass `--cursor` to resume from a saved source
cursor manually. GraphQL cursors are opaque GraphQL cursors; gRPC cursors are
`checkpoint:eventOffset`; JSONL cursors are event offsets. Otherwise, the runner
uses the durable cursor table.

To sync settlement events instead of session spend events:

```powershell
$env:SUI402_INDEXER_EVENT_KIND="settlement"
$env:SUI402_INDEXER_SOURCE="grpc"
$env:SUI402_INDEXER_PACKAGE_ID="0x..."
$env:SUI402_INDEXER_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
npm run indexer:sync -- --setup true --grpc-max-checkpoints-per-page 25
```

Settlement mode defaults to table `sui402_settlement_events` and cursor key
`settlement:<packageId>:<coinType>`. GraphQL settlement mode tracks
`ReceiptSettled<T>` and `BatchSettled<T>` with separate internal cursors encoded
inside one durable cursor value.

For unattended operation:

```powershell
$env:SUI402_INDEXER_LOOP="true"
$env:SUI402_INDEXER_INTERVAL_MS="30000"
$env:SUI402_INDEXER_RETRY_INITIAL_MS="1000"
$env:SUI402_INDEXER_RETRY_MAX_MS="60000"
npm run indexer:sync -- --setup true
```

`--loop true` reruns sync after each successful pass. Failures retry with
exponential backoff capped by `--retry-max-ms`. `--max-runs` can stop the loop
after a fixed number of attempts for batch jobs or tests.

## Next Adapters

- Live gRPC + Postgres integration test once Docker/Postgres is available.
- Hosted deployment packaging for running the sync loop as a supervised worker.
