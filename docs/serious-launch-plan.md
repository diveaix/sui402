# Serious Production Launch Plan

Last updated: 2026-06-18

This tracker is the source of truth for turning the current Sui402 repository
state into a credible public production launch. It deliberately separates
repo-complete engineering from external evidence gates. A passing local
certification run is necessary, but it is not enough to claim mainnet
production readiness.

## Status Legend

| Status | Meaning |
| --- | --- |
| Done | Evidence exists and is linked or named in this repo. |
| Repo complete | Implementation or documentation exists locally, but external proof is still required. |
| In progress | Work has an owner and is actively being completed. |
| Blocked | Work cannot proceed until a dependency, vendor, reviewer, or decision is available. |
| Not started | No accepted owner/evidence yet. |

## Launch Decision Rules

- P0 items are hard launch blockers. Do not accept real funds or broad public
  seller onboarding until every P0 item is Done.
- P1 items can launch behind a limited allowlist only if each gap has an owner,
  a dated mitigation, and executive/security acceptance.
- P2 items are post-launch hardening. They should not block a constrained launch,
  but they must be tracked before scale.
- "Repo complete" means the code/docs/scripts exist. It does not mean they were
  exercised with real cloud accounts, production IAM, funded Sui transactions,
  external auditors, counsel, or a staffed on-call rotation.

## Concrete Launch Criteria

Sui402 can be called production-launched only when all of the following are true:

1. `npm run production:certify` and `npm run launch:check` pass on the release
   commit with artifacts saved.
2. A funded testnet rehearsal covers one-shot payments, sessions, receipt
   settlement, indexers, reconciliation reports, and Walrus audit anchoring.
3. Staging runs the production deployment topology with managed Redis/Postgres,
   DNS/TLS, OIDC, managed secrets, KMS/HSM receipt signing, monitoring, logs,
   backups, and restore validation.
4. Mainnet publish/upgrade governance is decided before publish, including
   signer custody, UpgradeCap policy, gas estimate, and rollback/forward-fix
   plan.
5. Independent Move and backend/SDK audits are complete, with critical/high
   findings fixed or formally risk-accepted.
6. Legal/compliance review is complete for terms, privacy, payment flow,
   jurisdictional exposure, public seller intake, and data retention.
7. On-call ownership exists with paging, runbooks, severity policy, disclosure
   contact, and incident commander/backup.
8. Public launch scope is explicit: supported networks, coin types, merchant
   eligibility, limits, abuse controls, and any allowlist constraints.

## P0: Production Launch Blockers

| Gate | Repo state | Required external evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| Local release certification | `docs/production-certification.md` documents local Docker, TypeScript, storage, indexer, and Move gates. | Saved passing output from `npm run production:certify` and `npm run launch:check` on the release commit. | Engineering release owner | Repo complete |
| Funded testnet rehearsal | Testnet and rehearsal docs exist, including `docs/runbooks/testnet-rehearsal.md`; `npm run rehearsal:evidence:check -- --file <evidence.md>` now machine-checks concrete funded paid-call, receipt, settlement, indexer cursor/checkpoint, and reconciliation evidence. | Transaction digests, package IDs, session object IDs, receipt settlement records, indexer cursor evidence, reconciliation export, and Walrus audit-head proof from a funded testnet run. | Engineering + release owner | Not started |
| Staging environment | Production Compose docs exist in `docs/production-deployment.md`. | Production-like staging stack with managed Redis/Postgres, DNS/TLS, private networking, backups, restore test, and readiness/metrics screenshots or links. | DevOps/SRE owner | Not started |
| OIDC and operator access | Console auth support is implemented and documented in readiness/security docs. | Live OIDC/JWKS tenant configured with least-privilege roles, short-lived tokens, break-glass policy, and access review. | Security + DevOps/SRE owner | Not started |
| Managed secrets | `.env.production.example` documents required variables, but local env files are not production secret management. | Secret manager project/vault, rotation policy, access audit, and proof no production secret is exposed through dashboard `VITE_*` variables. | Security + DevOps/SRE owner | Not started |
| KMS/HSM receipt signing | KMS/HSM signer adapters are repo-complete. | Live AWS KMS/GCP KMS/HSM smoke test, public key verification, signer-id routing test, rotation rehearsal, and IAM policy review. | Security owner | Not started |
| Monitoring and on-call | Metrics, readiness probes, monitoring docs, and incident runbook exist. | Dashboards, alert rules, paging schedule, incident commander/backup, disclosure contact, log retention, and first page test. | SRE/on-call owner | Not started |
| External Move audit | Move tests/builds pass locally. | Independent audit report for `move/sui402_sessions`, finding tracker, fixes, and accepted residual risks. | Security owner | Not started |
| External backend/SDK audit | TypeScript checks/tests/builds pass locally. | Independent audit report covering verifier, client, gateway, MCP, storage, registry, console API, receipt signing, and replay/rate-limit paths. | Security owner | Not started |
| Legal/compliance review | `docs/legal-notes.md` exists as internal notes. | Counsel-approved terms, privacy policy, merchant onboarding terms, regulatory/payment analysis, data retention policy, and public disclosure language. | Legal/compliance owner | Not started |
| Mainnet package governance | Sui Move package exists and testnet build passes locally. | Mainnet signer plan, gas dry-run, UpgradeCap policy, multisig or custody evidence, package ID recording plan, and forward-fix incident process. | Engineering + security owner | Not started |
| Public seller intake abuse controls | Rate limiting and seller review docs exist. | CAPTCHA/identity/email verification, merchant review workflow, abuse escalation, throttling limits, and evidence from staging. | Product + security owner | Not started |

