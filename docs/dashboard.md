# Sui402 Dashboard

`@sui402/dashboard` is the hosted console skeleton for operating Sui402 as a
real product.

Current surface:

- overview KPIs
- payment activity table with status filtering
- provider manifest and readiness panels
- Walrus export history panel
- Walrus ledger and receipt export actions
- settlement reconciliation summary for settled, unsettled, and exception counts
- public marketplace search with network and transport filters
- copyable `sui402-pay curl` commands for agent access
- public scan/explorer lookup for payments, merchants, sessions, and settlements
- operator review queue for merchant applications
- operator review queue for high-risk merchant payout, network, and coin changes
- merchant onboarding form
- environment toggle
- responsive sidebar layout
- optional console API integration through `VITE_SUI402_CONSOLE_API_URL`

Run locally:

```bash
npm run dev:dashboard
```

Build:

```bash
npm run build -w @sui402/dashboard
```

By default the dashboard runs with local seed data. To connect it to the console
API, first start:

```bash
npm run dev:console-api
```

Then set:

```bash
$env:VITE_SUI402_CONSOLE_API_URL="http://127.0.0.1:4030"
npm run dev:dashboard
```

Do not put console admin or operator keys in `VITE_*` variables. Vite bundles
those values into browser JavaScript. The production dashboard build fails if
`VITE_SUI402_CONSOLE_ADMIN_API_KEY` is set; use OIDC/JWKS or a backend session
layer for hosted production dashboard auth.

The Walrus export panel reads `exports` from `GET /v1/overview`, shows recent
payment-ledger, receipt-bundle, or audit-head blob ids, and can call the console export
routes when the API has a Walrus publisher configured.

The settlement panel reads grouped payment summaries plus
`settlementReconciliation` from `GET /v1/overview`. Detailed receipt-level
reconciliation is available from the console API at
`GET /v1/settlement-reconciliation`.

The operator review panels read `merchantApplications` and
`merchantChangeRequests` from `GET /v1/overview`. Application approval uses
`POST /v1/merchant-applications/:applicationId/review`; high-risk merchant
change approval uses `POST /v1/merchant-change-requests/:requestId/review`.
The latter is intentionally separated from normal seller edits because payout
wallet, network, and coin type changes affect where funds settle and how agents
price a listing.

Seller submission for high-risk changes should live behind seller auth or a
backend session layer, not a raw seller key embedded in the browser bundle. The
dashboard currently exposes the operator review side of that workflow.

The public "Add your API" form uses `POST /v1/publisher/apis/draft` when the
console API is configured. It sends a flat publisher draft payload, receives the
pending application, renders the gateway preview, and shows the exact
`.well-known/sui402-publisher.json` verification document plus next steps. This
keeps onboarding URL-first while preserving the verification and operator review
gates before a listing becomes live.
The same card also exposes the DNS TXT fallback returned by the console so a
publisher can prove control through `_sui402-publisher.<host>` when serving a
well-known JSON document is awkward.
The form can include a JSON OpenAPI URL and an optional `operationId`. When that
operation is found in the imported preview, the response shows the selected paid
operation and uses its suggested resource scope for the draft unless the
publisher manually overrides the Resource scope field.
After submission, the verification card also shows a review-only gateway
merchant and marketplace listing candidate. This lets publishers and operators
inspect the exact config that approval would create while keeping ownership
verification, operator review, and paid-test evidence as separate gates.
The card also shows a payout wallet proof message. A publisher can copy it,
sign it as a Sui personal message with the payout wallet, and paste the
signature back into the dashboard. This proves wallet control for operator
review, but it does not replace `.well-known` or DNS ownership proof for
upstream-backed APIs.
The operator application review queue receives the same review-only candidate
from the overview API, so reviewers can compare the upstream URL, resource
scope, protected URL, price, coin, and remaining gates before approving.

After submission, the same card can exchange the private publisher access token
through `POST /v1/publisher/apis/:applicationId/session`, then call
`POST /v1/publisher/apis/:applicationId/probe` with
`Authorization: Bearer $SUI402_PUBLISHER_SESSION`. The private access token is a
bootstrap secret, separate from the public `.well-known`/DNS TXT verification
nonce, and the dashboard prefers short-lived publisher sessions for browser
status/probe calls. After the initial draft/create or explicit rotation
response, console status/list/review/overview responses expose only
`accessTokenPresent` and `accessTokenHash` markers instead of the raw bearer
token. Token-bearing and privileged console responses are served with
`Cache-Control: no-store`; only public marketplace/scan read surfaces use short
public caching. The probe renders each readiness gate, the expected unpaid HTTP
`402` protected resource URL, and the reason a paid probe still requires a real
wallet-signed proof. This is intentionally a readiness/probe surface, not a fake
paid test.
When the console returns `paidTestWizard`, the card renders the ordered paid-test
wizard too: status, current gate, copyable unpaid/paid/status/probe commands, and
safety notes that keep the payer wallet explicitly non-custodial.

