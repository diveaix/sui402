# Staging Deployment Runbook

Staging is the first hosted environment. It is not the local Docker Compose
stack with a different name.

Use local Compose to rehearse build, migrations, health checks, and service
wiring on one machine. Use staging to prove the production operating model:
managed Postgres, managed Redis, secret manager injection, TLS/domain routing,
OIDC/JWKS operator auth, production-like Sui RPC, external receipt signing,
centralized monitoring/logging, and restore-tested backups.

## 1. Staging Readiness Bar

Do not mark staging ready until all of these are true:

- Provider API, console API, dashboard, and indexers run in hosted compute.
- Postgres is a managed service with automated backups, point-in-time recovery
  where available, and a tested restore path.
- Redis is a managed service or production-grade cluster, not an in-container
  cache.
- All secrets come from the platform secret manager at runtime. No operator
  keys, database passwords, private keys, wallet keys, OIDC client secrets, or
  KMS credentials are committed, baked into images, or exposed as `VITE_*`.
- Public routes use real DNS names and TLS. `/metrics` is only reachable by the
  monitoring system or through an authenticated internal route.
- Console write access uses OIDC/JWKS with least-privilege roles. Static
  operator keys may exist only as break-glass or service keys with owners,
  expiry, and rotation notes.
- Receipt signing uses an external signer path backed by KMS/HSM/Vault, or the
  environment is explicitly recorded as "receipt signing disabled." Raw PEM env
  vars are not acceptable for a serious staging sign-off.
- Sui gRPC uses a production-like RPC provider, dedicated fullnode, or other
  contracted endpoint with quota/latency monitoring. Public default fullnodes
  are acceptable only for an early smoke test, not for final staging evidence.
- Logs, metrics, alerts, and backup jobs are configured before seller/operator
  testing starts.

## 2. Provision Hosted Infrastructure

Create separate staging resources. Do not share production databases, Redis
instances, KMS keys, OIDC applications, dashboards, or log sinks.

Minimum resources:

| Resource | Staging requirement |
| --- | --- |
| Domain/TLS | `provider.staging.<domain>`, `console.staging.<domain>`, and dashboard domain behind HTTPS |
| Postgres | Managed Postgres 16+, encrypted at rest, backups enabled, restricted network access |
| Redis | Managed Redis 7+, TLS/auth where supported, restricted network access |
| Secret manager | Platform secret store, AWS Secrets Manager, GCP Secret Manager, Vault, or equivalent |
| Sui RPC | Production-like Testnet/Mainnet RPC endpoint with monitoring and quota owner |
| OIDC | Separate staging app/client, issuer, audience, JWKS URL, role claim mapping |
| KMS/HSM/Vault | Separate Ed25519 signing key/version for receipts, with IAM scoped to signer service only |
| Observability | Prometheus-compatible scrape or collector, centralized JSON logs, alert routing |
| Backups | Automated DB backup plus a documented restore test |

Staging should normally target Sui Testnet until a mainnet launch is approved.
If staging points at Mainnet, treat every signer and merchant address as
production-grade and get explicit approval first.

## 3. Secret Manager Values

Store these as secret-manager entries or platform-managed secrets and inject
them into the relevant service at runtime:

| Secret | Service | Notes |
| --- | --- | --- |
| `SUI402_POSTGRES_URL` | provider API | Managed Postgres URL for provider payment/challenge records |
| `SUI402_CONSOLE_POSTGRES_URL` | console API | Managed Postgres URL for console state and audit logs |
| `SUI402_INDEXER_POSTGRES_URL` | indexers | Usually the same DB as console/provider, but injected explicitly |
| `SUI402_REDIS_URL` | provider API | Managed Redis URL for challenges, rate limits, receipt sequence durability |
| `SUI402_ADMIN_API_KEY` | provider API | Long random provider admin key; rotate before production |
| `SUI402_CONSOLE_OPERATOR_KEYS_JSON` | console API | Break-glass/service keys only when OIDC is also configured |
| `SUI402_CONSOLE_OIDC_ISSUER` | console API | Exact issuer URL from the staging OIDC app |
| `SUI402_CONSOLE_OIDC_AUDIENCE` | console API | Audience expected in operator JWTs |
| `SUI402_CONSOLE_OIDC_JWKS_URL` | console API | HTTPS JWKS endpoint; must be reachable by console API |
| `SUI402_CONSOLE_OIDC_ROLE_CLAIM` | console API | Claim containing `viewer`, `merchant_admin`, `exporter`, `indexer`, or `admin` roles |
| `SUI402_RECEIPT_SIGNER_ID` | provider/console | Sui address recorded as the receipt signer |
| KMS/Vault key reference | signer service | Cloud-specific key id/ARN/resource name; do not expose private key material |
| Walrus publisher credentials | console API | Only if staging exercises Walrus exports |

