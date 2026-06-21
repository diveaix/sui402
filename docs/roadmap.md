# Sui402 Build Phases

## Phase 1: Production One-Shot Payments

Status: production certification gate built and passing locally.

Built:

- HTTP `402 Payment Required` challenge format.
- One-shot payment proof format.
- Express middleware.
- Client SDK that pays and retries.
- Sui verifier that checks digest, success, recipient, amount, and coin type.
- gRPC Core API migration for verifier, session discovery, client/server
  surfaces, and operator CLI, with configurable production gRPC endpoints.
- In-memory challenge store and payment record store.
- Redis challenge store and Postgres payment ledger adapters.
- Generic coin transaction helper for SUI and non-SUI coin object payments.
- USDC/non-SUI coin object selection helper for agent clients.
- Production provider API and MCP payment wrapper.
- Mainnet/testnet seller configuration docs.
- Real testnet wallet example documented from local Sui CLI state.
- Docker-backed production certification command covering Redis/Postgres health,
  TypeScript checks, unit tests, live storage integration, Postgres-backed
  indexer integration, Postgres-backed console integration, production build,
  and Sui Move build/test.

## Phase 2: Sui-Native Payment Sessions

Status: testnet package published + SDK transaction builders.

Built:

- `AgentPaymentSession<T>` Move package draft.
- Session open, fund, spend, revoke, and close entry functions.
- `SessionSpent<T>` event.
- TypeScript builders for open, fund, spend, and close transactions.
- Server/MCP proof path for session spend proofs.
- Client session payment handler.
- Provider-side observed session index derived from verified session payment
  records.
- `@sui402/indexer` package for session spend event normalization, source/store
  abstraction, memory indexing, and session-spend aggregation.
- Durable `PostgresSessionSpendIndexStore` for indexed session spend events.
- GraphQL RPC `SessionSpent<T>` event source and `sui402-indexer` sync runner.
- Durable `PostgresIndexerCursorStore` for resumable GraphQL sync.
- Continuous `sui402-indexer` loop mode with retry/backoff and bounded
  `--max-runs` support for jobs/tests.
- Live-verified Sui GraphQL event query shape against the public testnet
  endpoint, including Move type address and timestamp normalization.
- Direct Sui gRPC checkpoint source for scanning `SessionSpent<T>` events from
  fullnode checkpoint transaction payloads.
- Custom-indexer JSONL source for append-only normalized `SessionSpent<T>`
  event ingestion from Sui gRPC sidecars or custom indexing pipelines.
- Settlement event normalization and durable stores for `ReceiptSettled<T>` and
  `BatchSettled<T>` records, including in-memory and Postgres-backed indexes.
- `sui402-indexer sync --source grpc|jsonl` support with durable
  checkpoint/event-offset cursors.
- `sui402-indexer sync --event-kind settlement` support across GraphQL, direct
  gRPC checkpoint scanning, and JSONL sources for settlement reconciliation.
- Console API routes for indexed session spend ingestion, filtered listing, and
  session-level aggregation.
- Console API routes for trusted settlement-event ingestion and filtered
  ledger/merchant/submitter listing.
- Console API receipt-level settlement reconciliation comparing signed payment
  receipts against indexed `ReceiptSettled<T>` events.
- Dashboard KPI support for chain-indexed sessions and indexed spend counts.

Still required before mainnet production claims:

- Add integration tests on testnet.
- Add live gRPC/Postgres integration tests for full chain session indexing
  beyond provider-observed payment activity.

## Phase 3: Agent Wallet and Budget UX

Goal:

- Fund an agent.
- Create a session policy.
- Show active sessions.
- Pause/revoke sessions.
- Show spend history.

Built:

- Reusable `@sui402/policy` spending policy package.
- Policy checks for network, merchant, coin type, resource scope, amount, expiry,
  and payment kind.
- Client-side guarded payment handler that rejects blocked challenges before
  invoking the signer.