The marketplace panel reads public listings from `GET /v1/marketplace/apis`
when `VITE_SUI402_CONSOLE_API_URL` is configured. It supports search, network
filtering, and HTTP/MCP transport filtering, then exposes a copyable
`sui402-pay curl <endpoint>` command for agents. Without a console API URL, the
dashboard falls back to local preview rows derived from overview data so the UI
still works during design and offline review.

Each marketplace card can open an API detail panel. With a live console API it
fetches `GET /v1/marketplace/apis/:apiId` and renders sanitized trust checks,
copyable `sui402-pay` call/search/scan commands, protected/session links,
aggregate stats, a public-safe reliability summary, and recent indexed payments.
The reliability summary shows whether paid-test evidence has been observed, the
last verified payment timestamp, and how many public evidence rows are included.
In local preview mode, the panel shows only row-level data and does not claim
live indexed evidence.
Marketplace list/detail JSON includes a `links` object with stable API paths and
absolute public page URLs when the console provider base URL is configured.
The panel supports shareable route-style links such as `/marketplace/atlas-api`
and still accepts legacy hash links such as `#marketplace=atlas-api`. Hosted
deployments that serve the dashboard as a static SPA should route those paths
back to `index.html`. Once the detail loads, the browser title, description,
canonical URL, Open Graph, and Twitter summary metadata are updated from the
selected API. Because this is still a static SPA, crawlers that do not execute
JavaScript will only see the base `index.html` metadata.

For crawler-visible public sharing, the console API also serves a public
marketplace evidence/readiness page at `GET /marketplace/:apiId`. It uses the
same sanitized marketplace read model as `GET /v1/marketplace/apis/:apiId`,
includes canonical, Open Graph, Twitter summary metadata, a JSON
`rel="alternate"` link, launch-readiness checks, the agent path, copyable
`sui402-pay` commands, paid-test reliability facts, and a public-safety
redaction section. It does not render private upstream configuration or
secret-bearing fields.

The scan/explorer panel uses the same public console API surface as
`sui402-pay scan`. The top search bar and panel form can inspect:

- `GET /v1/scan/payments/:digest`
- `GET /v1/scan/merchants/:merchantId`
- `GET /v1/scan/sessions/:sessionId`
- `GET /v1/scan/settlements/:settlementId`

The UI renders sanitized indexed evidence: digests, amounts, resources,
merchant/listing context, session spends, receipt metadata, and settlement
events. It does not render request payloads, payment headers, cookies,
authorization headers, or private upstream data. Auto-detection tries known
merchant/listing ids first, then payment, session, and settlement lookup
fallbacks; operators can also force the lookup type.
Public session scan records redact raw payer/sender identities and render stable
`sha256:` hashes plus redaction metadata instead of raw addresses.
Scan JSON records include `links` to the matching API endpoint and
crawler-visible public scan page, so agents and dashboards do not need to
reverse-engineer URL routes.
Scan results expose copyable route-style links such as
`/scan/payment/digest-atlas-1` and still accept legacy hash links such as
`#scanKind=payment&scanId=digest-atlas-1`. Opening either link re-runs the
read-only lookup against the configured console API. Loaded scan records update
the browser title, description, canonical URL, Open Graph, and Twitter summary
metadata with a sanitized payment, merchant, session, or settlement summary.
The metadata intentionally avoids raw request payloads, payment headers,
cookies, authorization headers, and private upstream data.

The console API serves crawler-visible scan pages for the same records:

- `GET /scan/payment/:digest`
- `GET /scan/merchant/:merchantId`
- `GET /scan/session/:sessionId`
- `GET /scan/settlement/:settlementId`

These pages include JSON `rel="alternate"` links, evidence-class sections,
public-safety redaction sections, and copyable `sui402-pay scan` commands. They
share the public read rate limit/cache policy with the JSON scan API and include
a `noindex` marker on not-yet-indexed 404 pages.

Next dashboard steps are authentication, durable console storage for multi-node
deployments, richer public page layouts beyond the current evidence pages, and
richer export status/detail views.

For the next marketplace and Sui402Scan product contract, use
`docs/marketplace-scan-contract.md`. That spec defines the publisher fields,
buyer-agent JSON/readiness contract, explorer evidence labels, redaction policy,
and web/CLI agreement checks that should block public launch before visual
polish.
