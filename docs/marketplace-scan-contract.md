# Marketplace + Sui402Scan Launch Contract

Last updated: 2026-06-19

This is the next product contract for the public marketplace, publisher intake,
buyer-agent discovery, and Sui402Scan-style explorer. It is intentionally
launch-blocking and agent-readable. UI polish is secondary until these contracts
are stable.

## Non-negotiables

- Public marketplace and scan responses must be versioned, stable, and safe for
  automated agents to consume without scraping HTML.
- A listing is not "ready" unless ownership proof, protected `402` behavior,
  paid-test evidence, payment terms, session metadata, and moderation state all
  pass.
- Public pages must never expose private keys, seed phrases, payment headers,
  cookies, raw authorization headers, raw request bodies, private upstream
  configuration, unpublished operator notes, or secret-bearing verification
  tokens.
- Public scan must label provenance. "Indexed on-chain event", "gateway receipt",
  "signed receipt", "settlement record", and "publisher metadata" are different
  evidence classes.
- Dashboard, CLI, and public JSON must agree on readiness and headline scan
  counts for the same environment.
- New Sui reads should use GraphQL RPC for dashboard/flexible historical views,
  gRPC/checkpoint ingestion for live/indexer paths, or a custom indexer when the
  query shape requires it. Do not add new JSON-RPC dependencies.

## Publisher surface: what must be exposed next

The publisher flow should feel close to x402/pay.sh onboarding, but it must be
stricter because Sui402 is proxying real upstream APIs and settling real funds.

### Human portal fields

Every publisher-facing application/detail page must show:

- application id, merchant id, listing id, status, and review state
- upstream URL, protected resource URL, transport, and selected OpenAPI
  operation when imported
- `.well-known/sui402-publisher.json` instructions and DNS TXT fallback
- payout wallet, network, coin type, atomic price, decimals/display price, and
  resource scope hash
- current readiness gates with pass/fail reason and required next action
- exact unpaid probe URL and expected `402 Payment Required` result
- exact paid-test command with max spend and session/one-shot behavior, plus the
  paid-test wizard's current gate, ordered steps, and safety notes
- public marketplace link and scan link after publish
- wallet, price, upstream, network, coin, and listing-status change history

### Agent-readable publisher contract

Publisher status/probe responses should expose a compact object like:

```json
{
  "schemaVersion": "sui402.publisher-readiness.v1",
  "applicationId": "application-1",
  "merchantId": "seller-api",
  "listingId": "seller-api-weather",
  "phase": "verify_ownership",
  "readyForPublish": false,
  "gates": [
    {
      "id": "ownership",
      "status": "blocked",
      "evidence": "well_known_or_dns_txt_required",
      "nextAction": "host_well_known_json"
    }
  ],
  "paymentTerms": {
    "network": "sui:testnet",
    "coinType": "0x2::sui::SUI",
    "amountAtomic": "1000000",
    "decimals": 9,
    "resourceScope": "GET https://api.example.com/v1/weather"
  },
  "links": {
    "status": "/v1/publisher/apis/application-1/status",
    "probe": "/v1/publisher/apis/application-1/probe"
  }
}
```

The exact field names can evolve only with a schema-version bump. Agents need
the gates, payment terms, and links without parsing prose.

### Publisher launch-blocking checklist

- [x] Seller auth/session layer exists; browser code does not carry static
      seller/admin keys. First-pass publisher session exchange exists for
      status/probe calls, and seller routes now accept short-lived OIDC/JWKS
      Bearer JWTs with `seller_viewer`/`seller_admin` roles plus merchant-scoped
      claims. Hosted account provisioning, access reviews, and IdP policy
      evidence remain serious-launch operations work.
- [x] Ownership proof is verified before operator approval is possible.
      Operator review fails closed until `.well-known` or DNS ownership proof is
      verified for upstream-backed publisher applications.
- [x] OpenAPI import can map selected operations to resource scopes and price
      units without publishing automatically. The publisher preview endpoint and
      dashboard endpoint picker let publishers choose an operation before a
      draft becomes an application.
- [x] Paid-test wizard records real signed proof/session spend evidence. Public
      readiness only turns ready after indexed payment evidence matching the
      current listing terms exists.
- [x] Wallet, upstream URL, network, coin type, price, and status changes create
      reviewable audit events through merchant application review, payout wallet
      proof verification, and seller change-request review flows.
- [x] Abuse controls exist for public intake: throttling, allowlist/blocklist,
      review SLA, takedown path, and escalation notes. Application and publisher
      draft responses now expose a safe `abuseControls` contract with review
      SLA, rate-limit posture, host-policy posture, required review checks,
      reject/pause takedown routes, and audit/escalation pointers. CAPTCHA,
      KYB, sanctions, and identity-provider evidence remain external launch
      work, not repo-complete abuse prevention.

## Buyer agent contract: what marketplace discovery must expose next

The buyer-agent contract is the most important launch surface. If an agent
cannot decide safely from JSON alone, the marketplace is not ready.

### Required listing card fields

Each public marketplace card should expose:

- `schemaVersion`
- `apiId`, `listingId`, `merchantId`, `publisherName`, `name`, `description`
- `status` and `readiness.ready|level|reasons|checks`
- `network`, `chainId` if available, `coinType`, `amountAtomic`, `decimals`,
  and display price
- `transport`: `http` or `mcp`
- protected URL or MCP endpoint
- `resourceScope` and `resourceScopeHash`
- session support: supported, manager URL, max per request, total cap, expiry
  model, and whether one-shot fallback is allowed
- trust signals: ownership verified, paid test verified, last health check,
  uptime/reliability window, recent verified payments, moderation state
- `reliability`: public-safe evidence summary with `paidTestObserved`,
  verified/session/one-shot payment counts, first/last verified payment
  timestamps, recent indexed evidence count, and short notes. This is evidence,
  not payment authorization.
- stable links: JSON detail, public page, merchant scan, protected resource,
  session manager, terms/support, and CLI command templates

### Required agent decision rules

Agents should be able to apply these rules without special casing Sui402 UI:

- Do not pay when `readiness.ready` is false.
- For CLI consumers, also honor `agentSafety.shouldAutoPay` from
  `sui402-pay marketplace detail <api-id> --json`. It fails closed when
  readiness is missing/false/paused, no protected endpoint is published, or
  verified paid-call evidence is missing. If `reliability.paidTestObserved` is
  explicitly false, agents should treat the listing as not autopay-safe.
- Do not pay when requested network, coin type, resource scope, or amount does
  not exactly match the listing and the live `402` challenge.
- Treat paid-test/reliability evidence as current-terms evidence only. A
  payment counts toward marketplace readiness when its recorded challenge and
  payment resource match the current listing network, merchant wallet, coin
  type, atomic price, resource scope, and resource-scope hash. Historical
  payments can stay visible in scan without making a changed listing autopay
  safe.
- Prefer a bounded session when supported and within local policy.
- Refuse one-shot fallback when it exceeds local max spend or the listing marks
  one-shot fallback as disabled.
- Show the payer address, merchant recipient, coin, amount, max session spend,
  and challenge expiry before signing.
- Treat public marketplace metadata as discovery only; payment authorization is
  the live signed challenge plus local policy checks.

### Buyer launch-blocking checklist

- [x] Marketplace search/detail, `sui402-pay search`, and `sui402-pay curl`
      consume the same versioned listing/readiness contract. Agreement tests now
      cover public JSON, crawler-visible pages, CLI output, and dashboard render
      surfaces for marketplace and scan records.
- [x] Copyable commands include explicit network, max spend, session behavior,
      and protected endpoint. Marketplace search/detail now expose bounded
      `sui402-pay curl ... --max-one-shot-amount <atomic>` commands, optional
      `--session-only` and session-inspection commands, plus a machine-readable
      `paymentPlan` with network, merchant, coin, amount, resource scope/hash,
      and session behavior.
- [x] Challenge validation fails closed for wrong network, wrong merchant,
      wrong coin, wrong resource scope, stale challenge id, expired challenge,
      invalid amount, and unsupported session terms.
- [ ] Clean-machine setup evidence exists for one funded testnet paid call.
      The repo now includes `npm run rehearsal:evidence:check -- --file
      <evidence.md>` so funded rehearsal notes must prove concrete session,
      receipt, settlement, indexer cursor/checkpoint, and reconciliation fields
      before this item is accepted.
- [x] Errors explain the next safe action without printing secrets or payment
      headers. Public field-policy and token-leak guards cover marketplace/scan
      JSON, audit metadata, publisher token responses, and release checks.

## Explorer page contract: what Sui402Scan must expose next

The explorer should copy x402scan's transparency, not its privacy risks. The
public page is evidence for a payment ecosystem, not a request-log viewer.

### Required public pages

- API/listing page: readiness, price, transport, publisher, protected endpoint,
  session support, health, verified paid-test state, and public scan links.
- Merchant page: public merchant identity, listings, payment/session aggregates,
  settlement posture, and moderation state.
- Payment page: digest, network, merchant, amount, coin, resource hash, payment
  kind, challenge id, timestamp, receipt/session references, and provenance.
- Session page: session id, merchant, network, coin, aggregate spend, scope
  hashes, first/last seen, expiry if public, and sanitized spend rows.
- Settlement page: settlement identifier, ledger/receipt ids, amount, merchant,
  submitter, digest/checkpoint when available, and reconciliation status.

Current implementation: the console API serves crawler-visible marketplace,
payment, merchant, session, and settlement pages with sanitized facts, copyable
`sui402-pay` commands, JSON `rel="alternate"` links, public-safety redaction
sections, first-pass readiness/evidence sections, and marketplace reliability
facts derived from indexed verified payments. A first-pass agreement
test now checks seeded marketplace detail, scan stats, payment detail, merchant
scan, plus custom session and settlement scan flows across public JSON, public
HTML pages, `sui402-pay` output, and dashboard server-rendered marketplace/scan
cards. File-backed durability coverage now proves public marketplace/scan
records survive app/store recreation. Remaining work is richer layout depth,
row-level evidence labels, and deployed Postgres/staging agreement coverage.