- Provider manifest policy preflight support.
- Server-side payment policy enforcement in `requireSuiPayment`.
- Hosted gateway merchant `paymentPolicy` enforcement before challenge consume,
  ledger record, receipt issue, or access grant.

## Phase 4: Paid MCP/API Marketplace

Goal:

- Seller onboarding.
- Tool/API listing.
- Pricing metadata.
- MCP server URL registration.
- Paid tool discovery for agents.

Built:

- `@sui402/registry` package with normalized paid API/MCP listing schema.
- Listing creation from provider discovery manifests.
- Registry store interface and local memory store.
- Express registry router for listing search, lookup, and authenticated upserts.
- Multi-tool paid MCP stdio server configuration through
  `SUI402_MCP_TOOLS_JSON`, with per-tool price, coin type, resource scope, and
  response payloads.

## Phase 5: Hosted Gateway

Goal:

- Hosted challenge issuance.
- Hosted verification.
- Hosted replay protection.
- Seller dashboard.
- Payment logs and settlement views.

Built:

- `@sui402/gateway` package for hosted multi-merchant payment routing.
- Merchant config schema and merchant store interface.
- Hosted provider manifests per merchant.
- Hosted paid endpoint that issues challenges, verifies proofs, and records
  payments through shared storage interfaces.
- Protected admin merchant creation/listing routes.
- `@sui402/dashboard` hosted console frontend shell for merchant operations.
- `@sui402/console-api` backend API composing gateway merchants, registry
  listings, payment summaries, readiness state, and dashboard merchant actions.
- Dashboard live-data wiring through `@sui402/console-api` using
  `VITE_SUI402_CONSOLE_API_URL`, with local seeded fallback when no API is
  configured.
- File-backed console storage for single-node durable merchant, listing,
  challenge, payment, and indexed session spend state when Docker/Postgres/Redis
  are unavailable.
- `@sui402/walrus` artifact package for content-addressed receipt bundles,
  agent memory snapshots, artifact ID validation, and Walrus publisher/aggregator
  HTTP integration.
- Console API payment-ledger export route that publishes `audit-log` artifacts
  to Walrus and records returned blob IDs in console export history.
- Optional gateway receipt issuer hook, payment records with signed receipt
  attachment, durable receipt persistence, and console receipt-bundle export to
  Walrus.
- Reusable session spend receipt issuer with monotonic sequence store interface.
- Provider API receipt signing configuration, readiness reporting, and
  Redis-backed receipt sequence storage.
- Postgres-backed console store bundle for multi-node merchant, listing,
  challenge/replay, payment, indexed session spend, and Walrus export state.
- External receipt signer interface and provider `external` signer mode for
  KMS/HSM-backed receipt signatures without raw PEM env deployment.
- AWS KMS and GCP KMS Ed25519 receipt signer adapters with fail-closed signature
  handling and canonical receipt-byte tests.
- Receipt signer rotation runbook covering new signer ids, public-key
  verification, old-key trust windows, and Walrus audit export.
- Role-scoped console operator keys for viewer, merchant-admin, exporter,
  indexer, and admin access, including mounted gateway/registry admin routes.
- OIDC/JWKS console authentication for RS256/ES256 Bearer JWTs with issuer,
  audience, expiry, subject, and role-claim validation.
- Static console operator key validity windows with optional `notBefore` and
  `expiresAt` for staged key rotation.
- Console operator key generation helper and rotation runbook.
- Merchant application submission and approval/rejection workflow where public
  submissions stay pending until a merchant-admin publishes the gateway merchant
  and registry listing.
- Durable file/Postgres merchant application storage with review status,
  reviewer, reason, and published merchant linkage.
- Finance/support settlement summary route over verified payments with
  merchant/network/coin grouping, receipt counts, export context, and payment
  drill-down rows.
- Export detail route and downloadable settlement/reconciliation CSV reports.
- Durable console audit log for sensitive operator actions, covering merchant
  creation, application submission/review, trusted indexer ingestion, and
  Walrus exports with admin-only audit reads.
