# Sui402 Launch-Build Checklist

Last updated: 2026-06-19

This is the execution roadmap for turning the current Sui402 implementation into
a serious product suite: agent wallet/CLI, publisher onboarding, marketplace,
scan/explorer, SDK/dev integration, and launch evidence.

Real talk: the repo already has meaningful protocol, gateway, registry, console,
session, receipt, and indexer foundations. The remaining work is not "invent the
protocol"; it is productizing the buyer and seller journeys, hardening hosted
surfaces, and collecting evidence that the system is safe to expose to real
users and funds.

## Source docs

- `docs/roadmap.md` for the current built/not-built inventory.
- `packages/pay/README.md` for the non-custodial CLI posture.
- `docs/provider-api.md`, `docs/gateway.md`, and `docs/console-api.md` for
  provider, gateway, marketplace, scan, verification, auth, and audit surfaces.
- `docs/registry.md` for marketplace listing primitives.
- `docs/marketplace-scan-contract.md` for the next publisher, buyer-agent, and
  Sui402Scan public contract/checklist.
- `docs/dx.md` and `docs/npm-sdk-release.md` for scaffolding and package
  release expectations.
- `docs/sessions.md` and `docs/receipts.md` for sessions, spend receipts, and
  settlement limits.
- `docs/security-checklist.md`, `docs/production-readiness.md`, and
  `docs/serious-launch-plan.md` for hardening and external evidence gates.

## External product references checked

Checked on 2026-06-18:

- [x402](https://www.x402.org/) / [Coinbase x402 docs](https://docs.cdp.coinbase.com/x402/welcome):
  HTTP-native `402 Payment Required` flow for accountless, programmatic
  stablecoin payments between clients and servers.
- [x402scan](https://www.x402scan.com/) / [x402scan GitHub](https://github.com/Merit-Systems/x402scan):
  ecosystem explorer for x402 servers, transactions, sellers, origins, and
  resources.
- [AgentCash](https://agentcash.dev/) / [AgentCash API directory](https://agentcash.dev/apis):
  one agent wallet/balance, API discovery, pay-per-call access, MCP/x402/MPP
  support, and seller distribution.
- [AgentCash discovery spec](https://agentcash.dev/discovery):
  agent-readable API discovery and SIWX/payment metadata patterns.
- [pay.sh](https://pay.sh/):
  API marketplace and wallet-access surface that prioritizes "no API key" agent
  consumption and category-based discovery.

## Benchmark takeaways for Sui402

The Sui-native version should not be a clone. It should borrow the product
shape, then exploit Sui-specific advantages: object-owned sessions, PTB
composition, cheap parallel user-owned state, zkLogin later for onboarding, and
Walrus/Seal later for paid content distribution.

| Reference | What to copy | What to avoid | Sui402 adaptation |
| --- | --- | --- | --- |
| x402 | HTTP-native payment negotiation, no pre-created account, machine-readable payment requirements. | Treating one-shot onchain transfers as the only serious payment mode. | Keep the `402` flow, but make Sui object-owned sessions the preferred repeated-spend path. |
| x402scan | Public explorer for sellers, resources, transactions, and ecosystem activity. | Leaking payer behavior, raw request payloads, or payment headers in the name of transparency. | Build scan views from indexed Sui events, signed receipts, and aggregate privacy-preserving stats. |
| AgentCash | One agent-facing entrypoint, discovery-first UX, no per-provider API keys, MCP-friendly payment tooling. | Hosted/custodial balance assumptions before Sui402 has audit, compliance, and ops maturity. | Start non-custodial: local Sui signer + bounded sessions + marketplace discovery. |
| pay.sh | Simple catalog, categories, copyable calls, and "agents can spend now" feel. | A marketplace that is only a list and not a trust surface. | Require verified publisher ownership, health stats, pricing metadata, and moderated launch states. |

## Reality snapshot: what exists vs. what does not

This is the short answer for product planning. Sui402 is no longer a toy demo,
but it is also not yet a broad public launch product.

| Area | We have now | We still need |
| --- | --- | --- |
| Agent payments | Local non-custodial signer posture, wallet readiness checks with machine-readable next actions and structured gas-funding actions, marketplace search/detail, scan commands, one-shot/session payment foundations, confirmed session open/fund/close plans, session inspect readiness summaries, session open/fund budget math, and a packaged clean-install proof for `--help`, `init`, `readiness`, and localhost marketplace `search`. | A truly polished `pay.sh`-style happy path: funded testnet proof and even smoother recovery guidance. |
| Agent wallets | User-owned Sui signer via environment-backed key material, Sui CLI keystore discovery for standard Sui key schemes, and local signing. | Better wallet adapters: browser wallet connect later, zkLogin/social wallet later, session funding/closing UX, and recovery guidance. |
| Publisher intake | Merchant applications, URL-first publisher API drafts, optional OpenAPI URL import with endpoint/resource-scope preview, selected-operation hints that can shape the draft resource scope, absolute header-authenticated status/probe next actions, short-lived publisher session exchange for portal/status/probe calls, seller OIDC/JWKS route auth with `seller_viewer`/`seller_admin` roles and merchant-scoped claims, configurable public intake host allow/block policy, review-only gateway/listing config candidates, well-known and DNS TXT upstream ownership verification, Sui personal-message payout wallet proof evidence, operator review, registry/listing primitives, gateway merchant config, post-publish paid-test evidence reporting, and a first-pass paid-test wizard contract/UI with capped non-custodial paid-call commands. | Full self-serve portal account provisioning, OpenAPI-to-config publish automation, wallet-connect signing UX, CAPTCHA/email/identity checks, moderated publishing states, access-review evidence, and real funded environment evidence for the wizard. |
| Marketplace | Public marketplace API, public API detail read model, dashboard catalog/detail panel, route-style and legacy hash detail links, client-side detail metadata, crawler-visible `GET /marketplace/:apiId` evidence/readiness page, agent-readable links to JSON/public/scan surfaces, CLI search, copyable `sui402-pay curl` commands, first-pass console JSON/public page/CLI/dashboard render agreement tests. | Richer full public detail layout, better content depth, ranking, category taxonomy, deeper trust badges, reliability stats, broader discovery versioning, moderation signals, and durable deployed agreement coverage. |
| Scan/explorer | Public scan API routes for stats/payment/merchant/session/settlement, CLI scan lookups, dashboard route-style and legacy hash deep links, client-side sanitized record metadata, crawler-visible scan evidence pages for payment/merchant/session/settlement, agent-readable links on scan records, first-pass stats/payment/merchant/session/settlement JSON/public page/CLI/dashboard render agreement tests, public payer-side identity redaction for sessions/settlements, first-pass evidence labels for payment/session/settlement JSON, and checkpoint/cursor provenance for indexed session/settlement records when cursor state exists. | Richer public explorer layouts, full privacy policy matrix by field, aggregate trends, and durable deployed agreement coverage. |
| Dashboard | Operator console with review/audit/settlement/export panels and no production admin key in the browser bundle. | A clean split between public marketplace, publisher portal, and privileged operator console backed by real human auth, not seller/admin static keys in browser UX. |
| Launch evidence | Release checks, readiness docs, security checklist, runbooks, threat model, certification scripts. | External audits, legal approval, production-like staging, monitoring/on-call, backup/restore drills, KMS/HSM proof, funded rehearsal artifacts, and mainnet governance. |

Important wallet truth: users/agents do need a Sui wallet, but Sui402 should not
pretend that is the whole onboarding story. Non-SUI coin transfers still need a
gas path unless a separate sponsorship/paymaster-like flow exists, and the agent
must have local limits so it cannot spend blindly.

## Product thesis

Sui402 should become the Sui-native way for agents to discover APIs, fund a
bounded user-owned wallet/session, pay per request, and let publishers monetize
APIs without accounts, API keys, subscriptions, or custodial payer funds.

The first serious version should be explicitly non-custodial:

1. Users or agent operators bring or create a Sui wallet.
2. Agents spend through local signing and bounded Sui402 sessions.
3. Publishers onboard through verified API ownership and reviewed listings.
4. Marketplace and scan surfaces make APIs, payments, and ecosystem health
   visible without leaking secrets or raw request payloads.
5. Launch claims are backed by testnet, audit, monitoring, legal, and operational
   evidence.

## Current foundation

- Sui402 `402 Payment Required` protocol schemas, proof verification, challenge
  handling, replay protection, policies, receipts, and Express middleware.
- Client SDK for one-shot and session payment flows, including generic Sui coin
  selection for stablecoin-style payments.
- Sui Move payment sessions with TypeScript transaction builders and session
  spend indexing paths.
- Hosted gateway with upstream proxying, private-header stripping,
  resource-scope policy enforcement, merchant storage interfaces, and SSRF
  guards for merchant upstream URLs.
- Registry/listing primitives and public console API routes for marketplace API
  cards, API detail read models, scan stats, crawler-visible public
  marketplace/scan evidence pages with JSON alternate links, redaction notes,
  readiness/evidence sections, and stable link objects connecting JSON and
  public pages.
- Console API for merchant applications, well-known publisher verification,
  review, settlements, reconciliation, exports, audit events, role-scoped keys,
  and OIDC/JWKS auth.
- `@sui402/pay` CLI foundation for local wallet identity, `curl`, marketplace
  search, scan stats, and read-only session inspection.
- SDK/package release checklist, provider scaffolder, MCP helpers, monitoring,
  incident response, security checklist, threat model, and launch gate tracker.

## Present vs. missing by launch pillar

| Pillar | Already present | Missing for serious launch |
| --- | --- | --- |
| Non-custodial Sui wallet/pay CLI | `@sui402/pay` setup, wallet identity, Sui CLI keystore discovery for ED25519/Secp256k1/Secp256r1, readiness verdicts with checks/next actions, structured SUI gas funding guidance for Testnet/Devnet/Localnet/Mainnet, Testnet faucet guidance that avoids `sui client faucet`, paid `curl`, marketplace search/detail with bounded command rendering, scan stats, session inspection with readiness summaries, session open/fund budget math, session open/fund/close planning and explicit `--yes` submission, `--session-only`, max one-shot fallback cap, challenge id/expiry validation, local challenge-network enforcement, local signer posture, and packaged clean-install docs/proof via `npm run package:clean-install`. | A clean-machine funded golden path, funded end-to-end happy-path evidence, and more ergonomic guided setup. |
| Publisher onboarding ease | Provider manifest, hosted gateway, URL-first publisher drafts, stateless publisher preview endpoint/dashboard endpoint picker before submission, optional OpenAPI URL import with endpoint/resource-scope suggestions, selected OpenAPI operation persistence, dashboard resume flow for existing drafts using application id plus private publisher token kept in memory, payout wallet proof via Sui personal-message signature with safe evidence hashes, absolute header-authenticated status/probe next actions, short-lived publisher session exchange and Bearer status/probe support, seller OIDC/JWKS Bearer support for merchant-scoped seller routes, failed publisher credential throttling for session/status/probe routes, raw publisher access tokens limited to explicit create/rotation responses with sanitized token presence/hash markers everywhere else, no-store headers on token-bearing and privileged console responses, configurable public intake host allow/block policy, safe abuse-control workflow metadata with review SLA, takedown routes, and escalation/audit pointers, review-only gateway/listing config preview in publisher and operator review surfaces, readiness probe for published APIs, post-publish paid-test evidence reporting, copyable paid-test command in the publisher probe, first-pass paid-test wizard contract/UI, paid-test evidence as a public-readiness gate, merchant applications, review workflow, well-known and DNS TXT verification, registry listing primitives, provider scaffolder. | Self-serve seller account provisioning UX, wallet-connect signing UX, OpenAPI-to-config publish automation, richer guided paid-test wizard with live wallet integration, wallet-change review UX, CAPTCHA/email/KYB/identity checks, sanctions/fraud-provider evidence where applicable, access reviews, and funded staging/mainnet evidence. |
| Marketplace | Registry schema/router, public console marketplace API, API detail read model, dashboard marketplace/detail panel with route-style/hash links and client-side detail metadata, crawler-visible `GET /marketplace/:apiId` evidence/readiness page, safe noindex public 404 pages for unknown marketplace records, stable API/public/scan links in JSON, CLI search/detail with agent-safety verdicts, bounded copyable pay/session commands, machine-readable payment plans with network/merchant/coin/amount/resource/session behavior, first-pass console JSON/public page/CLI/dashboard render agreement tests, listing readiness that fails closed until verified paid-test evidence exists and now only counts payments matching current listing network, merchant wallet, coin, price, resource scope, and resource hash, public reliability summaries from verified payment records, file-backed public marketplace/scan durability coverage, public-read rate limits and short cache headers. | Durable searchable marketplace, richer full public detail layout, ranking/moderation, publisher trust badges, live health stats, broader versioned discovery contract, deployed Postgres/staging agreement coverage, MCP discovery polish. |
| Scan/explorer | Console stats, indexed session/settlement/payment stores, direct public payment-digest and settlement-identifier lookup, dashboard scan deep links with client-side sanitized metadata, crawler-visible scan evidence pages, safe noindex public 404 pages for unknown payment/merchant/session/settlement records, stable API/public links in scan JSON, scan commands, first-pass stats/payment/merchant/session/settlement JSON/public page/CLI/dashboard render agreement tests, public session payer/sender redaction with stable hashes, public settlement payer/signer/submitter/sender redaction with stable hashes, first-pass payment/session/settlement evidence labels, checkpoint/cursor provenance for indexed session/settlement records, settlement/reconciliation caveats that avoid escrow/refund/finality/audit overclaims, file-backed public read-model persistence coverage, reconciliation routes, public-read rate limits and short cache headers. | Rich public explorer layouts, full privacy policy by data type, richer digest/event/checkpoint detail views, aggregate ecosystem stats, deployed durable-environment agreement tests, clearer limits on checkpoint/indexer completeness. |
| SDKs and examples | Protocol/client/server/Sui/policy/receipts/storage/indexer/gateway/registry/MCP/pay packages, Express middleware, scaffolder, release checks. | Published package readiness evidence, adapter backlog for Fastify/Hono/Next, more copy-paste examples, API reference docs, provider and agent quickstarts tested from a clean environment. |
| Dashboard roles | Role-scoped operator keys, OIDC/JWKS operator support, OIDC/JWKS seller route support with merchant-scoped claims, dashboard panels for review, settlement, exports, audit events. | Production account/session provisioning UX, least-privilege role matrix, merchant-vs-operator UX split, access review evidence, break-glass policy, no admin secrets in browser bundles. |
| Hardening and launch evidence | Threat model, security checklist, monitoring docs, incident runbooks, production certification scripts, KMS/HSM adapters, audit-log hash chain with write-boundary metadata secret redaction, automated public marketplace/scan field-policy guard that rejects private/operator/raw identity keys and unknown public JSON leaf paths. | External Move/backend audits, counsel-approved legal docs, live KMS smoke tests, staging infra evidence, on-call/paging, backup/restore drills, load test, mainnet governance/custody plan, deployed operator-only field-policy evidence. |

## Phase 1: pay.sh-like non-custodial agent wallet

Goal: make the buyer path feel like `pay curl ...`, while staying user-owned and
Sui-native.

Build next:

- Finish `@sui402/pay` as the default agent entrypoint and polish the clean
  user golden path:
  - install with `npx` or a global package
  - detect or configure a user-owned Sui wallet
  - confirm address, network, gRPC URL, and gas readiness
  - discover one marketplace API
  - make one paid testnet call
  - show receipt/session evidence and the exact spend
  - `sui402-pay setup`
  - `sui402-pay wallet`
  - wallet readiness verdicts with checks and next actions: built
  - structured SUI gas funding guidance in wallet/readiness JSON and human output: built
  - `sui402-pay curl <url>`
  - `sui402-pay search`
  - `sui402-pay scan stats`
  - `sui402-pay session inspect`
  - explicit session open/fund/close commands with plan-before-signing UX
  - one-shot fallback fails closed before signing unless `--max-one-shot-amount`
    or `SUI402_MAX_ONE_SHOT_AMOUNT` sets an explicit cap: built
  - paid API and session state-changing transactions run Sui simulation preflight
    before signing so gas/object/Move failures surface before local approval:
    built
  - paid API and session state-changing commands wait for submitted Sui
    transactions before retrying protected resources or returning CLI results:
    built
- Wallet setup modes:
  - `SUI_SECRET_KEY`
  - `SUI_MNEMONIC`
  - active Sui CLI keystore
  - browser wallet connect later
  - zkLogin/social wallet later
- Budget UX:
  - show payer address, network, balances, and supported coin types
  - prefer a usable user-owned session before one-shot payment
  - show session balance, max per request, expiry, scope, and revocation state
  - session inspect readiness summary and session open/fund budget math: built
  - require explicit confirmation for state-changing session operations
  - enforce max-per-request and total budget guardrails locally before signing
  - default policy: fail closed for tampered or expired challenges, invalid u64
    amounts, expired session opens, wrong merchant/network/scope, and unsafe
    resource hashes
  - expose explicit one-shot max-spend and `--session-only` controls so fallback
    spending is never surprising: built for one-shot fallback cap enforcement
- Gas and coin guidance:
  - SUI payments need SUI for amount and gas
  - non-SUI coin payments still need SUI gas unless sponsored by another flow
  - Testnet gas guidance should point to <https://faucet.sui.io>, not
    `sui client faucet`
  - warn clearly when coin type, network, merchant, or scope do not match

Acceptance criteria:

- A fresh user can run setup, configure a local signer, see their address, and
  call a protected testnet endpoint without sending private keys to Sui402
  infrastructure.
- `sui402-pay curl` pays only after receiving a valid Sui402 challenge whose id,
  expiry, and network pass local pre-sign checks, then prints the final upstream
  response.
- If a usable session exists, the CLI uses it before a one-shot payment and
  explains the selected session.
- If no safe payment path exists, the CLI fails closed with a human-readable
  reason.
- Logs and errors never print seed phrases, secret keys, payment headers, or raw
  Authorization/Cookie values.

Do not build first:

- custodial hosted payer wallets
- pooled user funds
- automatic mainnet funding
- LLM-generated transaction bytes without deterministic SDK validation

Consequence: staying non-custodial is slower for onboarding than hosted balances,
but it avoids a much larger security and compliance surface while the product is
still proving demand.

## Phase 2: publisher API onboarding

Goal: a publisher can add an API in minutes, and operators can trust that the
publisher controls the upstream.

Build next:

- Split a publisher portal from the operator console mental model:
  - URL-first "Add your API"
  - wallet, coin type, price, network, resource scope, and upstream URL capture
  - clear pending/verified/rejected/published states
  - minimum self-serve flow: add API URL, prove ownership, set wallet/price/
    network, run paid test call, then submit for publish/reject review
  - minimum operator flow: review ownership proof, unsafe target checks, paid
    test evidence, wallet-change history, and abuse risk before approving
- Expand API ownership verification:
  - keep `.well-known/sui402-publisher.json` as the default path
  - DNS TXT fallback is now available at `_sui402-publisher.<host>`
  - header-authenticated publisher status/probe next actions: built
  - Sui personal-message payout wallet proof is built as review evidence; it
    does not replace upstream ownership proof
- OpenAPI import:
  - current behavior: accept a safe JSON OpenAPI URL on the draft route, fetch it
    with upstream safety checks, count operations, return endpoint plus
    resource-scope suggestions in `preview.openApi`, and optionally persist a
    selected operation as `preview.selectedOpenApiEndpoint`
  - current config automation: draft responses include a review-only
    `preview.reviewDraft` containing the gateway merchant candidate, registry
    listing candidate, and publish gates that still need to pass
  - current limits: the import is advisory; it does not prove ownership,
    choose pricing, publish a merchant, or write registry/gateway config by
    itself; selected-operation hints only shape the draft's reviewable resource
    scope when the publisher has not explicitly set one
  - next: let publishers select imported operations, map operations to pricing
    units and resource scopes, then generate reviewable gateway merchant config
    and registry listing drafts
- Test-call wizard:
  - readiness probe previews the unpaid `402` challenge surface
  - paid-test evidence reports whether verified payment records exist after publish
    and top-level readiness stays false until that evidence exists
  - first-pass `paidTestWizard` contract/UI is built with ordered steps, current
    gate, copyable status/probe/unpaid/paid commands, and explicit non-custodial
    wallet/max-spend safety notes
  - generated publisher status/probe commands use the
    `x-sui402-publisher-token` header instead of query-token URLs to reduce log,
    browser-history, and screenshot leakage; status/probe query-token auth is
    rejected instead of kept as a compatibility path
  - publisher access tokens can be exchanged for short-lived Bearer publisher
    sessions for status/probe calls; sessions are signed with the current
    publisher access token and are invalidated by access-token rotation
  - publisher access-token rotation is operator-gated and audit-logged, giving
    old/exposed drafts a concrete recovery path without reusing the public
    ownership verification nonce as bearer auth
  - live unpaid request returns `402`
  - paid test request proxies upstream with a real signed proof/session spend
  - response preview hides sensitive headers and payload fields
- Publisher controls:
  - endpoint status
  - wallet address and wallet-change review
  - pricing and coin type changes
  - rate limits
  - allowlist/blocklist
  - abuse reports
  - revenue, usage, failed payments, settlements, and exports

Acceptance criteria:

- A publisher can submit an upstream-backed API and receive exact verification
  instructions without operator hand-holding.
- The product is explicit about what is self-serve and what is reviewed:
  publisher submission is self-serve; public promotion remains review-gated
  until abuse controls and ownership proof are reliable.
- Operators cannot approve an upstream-backed application until ownership proof
  is verified.
- The generated merchant config and registry listing match the verified
  upstream, merchant wallet, coin type, network, price, and resource scope.
- A test call proves both `402` challenge behavior and paid proxy behavior.
- Upstream proxying strips private headers and rejects private/link-local/local
  network targets.
- Wallet address changes require a reviewable event and are visible in audit
  history.

## Phase 3: marketplace

Goal: agents and humans can find useful paid APIs and understand the payment
surface before spending.

Contract reference: freeze the buyer-agent listing/readiness fields in
`docs/marketplace-scan-contract.md` before adding richer marketplace layout.

Build next:

- Public API catalog:
  - search, categories, tags, transport, status, network, coin type, price
  - session support and protected resource URL
  - endpoint count and publisher identity
  - reliability and payment stats from verified records
  - minimum launch listing contract: id, name, description, publisher/merchant,
    network, coin type, atomic price, resource scope, protected resource URL or
    MCP endpoint, session support, status, verification state, and last health
    check
- API detail pages:
  - public detail read model and dashboard detail panel: built
  - shareable route-style dashboard links: built for `/marketplace/:apiId`
  - client-side route metadata: built for loaded marketplace detail states;
    crawler-visible `GET /marketplace/:apiId` evidence/readiness page built with
    JSON alternate link, launch checks, agent path, and redaction copy; richer
    full public detail layout still needed
  - example `sui402-pay curl`: built in dashboard/detail response
  - SDK snippets
  - basic publisher/listing trust checks: built; richer publisher verification badges still needed
  - recent health/reliability indicators
  - Agent-readable discovery:
    - keep compact JSON search through `GET /v1/marketplace/apis`
    - stable API/public/scan links in marketplace JSON: built
    - add stable response versioning
    - add MCP discovery after core catalog quality is good
- Ranking and moderation:
  - relevance
  - successful paid calls
  - freshness
  - reliability
  - abuse/safety status

Acceptance criteria:

- A human can search, inspect an API, copy one command, and make a paid testnet
  call.
- An agent can query marketplace JSON and choose only APIs matching network,
  coin type, price, transport, and session requirements.
- A listing is "ready" only when ownership is verified, the upstream target is
  allowed, the challenge surface is correct, the paid test call passes, and the
  listing is active rather than pending/paused/rejected.
- Unverified, paused, rejected, or unsafe listings are not promoted as ready.
- Marketplace pages never expose raw request payloads, secrets, private payment
  headers, or unpublished operator notes.

## Phase 4: Sui402 scan/explorer

Goal: make ecosystem activity transparent enough for users, publishers, and
operators to trust the network.

Contract reference: use `docs/marketplace-scan-contract.md` for required public
pages, evidence labels, redactions, and web/CLI agreement checks.

Build next:

- Public scan views:
  - merchants/publishers
  - APIs/listings
  - verified payments
  - sessions
  - receipts and settlement events
  - networks and coin types
- Aggregate stats:
  - paid calls
  - volume
  - active buyers
  - active sellers
  - session volume
  - replay rejects
  - failed verifications
  - settlement reconciliation exceptions
- Detail views:
  - transaction digest
  - merchant, payer, coin, amount
  - resource scope hash
  - session id when present
  - receipt id when present
  - indexed event source and cursor/checkpoint metadata
  - public vs operator fields separated: public views can show digests, merchant
    identity, amount/coin, resource hash, and aggregate buyer counts; raw payer
    identity, request metadata, headers, payloads, and internal review notes stay
    operator-only unless the user explicitly owns that view
  - provenance labels: indexed on-chain event, gateway-local receipt, signed
    receipt, settlement record, publisher metadata, or unverified metadata
  - shareable route-style dashboard links: built for `/scan/:kind/:id`
  - client-side sanitized record metadata: built for loaded payment, merchant,
    session, and settlement states; crawler-visible evidence pages built for
    `/scan/payment/:digest`, `/scan/merchant/:merchantId`,
    `/scan/session/:sessionId`, and `/scan/settlement/:settlementId` with JSON
    alternate links, evidence sections, redaction copy, and noindex safe 404
    pages for records that are not indexed yet; richer full explorer layouts
    still needed
- Privacy policy:
  - hide raw request payloads
  - hide raw payment headers
  - treat payer identity as sensitive
  - publish aggregate views by default and drill-down only where defensible

Acceptance criteria:

- `sui402-pay scan stats` and the public scan page agree on headline counts for
  the same environment.
- Each public payment/session/settlement detail links to enough digest or event
  evidence for verification without leaking secrets.
- Operator-only ingestion and cursor routes remain authenticated and audited.
- Reconciliation views separate verified local receipts from indexed on-chain
  settlement events and do not market the current ledger as full escrow.

## Phase 5: dashboard roles and operator console

Goal: make the console safe enough for real publishers, operators, finance,
support, and indexer automation without turning the browser app into a secret
holder.

Build next:

- Role model:
  - viewer: read-only marketplace, scan, health, and aggregate stats
  - merchant-admin: review publisher applications, approve listing changes, view
    merchant-level payment health
  - finance/support: settlements, reconciliation, exports, and payment
    drill-downs without security admin powers
  - exporter: Walrus/audit/CSV exports only
  - indexer: trusted ingestion routes only
  - admin/security: operator keys, audit verification, emergency pause, policy
    changes, and break-glass
- Authentication:
  - prefer OIDC/JWKS or backend sessions for humans
  - accept seller OIDC/JWKS tokens only when seller roles and merchant-scoped
    claims authorize the target merchant
  - keep static operator keys for automation and break-glass only
  - never expose admin/operator keys through `VITE_*` or browser bundles
- Console UX split:
  - publisher portal for seller onboarding and API management
  - operator console for review, risk, audits, settlement, and incidents
  - public marketplace/scan that require no privileged token
- Controls:
  - approval queues for wallet, pricing, upstream, and listing status changes
  - audit event for every privileged mutation
  - role-based route tests
  - access review export
  - emergency merchant/listing pause

Acceptance criteria:

- A production dashboard user can only perform actions allowed by their role.
- Merchant-facing users cannot access operator-only notes, trusted ingestion,
  audit verification, or global admin controls.
- Finance/support can export settlement evidence without gaining listing review
  or security powers.
- Every privileged action has a durable audit event with actor, role, target,
  reason, and request id.
- Audit events preserve hashes/digests for evidence but redact raw headers,
  cookies, API keys, publisher tokens, verification tokens, request bodies, and
  private-key material before hash-chain storage.
- Browser builds contain no operator API keys, raw private keys, signer material,
  or admin bearer tokens.

## Phase 6: SDK and developer integration

Goal: developers integrate Sui402 without reading the whole protocol or cloning
the monorepo.

Build next:

- Package the public SDK surface cleanly:
  - `@sui402/protocol`
  - `@sui402/client`
  - `@sui402/server`
  - `@sui402/sui`
  - `@sui402/policy`
  - `@sui402/receipts`
  - `@sui402/storage`
  - `@sui402/indexer`
  - `@sui402/gateway`
  - `@sui402/registry`
  - `@sui402/mcp`
  - `@sui402/pay`
- Publisher adapters:
  - Express middleware is first-class
  - Fastify/Hono/Next adapters after Express is documented end-to-end
  - OpenAPI annotation helpers
  - receipt hooks and policy hooks
- Agent adapters:
  - fetch wrapper
  - session-first payment handler
  - wallet adapters
  - policy guardrails
  - marketplace search helpers
- Examples and docs:
  - paid weather API
  - paid MCP tool
  - publisher behind hosted gateway
  - direct provider middleware
  - agent CLI and SDK call
  - session payment and one-shot fallback

Acceptance criteria:

- `npm run release:check` passes before any package publish.
- Package dry-runs do not include secrets, env files, tests, local state, logs,
  or missing entrypoints.
- A new publisher can scaffold a provider, configure a merchant wallet/price,
  run it locally, and see a valid `/.well-known/sui402` manifest.
- A new agent developer can add the client SDK or CLI and complete a paid
  testnet request from copy-paste docs.
- Hosted apps remain private packages unless there is an explicit product
  decision to publish them.

## Phase 7: security, hardening, and evidence

Goal: be able to prove what is safe, what is not safe yet, and what external
review backs launch claims.

Build/harden next:

- Hardening:
  - OIDC/JWKS or role-scoped operator keys for console access
  - OIDC/JWKS seller tokens for hosted seller portals, with static seller keys
    limited to service, bootstrap, or break-glass use
  - durable challenge, replay, payment, listing, merchant application, cursor,
    receipt, and audit stores
  - shared rate limits for provider, gateway, console, and public intake
  - SSRF protection plus network egress controls for upstream proxying
  - KMS/HSM-backed receipt signing with signer-id rotation
  - audit log hash-chain verification and external audit-head anchoring
  - backup/restore drills and key rotation drills
- Evidence:
  - funded testnet rehearsal covering one-shot payments, sessions, receipts,
    settlement reconciliation, indexers, marketplace/scan, and audit exports
  - saved output from release and launch checks on the release commit
  - external Move audit
  - external backend/SDK audit
  - counsel-approved terms, privacy, seller terms, and payment positioning
  - monitoring dashboards, alert policies, on-call rota, incident commander, and
    disclosure contact
- Explicit non-claims:
  - the receipt ledger is not full escrow
  - signed receipts are not a complete dispute system
  - local certification is not external audit
  - registry listings are not payment authorization

Acceptance criteria:

- Every P0 gate in `docs/serious-launch-plan.md` has concrete evidence, owner,
  and status before a broad mainnet launch.
- External audit critical/high findings are fixed or formally risk accepted.
- Mainnet package governance, UpgradeCap policy, signer custody, and rollback or
  forward-fix plan are documented before publish.
- Production monitoring and incident response are staffed, tested, and linked
  from launch evidence.
- Legal/compliance review approves public language for non-custodial wallet
  setup, stablecoin/payment flows, marketplace intake, data retention, and
  support/disputes.

## Recommended execution order

1. Finish the non-custodial `@sui402/pay` happy path and session-first UX.
2. Make publisher onboarding self-serve with verified upstream ownership and a
   production-grade paid test-call wizard.
3. Ship marketplace catalog/detail pages backed by verified registry listings and
   payment stats.
4. Ship scan/explorer read models from payment, session, receipt, settlement,
   and indexer stores.
5. Lock dashboard roles, publisher/operator console separation, and auditability.
6. Polish SDK adapters, examples, package release gates, and copy-paste docs.
7. Complete security hardening, external reviews, operational readiness, and
   evidence collection before broad launch.

## Current parallel build queue

Use this queue when several agents are working at once. These are intentionally
split by ownership so parallel edits stay safe.

| Track | Owner scope | Immediate output | Stop condition |
| --- | --- | --- | --- |
| Pay CLI | `packages/pay/*` | Non-custodial setup/readiness UX, specific signer errors, wallet/session guardrails, focused tests. | `npm run check -w @sui402/pay` and `npm test -w @sui402/pay` pass. |
| Publisher onboarding | `apps/console-api/*`, `docs/console-api.md`, later dashboard seller portal files | Safer self-serve application flow, exact verification instructions, later OpenAPI/test-call wizard. | Application lifecycle is test-covered and does not approve upstream APIs before ownership proof. |
| Marketplace | `apps/console-api/*`, `apps/dashboard/*`, `packages/pay/*`, docs | API detail/read models, stable discovery schema, copyable agent commands. | CLI and dashboard can discover the same verified listing and show consistent payment metadata; console JSON/public page/CLI/dashboard render agreement is now covered for seed data. |
| Scan/explorer | `apps/console-api/*`, `apps/dashboard/*`, `packages/pay/*`, docs | Public detail views/read models with privacy-preserving evidence. | Seed/custom memory stats, payment, merchant, session, and settlement JSON/public page/CLI/dashboard render agreement is now covered; durable-environment agreement still remains. |
| Security/evidence | `scripts/*`, `docs/*`, env examples | Launch gates, rehearsal artifacts, secret hygiene, role/audit evidence. | `npm run release:check` passes and launch blockers have explicit evidence or accepted risk. |

Docs-only marketplace/scan work may update `docs/dashboard.md`,
`docs/sui402-product-build-plan.md`, and focused markdown specs under `docs/`.
Do not mix that with source changes in `apps/console-api`, `apps/dashboard`, or
`packages/pay` while another agent owns those lanes.

Do not parallelize edits inside the same file unless one agent is clearly only
reviewing. The project is getting big enough that coordination discipline now
matters more than raw speed.

## Launch blockers

These block a serious public mainnet launch. They can be relaxed only for a
clearly labeled, allowlisted testnet or private beta with explicit risk
acceptance.

- No externally reviewed Move session/settlement audit.
- No external backend/SDK audit covering verifier, replay, gateway, client,
  marketplace/registry, receipts, storage, and indexer paths.
- No funded end-to-end testnet rehearsal evidence for one-shot, session,
  receipt settlement, indexer, marketplace/scan, dashboard, and audit export
  flows.
- No production-like staging evidence for DNS/TLS, managed Postgres/Redis,
  secret manager, KMS/HSM signing, backups, restore, monitoring, logs, and
  rate limits.
- No counsel-approved terms, privacy policy, seller terms, dispute/support
  posture, and payment/compliance positioning.
- No mainnet package governance plan for signer custody, UpgradeCap handling,
  package IDs, gas budget, emergency pause, rollback/forward-fix, and incident
  communication.
- No staffed on-call rotation, incident commander/backup, disclosure contact,
  status/support path, and first-page test.
- No broad seller-intake abuse controls: email/identity checks, throttling,
  moderation, escalation, and review SLAs.
- Any CLI/dashboard path can expose private keys, seed phrases, payment headers,
  cookies, raw authorization headers, or browser-bundled admin secrets.
- Marketplace or scan copy implies escrow, audited security, settlement
  finality, refund guarantees, or legal approval beyond the evidence actually
  present.

## Private testnet beta minimum

This is the lighter gate for a controlled, allowlisted beta. It is not public
mainnet launch.

- One funded end-to-end testnet path works: publisher draft, ownership proof,
  marketplace listing, buyer wallet setup, paid call, receipt/session evidence,
  scan lookup, and settlement/reconciliation record.
- All beta copy says testnet/private beta and avoids audited/finality/legal
  claims that are not backed by evidence.
- Publishers are allowlisted and manually reviewed.
- Buyers use user-owned wallets with small testnet budgets, explicit one-shot
  caps, and explicit confirmation for session open/fund/close.
- Secrets do not leave local environments; no private keys, mnemonics, payment
  headers, cookies, or admin secrets appear in logs, browser bundles, scan, or
  marketplace responses.
- Operators have a rollback/disable path for a merchant, listing, gateway route,
  and session package configuration.
- `npm run release:check` passes for the exact candidate commit/workspace, and
  skipped integration checks are documented as accepted beta risk.

## Launch decision checklist

Use this as the short go/no-go view:

- Agent wallet: local signing works; sessions are bounded; secrets do not leave
  the user's environment.
- Publisher onboarding: upstream ownership is verified; proxying is hardened;
  review/audit trails exist.
- Marketplace: listings are searchable, moderated, and agent-readable.
- Scan: public stats and detail views are verifiable and privacy-preserving.
- SDK/DX: packages are publishable; examples prove agent and publisher flows.
- Security/evidence: audits, monitoring, legal, incident response, key custody,
  testnet rehearsal, and launch checks have concrete references.
