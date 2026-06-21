# Production Deployment

This document separates two different things that used to be blurred together:

1. **Local Compose rehearsal**: useful for build, migrations, health checks,
   durable Redis/Postgres wiring, and release gates on one machine.
2. **Hosted production**: real DNS/TLS, managed Postgres/Redis, secret manager
   injection, OIDC/JWKS operator auth, production Sui RPC, external receipt
   signing, centralized monitoring/logging, backups, and staffed operations.

Real talk: local Docker is not production. Passing the Compose gate means the
application paths are healthy enough to deploy. It does not prove that the
system is safe for real users or funds.

Use `docs/staging-deployment.md` before production. Staging must prove the
hosted operating model with production-like infrastructure.

## 1. Local Compose Rehearsal

The repository includes `docker-compose.production.yml` for a local production
rehearsal stack:

- Redis for challenge state, receipt sequences, and distributed rate limiting.
- Postgres for payment records, console state, indexed events, cursors, exports,
  applications, audit logs, and shared public-intake rate limits.
- Provider API on port `4020`.
- Console API on port `4030`.
- Dashboard on port `4040`.
- Session-spend and settlement indexer workers.

Prepare the local rehearsal env:

```powershell
cd F:\Downloads\sui-hack
Copy-Item .env.production.example .env.production -ErrorAction SilentlyContinue
notepad .env.production
```

Change at least:

- `SUI402_POSTGRES_PASSWORD`
- `SUI402_MERCHANT_ADDRESS`
- `SUI402_ADMIN_API_KEY`
- `SUI402_CONSOLE_OPERATOR_KEYS_JSON` if using static local keys
- `SUI402_CONSOLE_OIDC_*` if rehearsing OIDC locally
- `VITE_SUI402_CONSOLE_API_URL` if the dashboard is not served on localhost

Do not put console operator keys, admin keys, database URLs, OIDC client
secrets, KMS references, wallet secrets, or private keys in `VITE_*`. Vite
variables are bundled into browser JavaScript.

Build and start:

```powershell
npm run deploy:prod:build
npm run deploy:prod:up
npm run deploy:prod:ps
```

Smoke test:

```powershell
npm run deploy:prod:smoke
```

Or run the combined local deployment gate:

```powershell
npm run deploy:prod:certify
```

Open:

- Provider API: `http://127.0.0.1:4020/health/ready`
- Console API: `http://127.0.0.1:4030/health/ready`
- Dashboard: `http://127.0.0.1:4040`

Local Prometheus scrape targets:

- Provider API: `http://127.0.0.1:4020/metrics`
- Console API: `http://127.0.0.1:4030/metrics`

Even locally, treat `/metrics` as an internal route. In hosted staging and
production, restrict it to the monitoring network or an authenticated internal
proxy. See `docs/monitoring.md` and `docs/runbooks/incident-response.md`.

Logs:

```powershell
npm run deploy:prod:logs
```

Stop:

```powershell
npm run deploy:prod:down
```

Local backup rehearsal:

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres `
  pg_dump -U $env:SUI402_POSTGRES_USER $env:SUI402_POSTGRES_DB > sui402-backup.sql
```

This backup command proves you can dump the local database. Production backups
must be managed-service backups with tested restores.

## 2. Hosted Production Requirements

Hosted production must not run the in-repo Compose database/cache as the source
of truth. Provision production resources and inject their connection strings at
runtime:

| Area | Production requirement |
| --- | --- |
| Compute | Hosted containers/VMs/orchestrator with rolling deploys and rollback |
| DNS/TLS | Public provider, console, and dashboard domains with managed TLS |
| Postgres | Managed Postgres, encrypted, private networking, backups/PITR, restore tested |
| Redis | Managed Redis with auth/TLS where supported and private networking |
| Secrets | Secret manager injection; no secrets committed, baked into images, or exposed as `VITE_*` |
| Console auth | OIDC/JWKS for human operators; static keys only for service/break-glass use |
| Sui RPC | Contracted RPC, dedicated fullnode, or archive-capable source with monitoring |
| Receipts | External/KMS/HSM/Vault signer path for high-value receipt issuance |
| Observability | Central logs, metrics, alerts, dashboards, on-call owner, incident runbook |
| Backups | Automated DB backups, restore test, retention owner |
| Security | External audits, rotation rehearsals, legal/regulatory sign-off before mainnet |

If one of these is missing, say so in the release notes. Calling a partial
deployment "production" creates bad incentives and hides real launch risk.

## 3. Production Secret Manager Map

Store these values in the production secret manager and inject them into the
named services. Keep secret names/paths in deployment docs, never values.

