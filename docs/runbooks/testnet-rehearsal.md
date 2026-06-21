# Testnet Production Rehearsal Runbook

Owner: Sui402 operators  
Severity tier: pre-mainnet release gate  
Last updated: 2026-06-07

This runbook proves the current Sui402 stack as one system on Sui Testnet:

- console gateway issues paid challenges
- agent/client pays with a Sui session
- console file storage records verified payments and signed receipts
- settlement ledger records receipt settlement on-chain
- indexer ingests settlement events
- console API reports receipt-level reconciliation
- dashboard shows operator settlement status
- optional Walrus export stores payment/receipt evidence

Real talk: this is not a mainnet launch by itself. It is the rehearsal that tells
us whether the components work together before we spend money on audits,
deployment hardening, and cloud infra.

## Dependencies

- Node.js 22+
- npm
- Sui CLI configured for `testnet`
- testnet SUI gas on the active Sui address
- this repository built locally
- optional: Redis/Postgres once Docker is available
- optional: Walrus publisher/aggregator endpoint

## Preflight

From `F:\Downloads\sui-hack`:

```powershell
Copy-Item .env.testnet-rehearsal.example .env.testnet-rehearsal -ErrorAction SilentlyContinue
notepad .env.testnet-rehearsal
.\scripts\load-env.ps1 .env.testnet-rehearsal
npm run rehearsal:check
```

You can also have the preflight load the file directly, while still letting
already-set shell variables override it:

```powershell
npm run rehearsal:check -- --env-file .env.testnet-rehearsal
```

Start the dated evidence note before running transactions. The generator fills
in current env, Sui CLI, active address, Published.toml package metadata, and
any existing file-backed console records it can read. It deliberately leaves
transaction-specific fields as `TODO` until the run produces them:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal
```

By default this creates
`docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md`. Use `--out <path>`
to place the note somewhere else, `--force` to refresh the same file, or
`--stdout` to preview without writing.

Verify the Sui network manually before any transaction:

```powershell
sui client active-env
sui client active-address
sui client balance
```

Expected:

- active env is `testnet`
- active address has testnet SUI
- `SUI402_SESSION_PACKAGE_ID` points to the current testnet package in
  `docs/deployments.md`

If gas is missing, use the Testnet faucet shown by Sui CLI or the web faucet.

Generate a receipt signer for the rehearsal. For settlement reconciliation, the
receipt signer id must be a Sui address, so use the merchant address as the
signer id:

```powershell
$env:SUI402_RECEIPT_SIGNER_ID=$env:SUI402_MERCHANT_ADDRESS
npm run receipt:key
```

Paste the returned `SUI402_RECEIPT_SIGNER_ID` and
`SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64` values into `.env.testnet-rehearsal`,
then reload:

```powershell
.\scripts\load-env.ps1 .env.testnet-rehearsal
```

## Terminal 1: Console API

Use file storage for the first rehearsal. It avoids Docker while still preserving
local payment and receipt records across restarts.

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
$env:SUI402_CONSOLE_STORAGE_DRIVER="file"
npm run dev:console-api
```

Health check from another terminal:

```powershell
Invoke-WebRequest http://127.0.0.1:4030/health/live -UseBasicParsing
```

Pass criteria:

- console starts without storage/signing errors
- health endpoint returns `200`
- `/gateway/merchants/atlas-api/.well-known/sui402` reports the testnet package

Optional provider API smoke test:

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
$env:PORT="4025"
npm run dev:provider
```

## Terminal 2: Dashboard

```powershell
cd F:\Downloads\sui-hack
$env:VITE_SUI402_CONSOLE_API_URL="http://127.0.0.1:4030"
npm run dev:dashboard
```

Open the printed dashboard URL. Confirm:

- overview KPIs render
- settlement panel renders
- reconciliation strip shows settled/unsettled/exception counts
- audit panel renders without authorization errors in local mode

## Step 1: Run A Session Payment

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
npm run session:demo
```

Capture:

- `sessionId`
- open transaction digest if a new session was created
- spend transaction digest
- HTTP retry response

Refresh or fill the evidence note:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal --force
```

Pass criteria:

- first request receives a `402` challenge
- client opens/reuses a session
- client spends against the session on Sui Testnet
- retry returns `200`
- console payment ledger contains a signed receipt

Useful checks:

```powershell
Invoke-WebRequest "http://127.0.0.1:4030/v1/settlements?limit=20" -UseBasicParsing
Invoke-WebRequest "http://127.0.0.1:4030/v1/settlement-reconciliation?limit=20" -UseBasicParsing
```

At this point the receipt should usually be `unsettled`, because it has not been
submitted to the settlement ledger yet.

## Step 2: Create A Settlement Ledger

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
npm run settlement:create-ledger
```

Capture:

- ledger object id
- create-ledger transaction digest

Update `.env.testnet-rehearsal`:

```powershell
SUI402_SETTLEMENT_LEDGER_ID=0x...
```

Reload env:

```powershell
.\scripts\load-env.ps1 .env.testnet-rehearsal
```

Refresh the evidence note and paste the create-ledger transaction digest where
marked:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal --force
```

## Step 3: Settle A Receipt

Export the latest signed receipt from the file-backed console store as
PowerShell env assignments:

```powershell
npm run rehearsal:receipt-env
```

Run the printed `$env:...` assignments in the same terminal, then settle:

```powershell
npm run settlement:settle-receipt
```

Capture:

- settlement transaction digest
- settled receipt id

Refresh the evidence note. If the console file store contains the indexed
settlement event, the generator will prefill the settlement tx, ledger id, and
receipt id; otherwise paste them manually:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal --force
```

