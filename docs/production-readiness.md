# Production Readiness Status

Last updated: 2026-06-18

This document separates completed engineering work from launch work that cannot
be truthfully completed inside the repository.

The launch tracker with owners, evidence fields, priority sequencing, and
concrete launch criteria is `docs/serious-launch-plan.md`.

## Locally Complete

- one-shot Sui payments and session payments
- transaction/resource/replay verification
- gRPC Core API verifier, session discovery, and operator CLI
- non-SUI coin selection and payment transaction construction
- Redis/Postgres durable provider and MCP storage
- hosted multi-merchant gateway, registry, seller intake, and review SLAs
- role-scoped keys plus OIDC/JWKS console authentication
- signed receipts, KMS/HSM signer adapters, settlement accounting, and indexers
- settlement/reconciliation reports and CSV exports
- hash-chained audit events with atomic Postgres append
- privacy-preserving Walrus audit-head anchoring
- Prometheus metrics and dependency-aware readiness
- production Docker definitions, certification scripts, monitoring guidance,
  security documentation, and incident-response runbooks
- TypeScript tests/builds and Move tests/builds

## External Launch Gates

These are required before a mainnet production claim. Track owner, evidence, and
status for each gate in `docs/serious-launch-plan.md`.

1. Run funded end-to-end testnet rehearsals for one-shot, session, receipt
   settlement, indexer, reconciliation, and Walrus paths.
2. Run live AWS KMS/GCP KMS smoke tests using staging projects and production-like
   IAM policies.
3. Complete independent Move and SDK/backend security audits and resolve findings.
4. Obtain counsel-reviewed terms, privacy policy, and regulatory posture.
5. Assign incident commander/on-call ownership and provision production
   monitoring, paging, log retention, RPC, DNS, TLS, backup, and secret-manager
   accounts.
6. Add CAPTCHA/identity and email verification before broad public seller intake.

## Separate Protocol Workstream

Receipt batching currently records and reconciles settlement facts. It does not
move escrowed funds. Escrow, disputes, withdrawal rules, insolvency handling, and
fund recovery require an explicit protocol design, economic review, Move
implementation, adversarial tests, and external audit. Do not market the current
receipt ledger as a fully escrowed batch-payment protocol.

## Release Decision

The repository can be described as a production-oriented implementation with
local engineering gates. It must not be described as audited, mainnet-certified,
legally approved, or operationally staffed until every external launch gate has
evidence and an accountable owner.