| Secret/config | Service | Production guidance |
| --- | --- | --- |
| `SUI402_REDIS_URL` | provider API | Managed Redis URL for challenges, rate limits, receipt sequence durability |
| `SUI402_POSTGRES_URL` | provider API | Managed Postgres URL for provider storage |
| `SUI402_CONSOLE_POSTGRES_URL` | console API | Managed Postgres URL for console state/audit logs |
| `SUI402_INDEXER_POSTGRES_URL` | indexers | Explicit DB URL for durable cursors and event sinks |
| `SUI402_ADMIN_API_KEY` | provider API | Long random secret, rotated and access-controlled |
| `SUI402_CONSOLE_OPERATOR_KEYS_JSON` | console API | Service or break-glass keys only; include owners and expiries |
| `SUI402_CONSOLE_OIDC_ISSUER` | console API | Exact production issuer |
| `SUI402_CONSOLE_OIDC_AUDIENCE` | console API | Production console audience |
| `SUI402_CONSOLE_OIDC_JWKS_URL` | console API | HTTPS JWKS URL reachable by the console API |
| `SUI402_CONSOLE_OIDC_ROLE_CLAIM` | console API | Claim containing console role names |
| `SUI402_CONSOLE_OIDC_SUBJECT_CLAIM` | console API | Stable operator identifier claim |
| `SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM` | console API | Claim containing seller-authorized merchant ids, default `merchant_ids` |
| `SUI402_RECEIPT_SIGNER_ID` | provider/console | Sui address used as receipt signer id |
| KMS/HSM/Vault key reference | signer service | Cloud-specific key id/ARN/resource; never raw key material |
| Walrus publisher credentials | console API | Required only when production exports are enabled |

Non-secret but safety-critical values such as `SUI402_NETWORK`,
`SUI402_GRPC_URL`, package IDs, merchant address, coin type, price, resource
scope, and dashboard public API URL still need release review because a wrong
value can route production traffic to the wrong chain, merchant, or API.

## 4. OIDC/JWKS Expectations

Production console access should use OIDC/JWKS for human operators:

- Configure `SUI402_CONSOLE_OIDC_ISSUER`,
  `SUI402_CONSOLE_OIDC_AUDIENCE`, and `SUI402_CONSOLE_OIDC_JWKS_URL` together.
- Use short-lived tokens, MFA, and least-privilege group-to-role mapping.
- Map only the needed console roles: `viewer`, `merchant_admin`, `exporter`,
  `indexer`, and tightly controlled `admin`.
- For hosted seller portals, map seller users to `seller_viewer` or
  `seller_admin`, and include only their allowed merchant ids in
  `SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM`.
- Prove bad issuer, bad audience, expired token, and missing-role cases fail.
- Prove cross-merchant seller tokens fail before enabling public seller login.
- Keep static operator keys scoped, expiring, and documented as service or
  break-glass credentials.

See `docs/console-api.md` and
`docs/runbooks/console-operator-key-rotation.md`.

## 5. Receipt Signer And KMS Expectations

Receipt signing is a production-sensitive boundary:

- Prefer external signing through AWS KMS, GCP KMS, Vault Transit, HSM, or an
  equivalent service.
- `SUI402_RECEIPT_SIGNER_ID` must be the Sui address recorded as the settlement
  signer for receipts that will be settled on-chain.
- Verify a known receipt signature with the signer public key before routing
  production traffic.
- Rotate by introducing a new signer id or documented key-version boundary, and
  keep old public keys trusted through receipt TTL plus dispute window.
- Do not deploy raw PEM private keys for high-value production.

Important implementation detail: the stock Compose path can use local PEM
receipt signing for rehearsal. Cloud KMS/HSM/Vault signing requires the
importable provider/console app path or a hosted service wrapper that injects an
external signer object. Setting `SUI402_RECEIPT_SIGNER_PROVIDER=external` in an
env file is not, by itself, evidence that production is using KMS.

See `docs/provider-api.md` and `docs/receipts.md`.

## 6. Indexer Workers

Run two production workers:

- `indexer-session`: indexes `SessionSpent<T>` events.
- `indexer-settlement`: indexes `ReceiptSettled<T>` and `BatchSettled<T>`
  events.

Both should use the Postgres sink and durable cursor table. Public fullnodes may
prune old checkpoints, so set `SUI402_INDEXER_GRPC_START_CHECKPOINT` when you
need deterministic first sync from a known deployment point. For long-running
production, use an archive/fullnode source, contracted RPC provider, or a
custom JSONL feed with retention guarantees.

Monitor latest indexed checkpoint, cursor age, worker restarts, and settlement
reconciliation exceptions.

## 7. Release Gate

Before shipping a production image or config change:

```powershell
npm run launch:check
npm run production:certify
```

Then verify the hosted environment:

- staging runbook passed and evidence is linked
- external audits/sign-offs are complete or explicitly waived by accountable
  owners
- production OIDC/JWKS is configured and negative auth tests fail correctly
- production secrets are present in the secret manager, not `.env` files
- KMS/external receipt signer is smoke-tested, or receipts are intentionally
  disabled
- production Sui RPC endpoint has owner, quota, monitoring, and retention notes
- DNS/TLS is live for provider, console, and dashboard routes
- `/metrics` is internal-only and scraped
- alerts page the right owner
- backup restore has been tested
- incident response owner, backup, and disclosure contact are assigned

Production is a deployment plus an operating commitment. If the team cannot
staff monitoring, incident response, rotations, and backups, keep the release in
staging or beta.