Pass criteria:

- transaction succeeds
- duplicate settlement for the same receipt aborts
- `npm run settlement:inspect-ledger` shows updated receipt count/total

## Step 4: Run Settlement Indexer

The preferred Dockerless rehearsal path is direct Sui gRPC indexing through the
console HTTP sink. Set the start checkpoint to the checkpoint containing the
settlement transaction, or a slightly earlier checkpoint:

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
$env:SUI402_INDEXER_EVENT_KIND="settlement"
$env:SUI402_INDEXER_SOURCE="grpc"
$env:SUI402_INDEXER_SINK="console-http"
$env:SUI402_INDEXER_PACKAGE_ID=$env:SUI402_SETTLEMENT_PACKAGE_ID
$env:SUI402_INDEXER_CONSOLE_URL="http://127.0.0.1:4030"
$env:SUI402_INDEXER_GRPC_START_CHECKPOINT="..."
npm run indexer:sync -- --max-pages 5 --grpc-max-checkpoints-per-page 25
```

When the console runs in production mode, set
`SUI402_INDEXER_CONSOLE_API_KEY` to a role-scoped operator key with the
`indexer` role.

With Postgres available, the indexer can instead write directly:

```powershell
$env:SUI402_INDEXER_SINK="postgres"
$env:SUI402_INDEXER_POSTGRES_URL=$env:SUI402_CONSOLE_POSTGRES_URL
npm run indexer:sync -- --setup true --max-pages 5
```

`npm run rehearsal:ingest-settlement` remains an emergency one-transaction
recovery tool, not the normal indexing path.

Pass criteria:

- `GET /v1/indexer/settlement-events` lists the receipt event
- `GET /v1/indexer/cursors/<encoded-cursor-key>` shows the durable gRPC cursor
- `GET /v1/settlement-reconciliation` moves the receipt from `unsettled` to
  `settled`
- dashboard reconciliation strip reflects the change
- `npm run scan:agreement:check -- --url http://127.0.0.1:4030` reports that
  public scan JSON and `sui402-pay scan stats --json` agree.

Refresh the evidence note after the indexer run so it can pick up cursor and
settlement-event records from the file-backed console store:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal --force
npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md
npm run scan:agreement:check -- --url http://127.0.0.1:4030
```

## Step 5: Export Evidence To Walrus

This step is optional until a Walrus publisher is configured.

```powershell
cd F:\Downloads\sui-hack
.\scripts\load-env.ps1 .env.testnet-rehearsal
Invoke-WebRequest "http://127.0.0.1:4030/v1/exports/payment-ledger/walrus" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"limit":100}'

Invoke-WebRequest "http://127.0.0.1:4030/v1/exports/receipts/walrus" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"limit":100}'
```

Capture:

- payment ledger blob id
- receipt bundle blob id
- object id if returned by the publisher

Refresh the evidence note after export. The generator will prefill blob ids when
the export records are present in the file-backed console store:

```powershell
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal --force
npm run rehearsal:evidence:check -- --file docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md --require-walrus
```

Pass criteria:

- console export history includes both exports
- receipt bundle payload contains the settled receipt
- export blob ids are referenced in settlement summary context

## Evidence Checklist

Save these in the generated dated rehearsal note, then link or summarize it from
`docs/deployments.md`:

- Sui CLI version
- active Sui address
- package id
- provider port/base URL
- console port/base URL
- session id
- session open/spend/close digests
- receipt id
- settlement ledger id
- settlement transaction digest
- indexer cursor/result
- reconciliation summary before and after settlement
- Walrus blob ids, if used
- failures and fixes

## Rollback And Cleanup

Stop local services with `Ctrl+C`.

For file storage rehearsals:

```powershell
Remove-Item .sui402\testnet-rehearsal-console-store.json -ErrorAction SilentlyContinue
```

Do not delete `move/sui402_sessions/Published.toml`; it records package metadata
for the active testnet deployment.

If a bad package is published to Testnet, publish a new package and update:

- `.env.testnet-rehearsal`
- `docs/deployments.md`
- provider/console deployment env
- dashboard notes

## Common Failures

| Symptom | Likely Cause | First Response |
| --- | --- | --- |
| `rehearsal:check` fails active env | Sui CLI is not on Testnet | `sui client switch --env testnet` |
| Sui CLI panics about unsupported protocol version | local Sui CLI is older than Testnet | `suiup status`, then `suiup install sui@testnet-v...` and `suiup switch sui@testnet-v...` |
| payment tx fails for gas | active address has no Testnet SUI | request faucet funds |
| provider refuses production start | missing Redis/Postgres in production mode | run local rehearsal in development/file mode or configure durable stores |
| receipt export says signer is not a Sui address | receipt signer id was a key label, not an address | set `SUI402_RECEIPT_SIGNER_ID=$env:SUI402_MERCHANT_ADDRESS`, restart console, and issue a fresh payment |
| settlement duplicate aborts | same receipt already settled | expected replay protection; use a new receipt |
| reconciliation stays unsettled | settlement event not indexed or receipt id mismatch | inspect `/v1/indexer/settlement-events` and receipt id |
| Walrus export returns 400 | publisher URL missing or no receipts | set publisher URL and confirm provider issued signed receipts |

## Release Gate

Do not call this mainnet-ready until all are true:

- this runbook passes twice on Testnet from a clean local store
- the same flow passes with Redis/Postgres storage
- settlement event sync uses direct gRPC/Postgres, not manual HTTP ingestion
- KMS/external signer path is smoke-tested
- reconciliation report has zero unexpected exceptions
- all evidence is linked in `docs/deployments.md`
