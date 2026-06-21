# Console API

`@sui402/console-api` is the backend surface for the hosted dashboard.

It composes:

- gateway merchant configuration
- merchant application submission and review
- registry listings
- payment ledger summaries
- finance/support settlement summaries
- operator audit events for sensitive actions
- chain-indexed session spend summaries
- readiness state
- mounted `/gateway` and `/registry` routers

## Run Locally

```bash
npm run dev:console-api
```

The API starts on port `4030` by default.

Hosted gateway verification uses Sui gRPC. Multi-network deployments can set:

```text
SUI402_CONSOLE_MAINNET_GRPC_URL=https://your-mainnet-grpc.example
SUI402_CONSOLE_TESTNET_GRPC_URL=https://your-testnet-grpc.example
SUI402_CONSOLE_DEVNET_GRPC_URL=https://your-devnet-grpc.example
SUI402_CONSOLE_LOCALNET_GRPC_URL=http://127.0.0.1:9000
```

Run the dashboard against it:

```bash
$env:VITE_SUI402_CONSOLE_API_URL="http://127.0.0.1:4030"
npm run dev:dashboard
```

## Routes

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`
- `GET /v1/overview`
- `GET /v1/marketplace/apis`
- `GET /v1/marketplace/apis/:apiId`
- `GET /v1/scan/stats`
- `GET /v1/scan/payments/:digest`
- `GET /v1/scan/merchants/:merchantId`
- `GET /v1/scan/sessions/:sessionId`
- `GET /v1/scan/settlements/:settlementId`
- `GET /v1/indexer/session-spends`
- `GET /v1/indexer/sessions`
- `POST /v1/indexer/session-spends`
- `GET /v1/indexer/settlement-events`
- `POST /v1/indexer/settlement-events`
- `POST /v1/publisher/apis/draft`
- `GET /v1/publisher/apis/:applicationId/status`
- `POST /v1/publisher/apis/:applicationId/probe`
- `POST /v1/merchant-applications`
- `GET /v1/merchant-applications`
- `POST /v1/merchant-applications/:applicationId/verify`
- `POST /v1/merchant-applications/:applicationId/review`
- `GET /v1/seller/merchants/:merchantId`
- `PATCH /v1/seller/merchants/:merchantId`
- `GET /v1/seller/merchants/:merchantId/change-requests`
- `POST /v1/seller/merchants/:merchantId/change-requests`
- `GET /v1/merchant-change-requests`
- `POST /v1/merchant-change-requests/:requestId/review`
- `GET /v1/audit-events`
- `GET /v1/audit-events/verify`
- `POST /v1/merchants`
- `GET /v1/exports`
- `GET /v1/exports/:exportId`
- `POST /v1/exports/payment-ledger/walrus`
- `POST /v1/exports/receipts/walrus`
- `POST /v1/exports/audit-head/walrus`
- `GET /v1/settlements`
- `GET /v1/settlements.csv`
- `GET /v1/settlement-reconciliation`
- `GET /v1/settlement-reconciliation.csv`
- `/gateway/*`
- `/registry/*`

`GET /v1/marketplace/apis` is a public, read-only discovery endpoint for
marketplace and agent search surfaces. It accepts `q`, `network`, `transport`,
`tag`, and `limit` query params and returns compact API cards with price,
network, transport, session support, protected resource URL, and payment stats.
The response is versioned with `schemaVersion: "sui402.marketplace.v1"` and
includes `generatedAt`, `dataSource`, `count`, `limit`, and `hasMore`. Search is
applied before the visible response limit so a matching listing is not hidden by
the first page of unrelated APIs.
Each card also includes a `links` object with stable API paths and, when
`SUI402_CONSOLE_PROVIDER_BASE_URL` is configured, absolute URLs for the JSON
detail, public marketplace page, merchant scan API, and public scan page. Agents
should prefer those links over reconstructing routes by convention.

Public marketplace and scan routes are protected by a shared public-read rate
limit and short cache headers. By default, each IP/user-agent bucket gets 600
public reads per 60 seconds per surface (`marketplace` and `scan` have separate
buckets). Successful responses include `Cache-Control: public, max-age=15,
stale-while-revalidate=60`; set
`SUI402_CONSOLE_PUBLIC_READ_CACHE_SECONDS=0` to disable public caching and
`SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX=0` to disable this app-level public
read limiter in controlled environments. Keep an edge/CDN limiter in front of
hosted production.

All non-public console routes default to `Cache-Control: no-store` with
`Pragma: no-cache`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`. This includes publisher draft/session/status
responses, operator overview/list/review routes, seller routes, exports, audit,
indexer ingestion, and CSV downloads. Public marketplace/scan routes keep their
short public cache and do not inherit the private no-store policy.

Each API card includes `readiness`, a machine-readable promotion signal for
agents and UI:

- `readiness.ready`: true only when the listing is active, the gateway merchant
  exists and is active, listing/merchant payment terms match, protected access is
  configured, advertised session metadata is consistent, and at least one
  verified paid-test payment has been recorded for the listing.
- `readiness.level`: `ready`, `needs_review`, or `paused`.
- `readiness.reasons`: human-readable blockers when the API should not be
  promoted as ready.
- `readiness.checks`: per-gate evidence for dashboards and scan-style detail
  views.

Each card also includes `reliability`, a public-safe evidence summary for
agents that need more than a pass/fail gate:

- `reliability.paidTestObserved`: true when at least one verified payment record
  is indexed for the listing.
- `reliability.verifiedPayments`, `sessionPayments`, and `oneShotPayments`:
  aggregate payment evidence counts.
- `reliability.firstVerifiedPaymentAt` and `lastVerifiedPaymentAt`: the
  observed public evidence window, when known.
- `reliability.recentIndexedPayments`: how many recent public evidence rows are
  included in this response.

These are evidence signals, not authorization. Agents must still verify the live
`402` challenge, local wallet policy, network, recipient, coin type, resource,
and amount before signing.

Example:

```bash
curl "http://127.0.0.1:4030/v1/marketplace/apis?q=weather&network=sui:testnet"
```

`GET /v1/marketplace/apis/:apiId` returns the public detail view for one active
listing. It includes the same public API card, sanitized merchant summary, trust
checks, readiness checks, copyable `sui402-pay` commands, aggregate stats, up to
ten sanitized recent payments, the same `reliability` summary, and links to
protected/session/scan surfaces. It
intentionally does not expose private upstream configuration, request payloads,
payment headers, static admin keys, or seller-only change metadata.
The detail `links` object mirrors the API card links and adds protected resource
and session manager URLs when those public entrypoints exist.

`GET /marketplace/:apiId` serves the crawler-visible public page for one API.
The page includes Open Graph/Twitter metadata, a JSON `rel="alternate"` link,
core facts, a copyable `sui402-pay` command, launch-readiness checks, the agent
path, and a public-safety section that states what is redacted. It is safe to
share and must not expose private upstream config, headers, cookies, admin keys,
verification tokens, request bodies, or signer material.

`GET /v1/scan/stats` is a public, read-only ecosystem summary for scan/explorer
surfaces. It returns aggregate API counts, seller counts, verified payment
counts, session counts, network/coin breakdowns, and sanitized recent payment
metadata. The response is versioned with `schemaVersion: "sui402.scan.v1"` and
includes `generatedAt` and `dataSource`. Recent payments include the full
indexed digest plus a `displayDigest` for UI rendering. It intentionally does
not expose request payloads or secrets.
Stats and recent payment records include `links` with stable API paths and
absolute public URLs where the console base URL is configured.

Public marketplace and scan JSON are covered by an automated field-policy guard
in the console API test suite. The guard fails when a known private/operator key
appears anywhere, when raw payer/sender/submitter identities appear outside the
explicit `identityRedaction` labels, or when a new public JSON leaf path is
introduced without being added to the allowed policy matrix. This keeps new
marketplace/scan fields intentional instead of accidentally turning public
explorer surfaces into request logs.

`GET /v1/scan/payments/:digest` is a public, read-only payment detail endpoint
for explorer surfaces. Pass `?network=sui:testnet` when the caller knows the
target network. Production stores use direct digest lookup rather than relying
on the latest recent-payment window; memory/dev stores keep a bounded fallback.
It returns sanitized payment metadata: digest, network, payment kind, challenge
id, merchant id, recipient, coin type, amount, resource, timestamp, optional
session id, and optional receipt id/signer/sequence/expiry. It does not expose
request bodies, private upstream data, or secrets.
The `links` object points to the payment JSON endpoint and crawler-visible
public payment page. When the payment is attributed to a merchant, it also
includes merchant scan and marketplace links.

`GET /scan/payment/:digest` serves the crawler-visible public payment evidence
page. It includes a JSON `rel="alternate"` link, sanitized facts, the CLI lookup
command, an evidence-class section, and the same public-safety redaction policy
used by the marketplace page.

`GET /v1/scan/merchants/:merchantId` is a public, read-only merchant/listing
detail endpoint. It returns public merchant fields, the marketplace card,
payment/session counts, volume, and up to ten sanitized recent payments.
The top-level `links` object points to the merchant JSON endpoint,
crawler-visible merchant scan page, and marketplace page.

`GET /scan/merchant/:merchantId` serves the crawler-visible public merchant
evidence page. It labels whether a marketplace listing and gateway merchant were
found and summarizes verified payment evidence without rendering private
upstream configuration.

`GET /v1/scan/sessions/:sessionId` is a public, read-only session explorer
endpoint backed by indexed session-spend events. It returns aggregate session
spend totals, first/last seen timestamps, resource scope hashes, and up to 25
sanitized spend records. It does not expose private request payloads.
The `links` object points to the session JSON endpoint and crawler-visible
public session page.

`GET /scan/session/:sessionId` serves the crawler-visible public session
evidence page. It summarizes indexed session spends, spend count, and observed
resource-scope hashes without rendering private request data.

`GET /v1/scan/settlements/:settlementId` is a public, read-only settlement
explorer endpoint. The identifier may be an indexed settlement event id,
transaction digest, ledger id, or receipt id. Production stores use direct
identifier lookup rather than relying on the latest settlement-event window. It
returns sanitized on-chain settlement metadata such as ledger id, receipt id,
amount, merchant, submitter, and indexed timestamp.
The `links` object points to the settlement JSON endpoint and crawler-visible
public settlement page.

`GET /scan/settlement/:settlementId` serves the crawler-visible public
settlement evidence page. It labels the settlement provenance and renders ledger
or receipt identifiers only when they are available.

`POST /v1/merchants` creates both a gateway merchant and a registry listing.
Use it for trusted operator-created merchants.

For seller onboarding, use `POST /v1/merchant-applications`. Submitting an
application does not create a live gateway merchant or registry listing. A
`merchant_admin` must approve the application through
`POST /v1/merchant-applications/:applicationId/review` before the merchant is
published.

For a URL-first publisher UX, use `POST /v1/publisher/apis/draft`. This is the
friendlier "Add your API" route: it accepts a flat upstream URL, payout wallet,
and optional pricing metadata; derives a merchant id/service name when omitted;
then returns the pending application, gateway preview, and exact ownership proof
steps. It still does not publish the API until publisher verification and
operator review pass.

For a copy/paste publisher flow that covers add, ownership verification, public
listing inspection, unpaid challenge checks, and paid-test probing, see
[`docs/publisher-onboarding.md`](publisher-onboarding.md). Keep that guide as the
publisher-facing runbook; keep this file as the route contract.

Drafts may include `openApiUrl` pointing at a JSON OpenAPI document. The console
fetches it with the same upstream URL safety checks, extracts method/path
metadata, and returns `preview.openApi` with endpoint counts and suggested
resource scopes. This is an onboarding assist only: it does not auto-price,
auto-publish, or change the selected `resourceScope`.

Drafts may also include an optional OpenAPI operation selection:

- `openApiOperationId`
- or both `openApiMethod` and `openApiPath`

When the selected operation is found in the imported preview and the publisher
did not explicitly provide `resourceScope`, the draft uses the operation's
suggested scope as the reviewable `request.resourceScope`. The selected endpoint
is persisted as metadata and returned as `preview.selectedOpenApiEndpoint` so
publishers and operators can see which operation shaped the draft. This still
does not publish or approve the API; it only makes the draft more precise.

Draft responses also include `preview.reviewDraft` when the console has a
provider base URL. This is a review-only candidate for the gateway merchant
config and registry listing that would be created on approval. It is built with
the same gateway/registry constructors used by live writes, but it is not stored
in the merchant or listing stores. The `gates` array keeps the remaining publish
requirements explicit: ownership verification, operator review, and real
paid-test evidence.

Operator-facing application list and overview responses include the same
review-only draft on each application as `reviewDraft`, so review queues can show
the exact candidate config without recomputing it in the browser.

For production publisher onboarding, treat `preview.openApi` as a review aid,
not as an authority source. It helps the UI show "we found these operations" and
offer candidate resource scopes, but the publisher still needs to prove upstream
ownership, choose the actual paid surface, confirm price/coin/network, and pass
operator review before anything is published. The current importer intentionally
does not follow remote refs, infer authentication requirements, validate every
operation against the live upstream, or generate gateway/registry records.

Hosted public intake can also enforce operator-controlled host policy before a
draft/application is accepted:

- `SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS`: optional comma-separated
  allowlist. When set, every upstream/OpenAPI host in a public intake request
  must match one entry.
- `SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS`: optional comma-separated
  blocklist. Blocked hosts override the allowlist.

Entries are exact lowercase hostnames like `api.partner.example` or wildcard
suffixes like `*.trusted.example`. The policy is applied to
`POST /v1/publisher/apis/draft` and upstream-backed
`POST /v1/merchant-applications`; violations return `403` with
`public_intake_host_blocked` or `public_intake_host_not_allowed`.

Roadmap items to make this x402scan-easy:

- let the publisher pick one or more imported operations from the preview
- map selected operations to resource scopes, pricing units, and examples
- generate reviewable gateway merchant config and registry listing drafts
- add a guided unpaid `402` probe plus paid `sui402-pay curl` test call
- keep ownership verification, abuse review, and paid-test evidence as publish
  gates

Draft submission:

```json
{
  "apiUrl": "https://api.example.com/v1/search",
  "openApiUrl": "https://api.example.com/openapi.json",
  "openApiOperationId": "search",
  "merchant": "0x...",
  "price": "1000000",
  "coinType": "0x2::sui::SUI",
  "applicantEmail": "seller@example.com"
}
```

Draft response includes:

- `application`
- `preview.protectedResourcePath`
- `preview.verificationUrl`
- `preview.openApi` when `openApiUrl` was provided, including
  `endpointCount`, `suggestedEndpoints`, and `suggestedResourceScopes`
- `preview.selectedOpenApiEndpoint` when a matching OpenAPI operation was
  selected
- `preview.reviewDraft` with the review-only gateway merchant candidate,
  registry listing candidate, and publish gates
- `nextSteps.verificationDocument`
- `nextSteps.steps`
- `nextSteps.phase`
- `nextSteps.readyForReview`
- `nextSteps.selfServeActions`
- `nextSteps.operatorActions`

The next-step contract intentionally separates publisher-owned work from
operator-gated work:

- `phase: "verify_ownership"` means the publisher still needs to host the
  well-known proof and run verification.
- `phase: "operator_review"` with `readyForReview: true` means ownership proof
  is verified and an operator can approve or reject.
- `phase: "published"` means a merchant/listing was created and agents can use
  marketplace discovery.
- `selfServeActions` are safe to show in a public publisher portal.
- `operatorActions` describe gated review work; they are workflow labels, not
  public authorization to approve.
- `check_status` and `probe_readiness` commands can still send the private
  publisher access token in the `x-sui402-publisher-token` header for CLI
  compatibility, but browser/portal flows should first exchange that long-lived
  token for a short-lived publisher session and then use
  `Authorization: Bearer $SUI402_PUBLISHER_SESSION`.
- The publisher access token is separate from the public ownership verification
  nonce hosted in `.well-known` or DNS TXT. Public verification nonces do not
  grant session/status/probe access.
- When `SUI402_CONSOLE_PROVIDER_BASE_URL` is configured, those commands use
  absolute URLs so publisher UIs can offer copy/paste status and probe calls
  without asking users to manually assemble the host. Status/probe routes do not
  accept `?token=` because query secrets leak into logs, browser history,
  referrers, screenshots, and observability tools.

Create a short-lived publisher session:

```bash
curl -X POST \
  -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"ttlSeconds":900}' \
  "http://127.0.0.1:4030/v1/publisher/apis/application-1/session"
```

The response returns `publisherSessionToken`, `expiresAt`, and copyable
Bearer-authenticated status/probe commands. Session tokens are signed with the
current publisher access token; rotating the publisher access token invalidates
outstanding sessions.

Publishers can poll a draft with:

```bash
curl -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" \
  "http://127.0.0.1:4030/v1/publisher/apis/application-1/status"
```

The status route is intended for publisher UX convenience and returns the same
application, preview, next-step shape, and `publisherAuth` context. Treat it as
a workflow helper, not as seller authentication for privileged changes.

If an application was created before private publisher access tokens existed, or
if a publisher token may have been copied into a log/screenshot, an operator can
rotate it:

```bash
curl -X POST \
  -H "x-sui402-admin-key: $SUI402_OPERATOR_KEY" \
  "http://127.0.0.1:4030/v1/merchant-applications/application-1/publisher-access-token/rotate"
```

The response returns `publisherAccessToken` once. Store it in a secret manager
or provide it to the publisher as `SUI402_PUBLISHER_TOKEN`; the audit log records
the rotation event without storing the raw token. Public verification nonces do
not grant status/probe access.

After verification and operator approval, publishers can run a readiness probe:

```bash
curl -X POST \
  -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" \
  "http://127.0.0.1:4030/v1/publisher/apis/application-1/probe"
```

The probe returns `ready`, per-gate checks, the published manifest/listing
context, and an `unpaidProbe` preview showing the protected resource URL and the
HTTP `402` challenge shape that an unpaid request should receive. The previewed
challenge is not issued into the replay store; a live unpaid request to the
protected URL receives a fresh challenge.

`paidProbe` reports paid-test evidence from verified payment records. It does
not fake a payer transaction. Before a real paid test call, `paidProbe.supported`
is `false`, `paidProbe.evidence.status` is `missing`, `gatewayReady` may be
`true`, and the top-level `ready` remains `false`. After a signed one-shot or
session payment is verified and attributed to the merchant/listing,
`paidProbe.supported` becomes `true`, `ready` can become `true`, and the evidence
includes counts, volume, and recent payment digests. Treat missing paid evidence
as a private-beta/public launch blocker even when the gateway/listing checks are
otherwise healthy.

When the API is published, `paidProbe.nextAction` includes a copyable
non-custodial test command:

```bash
sui402-pay curl https://console.example.com/gateway/merchants/weather/pay --max-one-shot-amount 1000
```

The command caps one-shot fallback spend at the listed API price. The publisher
or operator still needs a local Sui wallet on the API network with gas.

The same probe also returns `paidTestWizard`, a UI/agent-friendly checklist for
the exact publisher paid-test flow. It includes:

- `currentGate` and ordered `steps` for ownership/listing verification, unpaid
  `402` confirmation, capped paid call, and rerunning the probe;
- copyable `commands` for status, rerun probe, unpaid challenge, paid call,
  marketplace detail, and scan merchant lookup when those resources exist;
- `safety` notes that make the non-custodial wallet, max-spend cap, and limits
  of this evidence explicit.

`paidTestWizard.readyForPublicLaunch` is still evidence-driven. It only becomes
true after verified payment evidence exists; the wizard does not simulate payment
or imply that uptime, legal/KYB fitness, refunds, or external audit are complete.

Application submission:

```json
{
  "id": "application-1",
  "request": {
    "id": "seller-api",
    "service": "Seller API",
    "merchant": "0x...",
    "coinType": "0x2::sui::SUI",
    "price": "1000000",
    "resourceScope": "api:*",
    "transport": "http"
  },
  "applicant": {
    "email": "seller@example.com",
    "organization": "Seller Co"
  }
}
```

If the request includes `upstreamUrl`, the console creates a pending publisher
verification challenge. The submit response includes `application` plus
`nextSteps`, including the exact verification document to host. The application
verification section includes:

```json
{
  "verification": {
    "method": "well-known",
    "status": "pending",
    "verificationUrl": "https://api.example.com/.well-known/sui402-publisher.json",
    "dnsTxtName": "_sui402-publisher.api.example.com",
    "dnsTxtValue": "sui402=publisher-verification-v1;applicationId=application-1;merchantId=seller-api;upstreamUrl=https://api.example.com/v1/search;token=sui402v_...",
    "expectedUpstreamUrl": "https://api.example.com/v1/search",
    "token": "sui402v_...",
    "accessToken": "sui402p_..."
  }
}
```

The `nextSteps.verificationDocument` mirrors the JSON that must be hosted at
`verificationUrl`, and `nextSteps.steps` is safe to show directly in a publisher
portal. Do not host or publish `application.verification.accessToken`; use it
only as a private header credential for publisher status/probe calls. Prefer
`nextSteps.selfServeActions` and `nextSteps.operatorActions` for structured UI
checklists.

Raw publisher access tokens are only returned on explicit creation and rotation
responses. Later publisher status, public verification, operator list/review,
and overview responses replace the raw token with `accessTokenPresent` and
`accessTokenHash` markers so dashboards can reason about token state without
redistributing bearer secrets.

Invalid publisher credentials on session/status/probe routes are rate-limited
per application and client bucket. Tune
`SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX` and
`SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS`; set the max to `0` only in
controlled local environments. Valid publisher access-token or short-lived
session requests are not counted against the failed-auth bucket.

The default proof path is to host this JSON at `verificationUrl`:

```json
{
  "sui402": "publisher-verification-v1",
  "applicationId": "application-1",
  "merchantId": "seller-api",
  "upstreamUrl": "https://api.example.com/v1/search",
  "verificationToken": "sui402v_..."
}
```

As a fallback, the publisher can publish the exact DNS TXT record from
`nextSteps.dnsTxtName` and `nextSteps.dnsTxtValue`, for example:

```text
_sui402-publisher.api.example.com TXT "sui402=publisher-verification-v1;applicationId=application-1;merchantId=seller-api;upstreamUrl=https://api.example.com/v1/search;token=sui402v_..."
```

Then call:

```bash
curl -X POST "http://127.0.0.1:4030/v1/merchant-applications/application-1/verify"
```

Operators cannot approve upstream-backed applications until verification status
is `verified`. The verification route tries the well-known JSON proof first and
then the DNS TXT fallback. This prevents publishing someone else's API URL
through the gateway proxy while giving publishers a path when they control DNS
but cannot easily serve `.well-known` JSON.

Publishers can call `POST /v1/publisher/apis/preview` with the same draft body
as `POST /v1/publisher/apis/draft` to inspect the derived merchant id,
OpenAPI endpoint suggestions, selected resource scope, review-only
gateway/listing candidate, and id conflicts before creating anything. The
preview response is token-free and non-mutating.

After a refresh or long review delay, publishers resume with
`GET /v1/publisher/apis/:applicationId/status` using either a short-lived
`Authorization: Bearer $SUI402_PUBLISHER_SESSION` token or the private
`x-sui402-publisher-token` bootstrap token. The public `.well-known`/DNS
verification token is not accepted for status/session/probe routes.

Publishers can also attach payout wallet proof:

```bash
curl -X POST "http://127.0.0.1:4030/v1/merchant-applications/application-1/wallet-proof" \
  -H "content-type: application/json" \
  -d '{
    "message": "Sui402 publisher payout wallet proof\napplicationId=application-1\nmerchantId=seller-api\npayoutWallet=0x...\nnetwork=sui:testnet\ncoinType=0x2::sui::SUI\nprice=1000000\nresourceScope=api:seller-api\nupstreamUrl=https://api.example.com/v1/search",
    "signature": "..."
  }'
```

The signature must be a Sui personal-message signature from the application
`request.merchant` payout wallet over the exact current application terms.
Successful proof stores `walletProof` evidence with the address, method,
timestamp, and hashes of the message/signature. It does not replace upstream
ownership verification for proxied APIs; operators still cannot approve an
upstream-backed application until `.well-known` or DNS verification is
`verified`.

Review:

```json
{
  "action": "approve",
  "reviewer": "ops@example.com",
  "reason": "KYB complete"
}
```

Use `"action": "reject"` to close an application without publishing a merchant.

Sensitive console writes record audit events after the durable state change:
merchant creation, merchant application submission/review, trusted session-spend
ingestion, seller-scoped merchant updates, and Walrus exports. `GET
/v1/audit-events` is admin-only in
production because it can expose operator ids, request ids, IP addresses, user
agents, target ids, and operational metadata.

Audit metadata is sanitized at event creation before hashing or storage. Secret
shaped fields such as authorization headers, cookies, passwords, API keys,
publisher access/session tokens, verification tokens, raw request bodies, and
private-key material are replaced with `[redacted:audit-secret]`. Hash/digest
fields such as `accessTokenHash` are preserved so operators still have useful
forensic evidence without retaining raw credentials.

New audit events are hash chained with `previousHash` and `hash`. Use
`GET /v1/audit-events/verify` to recompute the recent chain and detect missing
or mutated events inside the checked window.

Audit query parameters:

- `action`
- `actorId`
- `targetType`
- `targetId`
- `limit`

Example:

```bash
curl "http://127.0.0.1:4030/v1/audit-events?targetType=merchant_application&limit=50" \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY"
```

The indexer routes are admin-protected in production and expose chain-observed
`SessionSpent<T>` activity after records are ingested by an indexer process.
Settlement event routes expose chain-observed `ReceiptSettled<T>` and
`BatchSettled<T>` activity from the Phase 6 settlement ledger module.

Merchant creation accepts an optional `paymentPolicy` object using the
`@sui402/policy` shape. The hosted gateway enforces it after proof verification
and before challenge consumption, ledger recording, receipt issuance, or access
grant:

```json
{
  "id": "session-only-api",
  "service": "Session Only API",
  "merchant": "0x...",
  "coinType": "0x2::sui::SUI",
  "price": "1000000",
  "resourceScope": "api:*",
  "sessionPackageId": "0x...",
  "paymentPolicy": {
    "requireSession": true,
    "allowOneShot": false,
    "allowedResourceScopes": ["api:*"]
  }
}
```

In production, set:

```text
SUI402_CONSOLE_ADMIN_API_KEY=change-this-long-random-secret
SUI402_CONSOLE_OPERATOR_KEYS_JSON=[{"id":"ops-viewer","key":"viewer-secret-with-length","roles":["viewer"]}]
SUI402_CONSOLE_SELLER_KEYS_JSON=[{"id":"atlas-owner","key":"seller-secret-with-length","merchantIds":["atlas-api"],"roles":["seller_admin"]}]
SUI402_CONSOLE_OIDC_ISSUER=https://issuer.example
SUI402_CONSOLE_OIDC_AUDIENCE=sui402-console
SUI402_CONSOLE_OIDC_JWKS_URL=https://issuer.example/.well-known/jwks.json
SUI402_CONSOLE_OIDC_ROLE_CLAIM=roles
SUI402_CONSOLE_OIDC_SUBJECT_CLAIM=sub
SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM=merchant_ids
SUI402_CONSOLE_STORAGE_DRIVER=postgres
SUI402_CONSOLE_POSTGRES_URL=postgres://sui402:sui402@localhost:5432/sui402
SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS=true
SUI402_WALRUS_PUBLISHER_URL=https://publisher.walrus.example
SUI402_WALRUS_EPOCHS=5
```

Without `SUI402_CONSOLE_ADMIN_API_KEY`, `SUI402_CONSOLE_OPERATOR_KEYS_JSON`, or
a complete OIDC configuration, production startup fails. In local/test mode,
writes are open when no keys or OIDC settings are configured to keep development
friction low.

## Operator Auth

`SUI402_CONSOLE_ADMIN_API_KEY` remains a legacy superuser key. For production,
prefer OIDC or role-scoped operator keys:

```json
[
  {
    "id": "ops-viewer",
    "key": "viewer-secret-with-length",
    "roles": ["viewer"],
    "notBefore": "2026-06-01T00:00:00.000Z",
    "expiresAt": "2026-09-01T00:00:00.000Z"
  },
  {
    "id": "merchant-ops",
    "key": "merchant-secret-with-length",
    "roles": ["merchant_admin"]
  },
  {
    "id": "finance",
    "key": "export-secret-with-length",
    "roles": ["viewer", "exporter"]
  },
  {
    "id": "indexer",
    "key": "indexer-secret-with-length",
    "roles": ["indexer"]
  }
]
```

Roles:

- `viewer`: read overview, exports, indexed session spends, session aggregates,
  and settlement summaries.
- `merchant_admin`: create merchants/listings and access mounted gateway or
  registry admin routes; list and review merchant applications.
- `exporter`: publish payment-ledger, receipt-bundle, and audit-head exports to
  Walrus.
- `indexer`: ingest normalized session spend records.
- `admin`: superuser role for all console actions; read audit events.

Requests authenticate with either:

```text
Authorization: Bearer <operator-key>
x-sui402-admin-key: <operator-key>
```

OIDC/JWKS authentication accepts RS256 or ES256 Bearer JWTs. The token must
match the configured issuer and audience, pass `exp`/`nbf` checks, verify
against the JWKS endpoint, and expose console roles through
`SUI402_CONSOLE_OIDC_ROLE_CLAIM`. The role claim can be an array or a
space/comma-separated string using the same role names above. The operator id
comes from `SUI402_CONSOLE_OIDC_SUBJECT_CLAIM`.

For static operator-key rotation, add the replacement key before the old key
expires, set `notBefore` on the new key if needed, and set `expiresAt` on the old
key. Expired or not-yet-valid keys authenticate as unauthorized.

Use `npm run console:operator-key` to generate role-scoped static keys and merge
them into `SUI402_CONSOLE_OPERATOR_KEYS_JSON`. See
`docs/runbooks/console-operator-key-rotation.md` for the rotation runbook.

Real talk: OIDC gives you centralized operator and seller identity, but it does
not replace network-level controls, short token lifetimes, least-privilege role
assignment, access review, and audit log review.

## Seller Auth

Seller-scoped access is configured separately from operator access with
`SUI402_CONSOLE_SELLER_KEYS_JSON`:

```json
[
  {
    "id": "atlas-owner",
    "key": "seller-secret-with-length",
    "merchantIds": ["atlas-api"],
    "roles": ["seller_admin"],
    "notBefore": "2026-06-01T00:00:00.000Z",
    "expiresAt": "2026-12-01T00:00:00.000Z"
  },
  {
    "id": "atlas-support",
    "key": "seller-view-secret-with-length",
    "merchantIds": ["atlas-api"],
    "roles": ["seller_viewer"]
  }
]
```

Seller requests authenticate with either:

```text
Authorization: Bearer <seller-key>
x-sui402-seller-key: <seller-key>
```

For hosted seller portals, prefer OIDC/JWKS Bearer JWTs over static seller keys.
Seller OIDC tokens use the same issuer, audience, JWKS URL, subject claim, and
role claim as operator OIDC. Include `seller_viewer` or `seller_admin` in
`SUI402_CONSOLE_OIDC_ROLE_CLAIM`, and include allowed merchant ids in
`SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM` (default `merchant_ids`). The
merchant claim may be an array or space/comma-separated string and may contain
`*` only for deliberately broad seller accounts.

Example seller JWT claims:

```json
{
  "iss": "https://issuer.example",
  "aud": "sui402-console",
  "sub": "seller-user-1",
  "exp": 1780000000,
  "roles": ["seller_admin"],
  "merchant_ids": ["atlas-api"]
}
```

Seller roles:

- `seller_viewer`: read the assigned merchant's seller page, listing, stats, and
  recent sanitized payments through `GET /v1/seller/merchants/:merchantId`.
- `seller_admin`: includes `seller_viewer` and can update constrained merchant
  fields through `PATCH /v1/seller/merchants/:merchantId`.

Allowed seller update fields:

```json
{
  "service": "Atlas API Pro",
  "price": "2000000",
  "resourceScope": "api:market-feed",
  "upstreamUrl": "https://api.example.com/v1/search",
  "upstreamTimeoutMs": 15000,
  "sessionPackageId": "0x...",
  "status": "paused"
}
```

Seller updates intentionally cannot change payout wallet (`merchant`), network,
coin type, or a different upstream URL. Treat those as high-risk
ownership/payment/control changes and route them through an operator-reviewed
change workflow with a fresh publisher ownership proof where applicable. Seller
updates append
`seller.merchant.update` audit events with seller id, seller roles, request id,
target merchant, and changed field names.

High-risk merchant changes use dedicated request/review routes:

- `GET /v1/seller/merchants/:merchantId/change-requests`
  - requires `seller_viewer` for that merchant.
  - lists the seller-visible high-risk change requests for the merchant.
- `POST /v1/seller/merchants/:merchantId/change-requests`
  - requires `seller_admin` for that merchant.
  - accepts only payout wallet, network, and coin type changes.
  - returns `202` with a pending request and does not mutate the live merchant
    or registry listing.
- `GET /v1/merchant-change-requests`
  - requires operator `merchant_admin`.
  - supports `merchantId`, `status`, and `limit` query filters.
- `POST /v1/merchant-change-requests/:requestId/review`
  - requires operator `merchant_admin`.
  - approves or rejects a pending request.

Seller submission example:

```bash
curl -X POST "http://127.0.0.1:4030/v1/seller/merchants/atlas-api/change-requests" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SUI402_SELLER_KEY" \
  -H "x-request-id: merchant-change-submit-1" \
  -d '{"id":"atlas-payout-rotation-1","changes":{"merchant":"0x..."},"reason":"Rotate payout wallet after key ceremony"}'
```

Operator review example:

```bash
curl -X POST "http://127.0.0.1:4030/v1/merchant-change-requests/atlas-payout-rotation-1/review" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SUI402_MERCHANT_ADMIN_KEY" \
  -H "x-request-id: merchant-change-approve-1" \
  -d '{"action":"approve","reason":"Wallet ownership verified"}'
```

Request body shape:

```json
{
  "id": "atlas-payout-rotation-1",
  "changes": {
    "merchant": "0x...",
    "network": "sui:testnet",
    "coinType": "0x2::sui::SUI"
  },
  "reason": "Rotate payout wallet after key ceremony"
}
```

Approval responses include `reviewEvidence`. Ownership/upstream checks can be
complete at approval time, but `reviewEvidence.paidTest.status` is
`pending_post_publish`: the gateway/listing must exist before a real payer
wallet can produce paid-call evidence through the publisher probe.

Only include the fields being changed. The API rejects no-op requests and
overlapping pending requests for the same merchant and high-risk field. Network
changes for session-enabled merchants are blocked until the session package is
reviewed separately, because a session package id is network-specific.

Audit actions:

- `seller.merchant_change.request`
- `merchant_change.approve`
- `merchant_change.reject`

Approval rebuilds and stores both the gateway merchant config and registry
listing from the reviewed high-risk values. Rejection records review state and
leaves the live merchant/listing untouched.

Real talk: static seller keys are a backend RBAC foundation, not the final hosted
login UX. A launch-grade dashboard should put OIDC/passkey/session auth in front
of these same merchant-scoped permissions instead of handing raw long-lived keys
to normal sellers.

## Storage

The console API supports two local storage drivers:

- `memory`: fastest for development, but all merchants, applications, change
  requests, listings,
  challenges, payment records, audit events, and indexed session spends
  disappear on restart.
- `file`: durable single-node JSON storage for local production rehearsals when
  Redis/Postgres or Docker are unavailable.
- `postgres`: durable multi-node storage for merchants, merchant applications,
  merchant change requests,
  listings, challenges, consumed challenge replay state, payment records,
  indexed session spends, audit events, and Walrus export history.

File storage is intentionally a bridge, not the final multi-node production
ledger. It preserves local state across restarts, but it should be replaced with
database-backed stores before running a high-volume hosted gateway.

Postgres storage uses these table names by default:

```text
SUI402_CONSOLE_MERCHANT_TABLE=sui402_console_merchants
SUI402_CONSOLE_LISTING_TABLE=sui402_console_listings
SUI402_CONSOLE_CHALLENGE_TABLE=sui402_challenges
SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE=sui402_consumed_challenges
SUI402_CONSOLE_PAYMENT_RECORD_TABLE=sui402_payment_records
SUI402_CONSOLE_SESSION_SPEND_TABLE=sui402_session_spend_events
SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE=sui402_settlement_events
SUI402_CONSOLE_EXPORT_TABLE=sui402_console_exports
SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE=sui402_merchant_applications
SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE=sui402_merchant_change_requests
SUI402_CONSOLE_AUDIT_TABLE=sui402_console_audit_events
SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX=20
SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS=60000
SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX=30
SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS=60000
SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX=600
SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_WINDOW_MS=60000
SUI402_CONSOLE_PUBLIC_READ_CACHE_SECONDS=15
SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS=72
```

Set `SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS=true` when the process should create
or update those tables at startup.

## Indexed Sessions

The console API can display session activity observed from Sui events, separate
from provider-local payment records.

List raw indexed spends:

```bash
curl "http://127.0.0.1:4030/v1/indexer/session-spends?limit=50"
```

List session-level aggregates:

```bash
curl "http://127.0.0.1:4030/v1/indexer/sessions?merchant=0x..."
```

Ingest normalized records from a trusted indexer or local script:

```bash
curl -X POST "http://127.0.0.1:4030/v1/indexer/session-spends" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY" \
  -d '{"records":[{"id":"tx:0","network":"sui:testnet","packageId":"0x...","coinType":"0x2::sui::SUI","txDigest":"tx","eventSeq":"0","sessionId":"0x...","merchant":"0x...","amount":"1000","challengeId":"...","resourceScopeHash":"...","indexedAt":"2026-05-19T00:00:00.000Z"}]}'
```

Real talk: this route is for trusted operator ingestion, not open public writes.
The hosted production path should use a database-backed indexer store directly.

List indexed settlement events:

```bash
curl "http://127.0.0.1:4030/v1/indexer/settlement-events?ledgerId=0x..." \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY"
```

Ingest normalized settlement records from a trusted settlement indexer:

```bash
curl -X POST "http://127.0.0.1:4030/v1/indexer/settlement-events" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY" \
  -d '{"records":[{"id":"tx:0","network":"sui:testnet","packageId":"0x...","coinType":"0x2::sui::SUI","txDigest":"tx","eventSeq":"0","kind":"receipt","ledgerId":"0x...","receiptId":"...","payer":"0x...","merchant":"0x...","signer":"0x...","amount":"1000","sequence":"1","resourceScopeHash":"...","submitter":"0x...","indexedAt":"2026-05-19T00:00:00.000Z"}]}'
```

For direct chain reconciliation, `sui402-indexer sync --event-kind settlement`
can write the same records to the Postgres settlement table without going through
the HTTP ingestion route.

The indexer can also use the console as its authenticated sink:

```bash
SUI402_INDEXER_SINK=console-http \
SUI402_INDEXER_CONSOLE_URL=http://127.0.0.1:4030 \
SUI402_INDEXER_CONSOLE_API_KEY="$INDEXER_OPERATOR_KEY" \
sui402-indexer sync --event-kind settlement
```

Cursor state is managed through:

- `GET /v1/indexer/cursors/:cursorKey`
- `PUT /v1/indexer/cursors/:cursorKey`

Both routes require the `indexer` role in production. Cursor updates are written
to the console audit log. File and Postgres console storage preserve cursors
across worker and console restarts.

Real talk: merchant application submission is intentionally public-friendly, but
production deployments still need abuse controls. The console API includes a
per-process intake rate limit for `POST /v1/merchant-applications`; set
`SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX=0` to disable it in controlled
environments. Multi-node production should enforce the same control at the edge
or with shared storage, and still add CAPTCHA or identity checks and email
verification before opening broad seller intake. New applications receive a
configurable `reviewDueAt` deadline from
`SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS`; the dashboard highlights pending
applications after that deadline.

Application and publisher-draft responses also include an `abuseControls`
object for operator handling. It records the review SLA, public intake
rate-limit posture, whether host allow/block policy is configured, required
review checks, a pending application rejection route, a published merchant pause
route, and escalation links for the operator queue and audit trail. Treat this
as repo-level abuse workflow evidence; broad production intake still needs
external identity/KYB/sanctions/CAPTCHA or invite controls where your risk model
requires them.

Real talk: hash chaining detects mutation inside this console's event stream.
`POST /v1/exports/audit-head/walrus` verifies the selected recent chain window
and publishes only its boundary IDs, predecessor hash, event count, and head
hash to Walrus. This provides external evidence without publishing sensitive
operator metadata. A production retention policy may additionally mirror these
artifacts to object-lock storage.

## Walrus Exports

`POST /v1/exports/payment-ledger/walrus` publishes the current payment ledger as
a Sui402 `audit-log` artifact through a Walrus publisher endpoint. The console
stores the returned `blobId`, optional object id, and artifact id so operators
can retrieve the export later.

Request body:

```json
{
  "limit": 100,
  "merchantId": "atlas-api",
  "epochs": 5
}
```

`merchantId` is optional. If omitted, the export contains the latest payments
across all merchants.

Real talk: this exports payment proof records, not signed spend receipts. Use
the receipt export endpoint for payment records that include signed session
spend receipts.

`POST /v1/exports/receipts/walrus` publishes signed session spend receipts that
are attached to payment records. It returns `400 no_receipts` when the selected
payments do not contain signed receipts.

`GET /v1/exports/:exportId` returns stored export metadata for an already
published Walrus export, including blob id, optional object id, artifact id,
payment count, and operator metadata.

## Settlements

`GET /v1/settlements` gives finance and support teams a reconciliation view over
verified payment records. It groups payments by merchant, recipient, network,
and coin type, and returns both summary rows and recent payment drill-down rows.
Use `GET /v1/settlements.csv` with the same query parameters to download the
payment drill-down rows as CSV.

Query parameters:

- `merchantId`
- `network`
- `coinType`
- `limit`

Example:

```bash
curl "http://127.0.0.1:4030/v1/settlements?merchantId=atlas-api&limit=100" \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY"
```

Each summary includes `paymentCount`, `sessionPaymentCount`,
`oneShotPaymentCount`, `receiptCount`, `totalAmount`, first/last payment
timestamps, and the latest matching payment-ledger Walrus export blob when one
is known.

`GET /v1/settlement-reconciliation` compares signed receipt-bearing payment
records against indexed on-chain `ReceiptSettled<T>` events:
Use `GET /v1/settlement-reconciliation.csv` with the same query parameters to
download the exception-first reconciliation rows as CSV.

```bash
curl "http://127.0.0.1:4030/v1/settlement-reconciliation?merchantId=atlas-api&limit=100" \
  -H "authorization: Bearer $SUI402_CONSOLE_ADMIN_API_KEY"
```

The response includes a `summary` and ordered exception-first `rows`.
Statuses:

- `settled`: exactly one indexed receipt event matches the signed receipt.
- `unsettled`: a signed receipt exists but no indexed settlement event exists.
- `mismatched`: a receipt event exists but amount, payer, merchant, signer,
  sequence, coin, network, or resource-scope hash differs.
- `duplicate`: more than one indexed receipt event exists for the same receipt
  id.
- `orphaned`: an indexed receipt event has no matching local payment receipt.

Real talk: this is operational evidence, not a legal settlement finality oracle.
It proves what this console can compare: verified local receipts versus indexed
Move events. Production settlement still needs escrowed fund movement, finality
windows, dispute rules, and a chain retention strategy.
