# Sui402 Threat Model

## Overview

Sui402 is a machine-payment protocol and implementation for paid HTTP APIs, MCP
tools, hosted gateways, registries, and Sui-native payment sessions. The
repository contains protocol schemas, Sui transaction/verifier helpers, Express
middleware, Redis/Postgres storage adapters, MCP wrappers, a provider API, a
hosted gateway router, a registry router, spending policy tools, off-chain
receipt primitives, a session CLI, and a Move package for payment sessions.

The highest-value assets are:

- merchant funds and settlement correctness
- payer funds and spending limits
- payment challenge integrity
- transaction digest replay protection
- session object constraints and resource-scope binding
- admin APIs for ledgers, registries, and gateway merchants
- private keys and signing authority, which should stay outside server code

The core security invariant is: a protected resource is unlocked only after a
valid, fresh, correctly scoped payment proof for the exact merchant, network,
coin type, amount, resource, and challenge.

## Threat Model, Trust Boundaries, and Assumptions

Primary trust boundaries:

- Agent/client boundary: agents submit HTTP headers, MCP tool arguments, payment
  proofs, signed receipts, and wallet-derived transaction digests.
- Chain boundary: Sui RPC responses are external data and must be verified
  against protocol invariants, not trusted as opaque success strings.
- Storage boundary: Redis challenge state and Postgres payment records preserve
  replay protection across restarts and horizontal scaling.
- Admin boundary: provider, registry, and gateway admin routes rely on configured
  bearer/header API keys.
- Wallet boundary: private keys are expected to remain in user/agent wallets,
  external signers, or operator-controlled CLI environments.
- Move boundary: session spending constraints are enforced by the on-chain Move
  package and then re-verified by TypeScript verifier logic.

Attacker-controlled inputs include:

- `Sui402-Payment` headers and MCP `paymentProof` values
- all HTTP request paths, query strings, JSON bodies, and forwarded headers
- registry listing submissions when an admin key is compromised or misused
- gateway merchant configuration submissions when an admin key is compromised
- Sui transaction digests, session ids, payer fields, and receipt signatures
- provider URLs and manifests consumed by agents

Operator-controlled inputs include:

- environment variables such as merchant address, price, coin type, Redis URL,
  Postgres URL, session package id, and admin API keys
- Move package deployment IDs
- registry/gateway merchant onboarding data
- Sui RPC endpoint selection through SDK defaults or injected clients

Developer-controlled inputs include package code, tests, generated scaffolds,
and docs. Build artifacts in `dist/` are generated outputs and should be
reviewed as release artifacts, not edited directly.

Assumptions:

- Sui fullnode/RPC data may be unavailable or inconsistent, but verifier code
  must still reject mismatches.
- Redis/Postgres are required in production for durable replay protection.
- Server code should not custody user funds in v0.
- Legal/compliance positions are not established by this repo and need counsel
  before production financial automation.

## Attack Surface, Mitigations, and Attacker Stories

Payment verification surfaces:

- `packages/server/src/index.ts` issues and consumes challenges, invokes
  verifiers, and records successful payments.
- `packages/sui/src/index.ts` verifies Sui transaction success, recipient balance
  changes, coin type, network, session events, and resource-scope hashes.
- `packages/mcp/src/index.ts` applies the same challenge and ledger replay model
  to MCP tool calls.
- `packages/gateway/src/index.ts` hosts multi-merchant challenge issuance and
  verification.

Relevant attacker stories:

- Reuse one valid transaction digest against multiple challenges.
- Submit a digest for the wrong merchant, coin type, amount, network, or payer.
- Spend a session funded for one resource scope against a different resource.
- Use a stale challenge after expiry or after another request consumed it.
- Abuse missing durable storage after server restart to replay old proofs.

Existing mitigations:

- Challenge ids bind nonce, network, recipient, coin type, amount, resource, and
  expiry.
- Challenge stores consume challenges once.
- `PaymentRecordStore.getByProof(network, txDigest)` blocks ledger-level replay.
- Postgres storage creates a unique `(network, tx_digest)` index.
- Session verifier checks emitted `resource_scope_hash`.
- Production provider and MCP storage paths refuse to start without Redis and
  Postgres.
- Policy guardrails can reject unsafe challenges before signing.

Admin and configuration surfaces:

- `apps/provider-api/src/admin.ts`, `packages/registry/src/index.ts`, and
  `packages/gateway/src/index.ts` expose API-key protected admin routes.
- Risks include weak admin keys, leaked env files, overbroad admin access, and
  lack of per-seller RBAC in hosted deployments.
- Current mitigations include disabled admin routes unless keys are configured,
  minimum provider admin key length, and explicit read-only behavior when
  registry/gateway admin keys are absent.

MCP and marketplace surfaces:

- MCP clients pass tool arguments and payment proofs over stdio.
- Registry listings and provider manifests may influence agent routing.
- A malicious listing can advertise a high price, wrong merchant, unsafe MCP URL,
  or misleading metadata.
- Agents should combine manifest discovery with spending policies and should
  treat discovery metadata as preflight only; server-issued challenges remain
  authoritative.

Receipt and future batching surfaces:

- `packages/receipts` signs canonical off-chain spend receipts.
- A complete batching system still needs sequence replay accounting, Move
  settlement contracts, and dispute/finality rules.
- Receipt signatures currently authenticate receipt bytes with Ed25519 keys but
  do not by themselves prove Sui account ownership.

Out of scope or not yet solved:

- Third-party Move audit.
- Third-party SDK/backend audit.
- Legal classification of automated payments/trading.
- Custodial wallet operations.
- Production seller identity, KYB/KYC, sanctions screening, and tax reporting.

## Severity Calibration

Critical:

- A verifier accepts a payment for the wrong merchant, network, coin type, amount,
  or resource and unlocks paid resources without valid payment.
- A replay bug lets one transaction digest unlock multiple paid resources across
  challenges, providers, or gateway merchants.
- A Move session bug allows spending beyond funded balance, max-per-request, or
  expiry.
- Server code introduces custody of user private keys and leaks them.

High:

- Production deployment silently uses in-memory challenge or ledger state,
  allowing replay after restart or across instances.
- Admin API authentication bypass exposes payment ledgers or lets attackers add
  malicious registry/gateway merchants.
- MCP paid tools skip ledger replay protection while HTTP endpoints enforce it.
- Provider manifests or gateway merchant configs cause agents to pay a different
  merchant than intended.

Medium:

- Rate limits are missing or only process-local in a horizontally scaled service.
- Error responses leak stack traces, secrets, internal storage URLs, or private
  operational metadata.
- Registry listings allow misleading but not directly exploitable metadata.
- Receipt validation accepts expired receipts or malformed sequence values before
  settlement logic exists.

Low:

- Documentation examples use weak placeholder keys but are clearly marked as
  examples.
- Local-only scaffolder mistakes that do not affect generated production code.
- Cosmetic manifest fields are stale while payment challenges remain correct and
  verified.

Security review should prioritize payment verification, replay protection,
session Move logic, admin boundaries, and production storage requirements before
lower-impact DX or documentation issues.