Non-secret config such as service names, ports, package IDs, coin type, resource
scope, and public dashboard API URL can live in deployment config, but keep the
same review process as secrets because mistakes can route traffic to the wrong
network or merchant.

Real talk: `VITE_*` values are public browser bundle inputs. Only put public
URLs there, for example `VITE_SUI402_CONSOLE_API_URL`. Never put admin keys,
operator keys, database URLs, OIDC client secrets, KMS references, or private
keys in `VITE_*`.

## 4. Configure Hosted Services

Provider API:

```text
NODE_ENV=production
PORT=4020
SUI402_NETWORK=sui:testnet
SUI402_GRPC_URL=https://your-staging-sui-grpc.example
SUI402_SESSION_PACKAGE_ID=0x...
SUI402_SETTLEMENT_PACKAGE_ID=0x...
SUI402_MERCHANT_ADDRESS=0x...
SUI402_COIN_TYPE=0x2::sui::SUI
SUI402_PRICE=1000000
SUI402_RESOURCE_SCOPE=api:*
SUI402_SERVICE_NAME=sui402-provider-api-staging
SUI402_REDIS_URL=<secret>
SUI402_POSTGRES_URL=<secret>
SUI402_RUN_STORAGE_MIGRATIONS=true
SUI402_ADMIN_API_KEY=<secret>
```

Console API:

```text
NODE_ENV=production
PORT=4030
SUI402_CONSOLE_STORAGE_DRIVER=postgres
SUI402_CONSOLE_POSTGRES_URL=<secret>
SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS=true
SUI402_CONSOLE_PROVIDER_BASE_URL=https://console.staging.<domain>
SUI402_CONSOLE_CORS_ORIGINS=https://dashboard.staging.<domain>
SUI402_CONSOLE_TESTNET_GRPC_URL=https://your-staging-sui-grpc.example
SUI402_CONSOLE_OIDC_ISSUER=https://issuer.example/staging
SUI402_CONSOLE_OIDC_AUDIENCE=sui402-console-staging
SUI402_CONSOLE_OIDC_JWKS_URL=https://issuer.example/staging/.well-known/jwks.json
SUI402_CONSOLE_OIDC_ROLE_CLAIM=roles
SUI402_CONSOLE_OIDC_SUBJECT_CLAIM=sub
SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM=merchant_ids
```

Dashboard:

```text
VITE_SUI402_CONSOLE_API_URL=https://console.staging.<domain>
```

Indexers:

```text
SUI402_INDEXER_SOURCE=grpc
SUI402_INDEXER_SINK=postgres
SUI402_INDEXER_POSTGRES_URL=<secret>
SUI402_INDEXER_INTERVAL_MS=30000
SUI402_INDEXER_GRPC_START_CHECKPOINT=<checkpoint-from-deployment>
```

For public fullnodes, checkpoints may be pruned. Final staging should use an
archive-capable source, dedicated fullnode, or a documented checkpoint start
within the provider's retention window.

## 5. OIDC/JWKS Expectations

Configure a staging OIDC application before exposing the console API:

1. Set issuer, audience, and JWKS URL exactly as emitted by the provider.
2. Map operator groups to console roles:
   - `viewer` for read-only dashboards and summaries
   - `merchant_admin` for merchant/listing/application changes
   - `exporter` for Walrus/payment/receipt exports
   - `indexer` for trusted indexer ingestion
   - `admin` only for named break-glass operators
