# Production Hardening Backlog

Last updated: 2026-06-24

This is the working backlog for turning the current Sui402 repository from a
release-ready testnet/demo stack into a credible public production launch. It
intentionally separates repo-side work from external evidence that must come
from hosted infrastructure, auditors, counsel, and operators.

## Current posture

Sui402 has real foundations: protocol schemas, one-shot payments, Sui-native
sessions, verifier paths, gateway, registry, MCP helpers, publisher intake,
marketplace/scan APIs, Redis/Postgres adapters, audit events, receipts,
indexers, release checks, and production-readiness docs.

It is not yet broad public/mainnet production-ready. Do not accept real public
funds or broad seller onboarding until the P0 gates below have concrete
evidence.

## P0 launch blockers

| Gate | Required evidence | Status |
| --- | --- | --- |
| Hosted staging | Provider, console, dashboard, and indexers deployed with managed Postgres/Redis, DNS/TLS, secret manager, logs, metrics, alerts, and restore-tested backups. | Not done |
| Funded testnet rehearsal | Paid call, session open/spend/close, receipt, settlement/reconciliation, indexer cursor/checkpoint, scan/marketplace agreement, and optional Walrus audit-head proof. | Not done |
| External Move audit | Independent report for the Sui session/settlement package with critical/high findings fixed or formally accepted. | Not done |
| External backend/SDK audit | Independent report covering verifier, replay protection, gateway, MCP, registry, storage, receipt signing, and console auth. | Not done |
| Legal/compliance review | Counsel-approved terms, privacy, merchant onboarding terms, jurisdiction/payment analysis, sanctions/abuse posture, and data retention policy. | Not done |
| Secret management | Production secrets injected from a secret manager; local `.env` files are not the operating model; rotation and access review evidence exists. | Not done |
| OIDC/JWKS auth | Production IdP with MFA, least-privilege roles, seller merchant-scoped claims, and negative auth tests. | Not done |
| KMS/HSM receipt signer | Live external signer smoke test, public-key verification, IAM review, and rotation rehearsal; no raw PEM keys for high-value production. | Not done |
| Monitoring/on-call | Dashboards, alert rules, paging schedule, incident commander, backup owner, first page test, and disclosure contact. | Not done |
| Backup/restore | Managed Postgres backup/PITR plus a timed restore drill and documented RPO/RTO. | Not done |
| Seller intake abuse controls | CAPTCHA/email/domain/identity checks, KYB/KYC/sanctions decision, abuse escalation, takedown SLA, and support workflow. | Not done |
| Mainnet governance | Publish/upgrade policy, UpgradeCap custody, multisig/signer plan, gas dry-run, package ID recording, and forward-fix process. | Not done |

## P1 serious beta hardening

- Split public marketplace, public scan, publisher portal, MCP discovery, and
  privileged operator console into clearer routes/surfaces.
- Prove clean-machine `@sui402/pay` setup with a funded testnet wallet.
- Deepen publisher onboarding: OpenAPI-to-config automation, WalletConnect
  proof UX, live paid-test wizard, clear review states, and resumable portal
  sessions.
- Add hosted Postgres/staging marketplace + scan agreement tests.
- Add release/security/package gates to CI.
- Decide and commit the root license before npm publication.
- Create npm org/package ownership policy with 2FA and provenance publishing.
- Add SBOM/dependency scan/image digest retention to release artifacts.
- Lock production CORS, dashboard CSP, metrics exposure, and public read limits
  against the hosted topology.
- Add support, status page, incident comms, merchant escalation, and dispute
  language.

## P2 scale hardening

- Multi-region/failover design and disaster-recovery rehearsal.
- Post-audit threat model refresh.
- Economic/protocol review before claiming escrow, refund guarantees, or legal
  settlement finality.
- Merchant risk scoring and fraud/sanctions provider integration if public
  onboarding is broad.
- Richer marketplace ranking, categories, trust badges, reliability windows, and
  moderation signals.
- Richer Sui402Scan explorer pages with a full privacy matrix by field.
- Fastify/Hono/Next adapters and more copy-paste examples.
- Accessibility, responsive UX, analytics/privacy review, changelog, and
  versioned public API contracts.

## Automated guardrails added

- CI now runs token-leak, production dependency audit, npm package dry-run,
  launch readiness guard, and packaged clean-install guards after
  typecheck/test/build.
- `npm run release:check` now includes the production dependency audit and
  launch readiness guard self-test, so local release proof matches CI.
- `npm run launch:check` now applies extra serious-launch topology checks when
  `SUI402_SERIOUS_LAUNCH=true` or `SUI402_NETWORK=sui:mainnet`:
  - managed Redis/Postgres URLs
  - Postgres-backed console and indexer storage
  - public HTTPS console/dashboard/OIDC URLs
  - non-default Sui RPC ownership signal
  - no raw receipt private key material
  - external receipt signer when receipt signing is enabled
  - concrete evidence references for hosted staging, funded rehearsal, audits,
    legal, secret management, OIDC/JWKS, on-call, KMS, monitoring,
    backup/restore, Sui RPC, seller intake, and mainnet governance when relevant

These guards are not a substitute for external evidence; they keep the repo
from accidentally presenting local rehearsal topology as production.