### Required evidence labels

Every detail row should identify its evidence class:

- `onchain_indexed`: derived from Sui checkpoint/event ingestion
- `gateway_verified`: accepted by the gateway verifier
- `signed_receipt`: signed by a configured receipt signer
- `settlement_record`: derived from receipt/batch settlement indexing
- `publisher_claim`: self-reported metadata, not payment evidence
- `operator_assertion`: moderated/operator-entered status

### Required redactions

Public explorer views must redact:

- raw payer identity unless policy explicitly permits it for that view
- raw request body, query payloads, private headers, cookies, and auth headers
- upstream private origin/configuration that is not already public
- unpublished review notes, abuse reports, and risk scoring internals
- verification tokens and operator/admin URLs

Current implementation note: public session and settlement scan JSON plus
crawler-visible pages redact raw payer-side identities and expose stable
`sha256:` hashes with `identityRedaction` metadata for public correlation.
Payment records attach compact `gateway_verified` / `signed_receipt` evidence
labels from the console gateway path. Session spend records redact
`payer`/`sender` and attach `onchain_indexed` evidence labels from the Sui402
indexer path. Settlement records redact `payer`/`signer`/`submitter`/`sender`
and attach a compact `settlement_record` evidence object from the Sui402 indexer
path. Privileged operator/indexer routes may retain raw identities for
reconciliation and abuse review.

The console API agreement tests also run a reusable public-surface policy guard
over marketplace search/detail and scan stats/payment/merchant/session/
settlement JSON. The guard blocks private/operator fields such as upstream
origin config, static access tokens, request bodies/headers, payment policy
internals, session package ids, and raw payer/sender/submitter identities while
allowing explicit `identityRedaction` labels and stable public hashes.

### Explorer launch-blocking checklist

- [x] Seeded public scan stats and CLI scan stats agree for the same memory
      store/environment.
- [x] Dashboard marketplace and scan cards server-render the same core fields
      used by the public JSON/CLI agreement tests.
- [ ] Production/durable-store public scan stats and CLI scan stats agree for
      the same deployed environment.
      Use `npm run scan:agreement:check -- --url <console-api-url>` after the
      durable store is deployed; the checker fetches `/v1/scan/stats` directly
      and through `sui402-pay scan stats --json` and compares public totals,
      network/coin/transport buckets, volume, and recent payment digests.
- [x] Each payment/session/settlement page includes digest or cursor/checkpoint
      evidence when available, plus clear labels when evidence is gateway-local
      only. Payment JSON/pages label gateway-local or signed-receipt evidence by
      digest; session and settlement JSON/pages/CLI now expose indexer cursor
      keys, checkpoint cursors, event offsets, and updated-at metadata when the
      indexer cursor store has state.
- [x] Not-yet-indexed or unknown records return safe `404` pages with `noindex`.
      Marketplace, payment, merchant, session, and settlement public HTML routes
      now render crawler-visible safe-not-found pages with requested identifiers,
      JSON alternate links, short public cache headers, and no raw JSON/stack or
      private config leakage.
- [x] Public marketplace/scan JSON field policy is documented and tested for
      seeded and file-backed public read models. The automated guard has two
      layers: known private/operator/raw identity fields are forbidden anywhere,
      and every exposed public JSON leaf path must match the allowed policy
      matrix. Remaining work is mirroring this evidence against deployed
      Postgres/staging surfaces and documenting the operator-only matrix.
- [x] Reconciliation pages do not imply escrow, refund guarantees, complete
      settlement finality, or external audit unless evidence exists. Settlement
      and reconciliation JSON now include operational caveats, the dashboard
      renders those caveats beside reconciliation counts, and public settlement
      pages include explicit evidence-limit copy.

## Read/indexing contract

- Marketplace/search/detail can start from durable console storage and GraphQL
  RPC where flexible joins are useful.
- Scan evidence should retain checkpoint sequence, transaction digest, event
  index/cursor, source, ingestion timestamp, and indexer version where
  available.
- Live session/settlement ingestion should prefer gRPC checkpoint streams or a
  custom indexer pipeline once public traffic needs reliability beyond periodic
  GraphQL polling.
- Any custom indexer pipeline must support backfill, cursor persistence,
  idempotent upserts, replay, and lag reporting.

## Immediate build order

1. Freeze the marketplace listing/readiness JSON shape and extend agreement
   tests beyond seeded console API/HTML/`sui402-pay detail`/dashboard render
   coverage to durable-store environments.
2. Freeze scan JSON field policy and extend agreement tests beyond seeded/custom
   stats, payment, merchant, session, settlement, public JSON/public HTML/
   `sui402-pay scan`/dashboard render coverage to durable-store environments.
3. Extend the first-pass publisher paid-test wizard from contract/dashboard
   rendering into the full seller portal, and keep paid-test evidence as a hard
   readiness gate.
4. Split public marketplace/scan pages from publisher/operator dashboard auth
   surfaces.
5. Deepen the current public evidence pages into richer marketplace/scan
   layouts after the JSON contracts and agreement tests are stable.