## P1: Limited Launch Requirements

| Gate | Repo state | Required external evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| Allowlisted launch scope | Gateway, registry, and seller docs exist. | Named initial merchants, limits per merchant/network/coin, allowlist controls, rollback criteria, and launch comms. | Product owner | Not started |
| Backup and restore drills | Postgres backup command is documented. | Timed restore exercise for staging database plus documented RPO/RTO. | DevOps/SRE owner | Not started |
| RPC/fullnode reliability | Indexer docs warn about public fullnode pruning. | Chosen archive/fullnode provider, failover plan, checkpoint start policy, and rate-limit budget. | DevOps/SRE owner | Not started |
| Audit log retention | Hash-chained audit events and Walrus anchoring are repo-complete. | Retention policy, append-only export destination, access controls, and sample incident evidence retrieval. | Security + compliance owner | Not started |
| Key rotation drills | Rotation runbooks/docs exist for console and signer keys. | Staging rotation for admin API keys, console operator keys, OIDC roles, and receipt signer keys without downtime. | Security + DevOps/SRE owner | Not started |
| Performance and load rehearsal | Local tests cover correctness, not public traffic. | Load profile, saturation point, rate-limit behavior, p95/p99 latency, and database/Redis capacity evidence. | Engineering + SRE owner | Not started |
| Release artifact provenance | Build scripts exist locally. | Image digest, SBOM/dependency scan, vulnerability triage, deploy approval, and rollback artifact retained. | Engineering release owner | Not started |
| Customer support path | Security disclosure policy exists. | Support intake, merchant escalation, refund/dispute messaging, status page, and incident comms templates. | Product + support owner | Not started |

## P2: Scale Hardening

| Gate | Repo state | Required external evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| Multi-region readiness | Current production topology is single-stack oriented. | Region/failover design, disaster recovery drill, data residency review, and runbook updates. | SRE owner | Not started |
| Formal threat-model refresh | `docs/threat-model.md` exists. | Post-audit threat-model review with mitigations mapped to launch scope. | Security owner | Not started |
| Economic and protocol review | Receipt ledger explicitly is not full escrow. | External economic/protocol review before marketing escrow, disputes, withdrawals, or batch fund movement. | Protocol/product owner | Not started |
| Merchant risk scoring | Seller intake/review exists at a basic operational level. | Risk scoring model, sanctions/fraud checks if applicable, and manual override audit trail. | Compliance + product owner | Not started |
| Public status and transparency | Monitoring docs exist internally. | Public status page, incident history policy, uptime/error budget reporting. | Product + SRE owner | Not started |

## Repo-Complete Inventory

These items are strong local foundations. They should be cited as implementation
evidence, not launch evidence:

- One-shot Sui payments and payment proof verification.
- Sui-native payment sessions and Move test/build gates.
- Durable Redis/Postgres storage adapters and replay protection.
- Hosted gateway, registry, seller intake, and console API/dashboard surfaces.
- Role-scoped operator keys and OIDC/JWKS support.
- Signed receipts, KMS/HSM signer adapter interfaces, indexers, reconciliation,
  reports, and CSV exports.
- Hash-chained audit events and Walrus audit-head anchoring.
- Prometheus metrics, dependency-aware readiness, monitoring docs, and incident
  runbooks.
- Docker Compose production topology and local production certification scripts.
- Security checklist, threat model, disclosure policy, and legal notes.

## Evidence Log

Add dated evidence here as gates complete. Do not mark a gate Done without a
link, artifact path, transaction digest, audit report reference, or named
external approval.

| Date | Gate | Evidence | Recorded by |
| --- | --- | --- | --- |
| 2026-06-18 | Local repository implementation baseline | `docs/production-readiness.md` lists locally complete work and external gates. | Worker A |