3. Use short token TTLs and require MFA for human operators.
4. Map seller portal users to `seller_viewer` or `seller_admin` and include
   only their allowed merchant ids in the seller merchant claim
   (`merchant_ids` by default).
5. Verify an operator token against `/v1/overview`, then verify a write route with the
   least role that should be allowed.
6. Verify a seller token can access its own merchant route but cannot access a
   different merchant route.
7. Keep static `SUI402_CONSOLE_OPERATOR_KEYS_JSON` entries scoped and expiring.
   They are service or break-glass credentials, not the default human login.

See `docs/console-api.md` and
`docs/runbooks/console-operator-key-rotation.md` for role and rotation details.

## 6. External Receipt Signer Expectations

Receipt signer rules for staging:

- `SUI402_RECEIPT_SIGNER_ID` must be the Sui address recorded as the settlement
  signer when receipts are settled on-chain.
- The signing key must live in KMS/HSM/Vault or an equivalent signer service.
- The provider/console process must not receive raw private key material.
- Verify one known receipt signature against the signer public key before
  routing traffic.
- Rotation must use a new signer id or a documented key-version boundary, and
  old public keys must remain trusted through receipt TTL plus dispute window.

Important implementation detail: the stock local Compose path can set local PEM
receipt signing, but cloud KMS clients are wired through the importable provider
API/custom hosted service path described in `docs/provider-api.md` and
`docs/receipts.md`. Do not claim a KMS-backed staging sign-off just because
`SUI402_RECEIPT_SIGNER_PROVIDER=external` is present in an env file; prove that
the deployed service actually signs through the external signer.

## 7. Deploy And Smoke Test

Before deploying:

```powershell
npm run launch:check
npm run production:certify
```

Those commands validate local gates. They do not prove hosted staging.

After the hosted deployment:

1. Confirm DNS and TLS:
   - `https://provider.staging.<domain>/health/ready`
   - `https://console.staging.<domain>/health/ready`
   - dashboard HTTPS URL
2. Confirm provider discovery:
   - `https://provider.staging.<domain>/.well-known/sui402`
   - package id, network, merchant, coin type, price, and scope match the
     staged deployment record.
3. Confirm console OIDC:
   - read route succeeds with `viewer`
   - merchant write succeeds only with `merchant_admin` or `admin`
   - wrong audience/issuer/expired token fails
4. Confirm payment flow:
   - first protected request returns `402`
   - client pays on Sui Testnet
   - retry returns `200`
   - payment record appears in Postgres-backed ledger
5. Confirm receipts if enabled:
   - receipt is signed by the KMS-backed signer
   - signature verifies locally
   - settlement/reconciliation path is exercised
6. Confirm indexers:
   - session-spend and settlement workers advance durable cursors
   - reconciliation report has no unexpected exceptions
7. Confirm observability:
   - readiness and `/metrics` are scraped internally
   - logs show request IDs and no secrets
   - alerts fire in a controlled test
8. Confirm backup/restore:
   - backup job exists
   - one restore test has been run into an isolated database

## 8. Rollback And Recovery

Rollback must be a hosted deployment operation, not a database reset:

- Keep the previous image/tag deployable.
- Run backward-compatible DB migrations only, or prepare a tested rollback
  migration before deploy.
- Pause indexers before rolling back if the schema or package id changed.
- Do not delete staging Postgres or Redis to "fix" replay/challenge issues; that
  destroys the exact evidence staging is meant to catch.
- Preserve logs, audit records, payment records, and signer evidence for failed
  staging deploys.

## 9. Staging Sign-Off Evidence

Record the final sign-off in `docs/deployments.md` or a dated release note:

- deployed image tags/digests
- DNS names and TLS owner
- Postgres/Redis resource names
- secret manager path names, not secret values
- OIDC issuer/audience/JWKS URL and role mapping
- KMS/HSM/Vault key reference and signer id
- Sui RPC endpoint owner and package ids
- start checkpoints and latest indexer cursors
- smoke-test transaction digests, receipt ids, settlement digests
- backup restore evidence
- dashboard/alert links
- open risks and explicit production blockers

If any of the readiness-bar items are missing, call the environment what it is:
a hosted demo or partial staging environment. That is still useful, but it is
not production-like staging.