- Hash-chained console audit events with admin verification endpoint for recent
  event windows.
- Atomic multi-instance Postgres audit appends with transaction-scoped locking
  and monotonic event ordering.
- Privacy-preserving Walrus audit-head exports with verified chain boundaries,
  predecessor hashes, and operator dashboard controls.
- Dashboard operator panels for merchant application review, settlement
  reconciliation, Walrus export visibility, and recent audit events.
- Configurable per-process public merchant intake rate limit for application
  submissions.
- Postgres-backed shared public merchant intake rate limit for multi-node
  hosted console deployments.
- Configurable merchant review SLA deadlines with dashboard overdue visibility.
- Testnet production rehearsal runbook covering provider, session payment,
  receipt settlement, indexer sync, console reconciliation, dashboard checks,
  and optional Walrus exports.

- Live cloud KMS smoke tests with real staging AWS/GCP projects.
- CAPTCHA or identity checks and email verification for broad seller intake.

## Phase 6: Low-Cost Nanopayments

Goal:

- Avoid one onchain transaction per request.
- Use sessions first, then explore signed spend receipts and batch settlement.

Built:

- Session-based payments already avoid one transaction per protected API call.
- `@sui402/receipts` package for signed off-chain spend receipts.
- Canonical receipt IDs, resource scope hashes, sequence numbers, expiry, and
  Ed25519 signature verification.
- Receipt finality policy helpers covering settlement delay, dispute windows,
  max receipt age, and per-stream monotonic sequence validation.
- Move `settlement` module with owned settlement ledgers, receipt replay
  accounting, single/batch receipt settlement records, and
  `ReceiptSettled<T>` / `BatchSettled<T>` events.
- TypeScript PTB builders for creating settlement ledgers and submitting single
  or batched receipt settlement records.
- `sui402-settlement` operator CLI for creating ledgers, settling single
  receipts, settling JSON batches, inspecting ledgers, and running a basic
  create-and-settle demo.

Still required for full batching:

- Escrowed fund movement for aggregated receipts.
- Escrow/dispute integration between off-chain finality policy and on-chain
  fund movement.
- External Move audit of settlement behavior.

## Phase 7: Developer Experience

Goal:

- Docs site.
- Express/Fastify/Hono/Next adapters.
- MCP client adapters.
- CLI scaffolder.
- Copy-paste quickstarts.

Built:

- `@sui402/create-sui402` provider scaffolder.
- Importable `@sui402/provider-api` package surface for generated projects.
- Scaffold templates for `package.json`, `tsconfig.json`, `.env.example`,
  provider server entrypoint, and README.
- No-overwrite scaffold writes to protect existing user files.
- Real testnet one-shot demo command through `npm run payment:fetch`.
- Real testnet session demo command through `npm run session:demo`.
- `sui402-mcp-config` generator for Claude/Cursor/generic MCP client
  `mcpServers` configuration.
- `rehearsal:check` preflight command plus PowerShell env loader for local
  Testnet rehearsal setup.

## Phase 8: Security and Compliance

Goal:

- Threat model.
- Move audit.
- SDK audit.
- Replay tests.
- Resource-binding tests.
- Terms and privacy docs.

Built:

- Repository threat model in `docs/threat-model.md`.
- Security disclosure policy in `SECURITY.md`.
- Production security checklist in `docs/security-checklist.md`.
- Legal/compliance launch notes in `docs/legal-notes.md`.
- Replay and resource-binding tests are already present across server, MCP, and
  Sui verifier packages.
- Prometheus-compatible provider/console request counters and latency
  histograms with dependency-aware readiness probes.
- Production monitoring guide with alert thresholds and dashboard requirements.
- Production incident-response runbook covering verification, replay, signer,
  storage, indexer, and audit-chain incidents.

Still required before mainnet production claims:

- External Move audit.
- External SDK/backend audit.
- Counsel-reviewed terms and privacy policy.
- Staffed incident ownership and production monitoring infrastructure/accounts.
