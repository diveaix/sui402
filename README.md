# Sui402

Sui402 is a Sui-native machine payment layer for AI agents, APIs, and MCP tools.

It lets a provider protect an HTTP endpoint or MCP tool with a `402 Payment Required`
challenge. An agent can pay on Sui, retry with a signed payment proof, and receive
the requested resource.

## Product Thesis

AI agents can call tools, but most tools still rely on API keys, accounts, or
human checkout flows. Sui402 gives agents a standard way to pay for:

- API calls
- MCP tools
- premium data
- inference
- storage
- agent-to-agent services

The first version supports one-shot payments verified by Sui transaction digest
and Sui-native payment sessions backed by Move objects.

## Packages

- `@sui402/protocol`: challenge/proof schemas, headers, and canonical hashing
- `@sui402/policy`: agent spending policy schemas and evaluators
- `@sui402/registry`: paid API/MCP listing schemas and registry router
- `@sui402/gateway`: hosted multi-merchant challenge and verification router
- `@sui402/receipts`: signed off-chain spend receipts plus Move replay
  accounting groundwork for future batching
- `@sui402/indexer`: session spend event normalization and indexing primitives
- `@sui402/sui`: Sui transaction builders, verifiers, and session discovery
  over the gRPC Core API
- `@sui402/server`: Express middleware for paid HTTP endpoints
- `@sui402/storage`: Redis challenge store and Postgres payment ledger adapters
- `@sui402/client`: agent-side client that handles 402, pays, and retries
- `@sui402/mcp`: paid MCP tool wrapper and production stdio server
- `@sui402/provider-api`: production provider API surface
- `@sui402/console-api`: backend API for hosted console data/actions
- `@sui402/session-cli`: wallet/operator CLI for session lifecycle and
  settlement ledger tasks
- `@sui402/create-sui402`: provider project scaffolder
- `@sui402/dashboard`: hosted console frontend shell
- `move/sui402_sessions`: Sui Move payment-session package

## Example Flow

```text
Agent -> GET /premium-data
Server -> 402 Payment Required + Sui402 challenge
Agent -> pays on Sui
Agent -> retries with Sui402 payment proof header
Server -> verifies transaction digest
Server -> returns premium data
```

## Development

```bash
npm install
npm run build
npm run test
npm run dev:provider
```

## Hackathon Demo

For the submission flow, judge script, fallback plan, and verification commands,
start with `docs/demo-submission.md` and `DEMO_SUBMISSION_PLAN.md`.

Fast demo verification:

```bash
npm run demo:check
```

## Current Phase

We are building this in phases. See `docs/roadmap.md`.

For the latest production-readiness status, verified gates, and remaining
external launch requirements, see `PRODUCTION_STATUS.md`.
For testnet publishing and session operations, see `docs/testnet.md`.
For the real one-shot testnet payment demo, see `docs/testnet-demo.md`.
For seller testnet/mainnet configuration, see `docs/seller-configuration.md`.
Current testnet deployment details are in `docs/deployments.md`.
For the full testnet production rehearsal, see
`docs/runbooks/testnet-rehearsal.md`.
For console operator key rotation, see
`docs/runbooks/console-operator-key-rotation.md`.
For production monitoring and incident handling, see `docs/monitoring.md` and
`docs/runbooks/incident-response.md`.
For the local production certification gate, see
`docs/production-certification.md`.
For Docker Compose production deployment, see `docs/production-deployment.md`.
For the exact boundary between completed engineering and external launch gates,
see `docs/production-readiness.md`.
For the serious production launch tracker with P0/P1/P2 gates, owners,
evidence, and launch criteria, see `docs/serious-launch-plan.md`.
For the current execution backlog of what still needs hardening before a public
launch, see `docs/production-hardening-backlog.md`.
For paid MCP tools, see `docs/mcp.md`.
For agent budget guardrails, see `docs/policy.md`.
For paid API/MCP listing discovery, see `docs/registry.md`.
For hosted multi-merchant payments, see `docs/gateway.md`.
For low-cost receipt primitives, see `docs/receipts.md`.
For session spend indexing, see `docs/session-indexer.md`.
For provider scaffolding and DX, see `docs/dx.md`.
For the hosted console, see `docs/dashboard.md`.
For the console backend, see `docs/console-api.md`.
For Walrus-backed artifacts and agent memory strategy, see `docs/walrus-memory.md`.
For security posture, see `docs/threat-model.md`, `docs/security-checklist.md`,
and `SECURITY.md`.

Implemented now:

- Phase 1 one-shot payments
- payment record store
- generic coin payment transaction helper
- Phase 2 Move session draft
- session transaction builders
- session proof verification path
- testnet-published session package
- owned session discovery for agent clients
- read-only session manager API for providers
- session manager client for wallets and agents
- Redis/Postgres production storage adapters
- Postgres-backed hosted console stores for multi-node merchant, payment,
  challenge, indexed session, and export state
- role-scoped console operator keys for production dashboard/API access
- provider request IDs, structured logs, security headers, and rate limiting
- provider/console Prometheus metrics and dependency-aware readiness probes
- protected provider admin payment ledger API
- Redis-backed distributed provider rate limiting
- ledger-level transaction digest replay protection
- session spend resource-scope verification
- session spend event indexing primitives for chain/session analytics
- live-verified Sui GraphQL session spend event source for indexed analytics
- MCP paid-tool ledger recording and transaction digest replay protection
- configurable multi-tool production MCP stdio server and paid-tool registration helper
- MCP client config generator for Claude/Cursor/generic `mcpServers` setup
- machine-readable provider discovery manifest and client discovery helper
- agent spending policy engine and guarded client payment handlers
- server-side merchant payment policy enforcement for providers and hosted
  gateway merchants
- paid API/MCP registry listing contract and registry API router
- hosted gateway router for multi-merchant challenge issuance and verification
- signed off-chain spend receipt primitive for future batched settlement
- pluggable receipt signer interface for external/KMS-backed signatures
- provider project scaffolder and importable provider API package surface
- repository threat model, security disclosure policy, production checklist, and legal launch notes
- hosted dashboard frontend shell for merchants, payments, readiness, and onboarding
- console API that composes gateway merchants, registry listings, and payment summaries

## Security Principles

- Bind every payment to recipient, amount, coin type, network, resource, nonce,
  and expiry.
- Verify transaction success and recipient balance change on Sui.
- Reject expired, replayed, or mismatched proofs.
- Keep custody out of v0. The client builds or delegates payment; users/agents
  sign with their own wallet.
- Treat sessions, gas sponsorship, and merchant settlement as explicit later
  milestones.
