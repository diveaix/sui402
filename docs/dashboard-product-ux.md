# Dashboard Product UX Handoff

Last updated: 2026-06-25

This document is the product-facing map for the Sui402 dashboard. It explains
what each page is for, who should use it, and which launch claims the dashboard
does **not** prove by itself.

The dashboard is intentionally a multi-role demo console, not a single-purpose
admin panel. The UX should make that obvious before showing technical payment
details.

## Primary demo path

Use this flow for demos, judges, and first-time evaluators:

1. **Overview** - explain the product map.
2. **Marketplace** - find a paid API and copy the agent command.
3. **MCP** - show that Sui402 also has its own paid MCP server surface.
4. **Publisher** - add an API URL, payout wallet, price, and proof steps.
5. **Scan** - inspect payment, merchant, session, or settlement evidence.
6. **Operator** - only then show review queues, exports, audit logs, and direct
   publish tools.

If a first-time user sees operator-only details before they understand the
agent/publisher path, the product feels like infrastructure instead of a usable
payment system.

## Page responsibilities

| Page | Primary user | What it should answer | Default UX rule |
| --- | --- | --- | --- |
| Overview | Demo viewer / new user | "What is Sui402 and where do I start?" | Teach the loop: find API -> pay with Sui wallet -> call -> inspect proof. |
| Marketplace | Agent / buyer developer | "What can my agent pay for?" | Show price, network, paid access, and copyable `sui402-pay` commands before internals. |
| MCP | Agent-tool developer | "Do we have our own paid MCP server?" | Explain install/config/proof loop and list paid MCP tools. |
| Publisher | API owner | "How do I add my API?" | URL-first. Ask for name, payout wallet, price, contact; hide advanced Sui fields by default. |
| Scan | Public verifier / operator | "Can I inspect the proof?" | Show evidence class and digest first; keep signer/hash internals as technical evidence. |
| Operator | Internal operator | "What must be reviewed or reconciled?" | It is allowed to show resource scopes, packages, audit events, exports, and direct publish controls. |

## Language policy

Use product nouns in public/default flows:

- "paid access" instead of "resource scope"
- "publisher resume token" instead of "private publisher access token"
- "payout wallet" instead of "merchant address" when speaking to publishers
- "payment coin" or "payment token" instead of raw `coinType`
- "console API" instead of "backend"

Technical terms are still valid in developer/operator contexts:

- `resourceScope`
- `coinType`
- `sessionPackageId`
- receipt signer
- access proof hash
- protected resource URL

The rule is not "hide all complexity." The rule is: show the user the next
decision first, and put protocol/debug fields behind a technical/developer
label.

## Publisher onboarding UX

The easiest publisher path should stay URL-first:

1. Paste the API URL.
2. Let Sui402 infer the listing slug and paid access rule.
3. Add API name, payout wallet, price, and optional contact email.
4. Optionally import OpenAPI and choose a paid route.
5. Submit for review.
6. Publish `.well-known/sui402-publisher.json` or DNS TXT proof.
7. Sign payout wallet proof.
8. Run readiness probe / paid test.
9. Operator approves only after evidence is present.

Advanced fields may be visible under developer options, but should not be part
of the first-run mental model.

## Agent payment UX

Agents are non-custodial. The dashboard should never imply Sui402 hosts agent
wallets or pays gas for them.

The expected model is:

- agent/user owns a Sui wallet;
- wallet needs SUI for gas;
- agent copies or generates a bounded `sui402-pay` command;
- CLI compares marketplace/challenge fields before signing;
- scan can inspect the resulting evidence.

## What this dashboard does not prove

A locally passing dashboard/demo does not prove public production launch
readiness. These remain external gates:

- hosted DNS/TLS deployment with managed Postgres and Redis;
- funded testnet rehearsal with transaction digests and saved evidence;
- production OIDC/JWKS tenant with role tests;
- secret-manager based deployment and rotation evidence;
- KMS/HSM/Vault receipt signer smoke test if receipts are enabled;
- monitoring, on-call, backup, and restore-drill evidence;
- external Move and backend/SDK audits;
- legal/compliance review;
- seller intake abuse controls and takedown workflow;
- mainnet package governance and signer/UpgradeCap custody.

Use `PRODUCTION_STATUS.md`, `docs/production-hardening-backlog.md`, and
`docs/serious-launch-plan.md` as the launch evidence sources of truth.

## Verification commands

Before claiming the local dashboard is coherent:

```bash
npm run check -w @sui402/dashboard
npm run test -w @sui402/dashboard
npm run build -w @sui402/dashboard
npm run release:check
```

The last full `release:check` for this UX pass was run locally on 2026-06-25.
