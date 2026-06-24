# Sui402 Product Quickstart

Last updated: 2026-06-25

This is the shortest honest path through the product surfaces we have today:
agent wallet, SDK, MCP, publisher onboarding, marketplace, and scan. It is not a
mainnet launch checklist; use `docs/production-hardening-backlog.md` and
`docs/serious-launch-plan.md` for that.

## What is built

Sui402 has five local/demo-ready surfaces:

1. **Agent wallet + pay CLI** — `@sui402/pay` lets an agent use a user-owned Sui
   wallet, discover paid APIs, make paid calls, inspect sessions, and query scan.
2. **SDK packages** — `@sui402/client`, `@sui402/server`, `@sui402/sui`, and
   supporting packages let developers integrate Sui402 into agents and APIs.
3. **Paid MCP** — `@sui402/mcp` exposes paid MCP tools and generates MCP client
   config blocks.
4. **Publisher onboarding** — console API/dashboard flows let a publisher add an
   API URL, prove ownership, prove payout-wallet control, and request review.
5. **Marketplace + scan** — public JSON/pages and `sui402-pay` commands let
   agents discover listings and inspect payment/session/settlement evidence.

## 1. Agent wallet path

Sui402 is non-custodial. Agents need a Sui wallet with SUI for gas. The CLI can
read a signer from `SUI_SECRET_KEY`, `SUI_MNEMONIC`, or the local Sui CLI
keystore.

```bash
npx @sui402/pay setup --print-env --marketplace-url https://console.example.com
npx @sui402/pay readiness --strict
npx @sui402/pay wallet --human --balance
```

Then discover and call:

```bash
npx @sui402/pay search weather --marketplace-url https://console.example.com
npx @sui402/pay marketplace detail atlas-api --marketplace-url https://console.example.com
npx @sui402/pay curl https://console.example.com/gateway/merchants/atlas-api/pay --max-one-shot-amount 1000000
```

For repeated calls, prefer bounded sessions:

```bash
npx @sui402/pay session inspect --resource https://api.example.com/weather --merchant 0x... --amount 1000000
npx @sui402/pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000000 --funding 10000000
npx @sui402/pay curl https://api.example.com/weather --session-only
```

Agent safety rules:

- Never send wallet private keys to Sui402 servers.
- Always compare live `402` challenge fields with marketplace fields before
  signing.
- Set an explicit one-shot max spend or use session-only mode.
- Treat marketplace metadata as discovery, not payment authorization.

## 2. SDK developer path

Use the official TypeScript Sui SDK through the Sui402 packages. The core public
packages are:

| Need | Package |
| --- | --- |
| Agent/client payment flow | `@sui402/client` |
| Express provider middleware | `@sui402/server` |
| Sui builders/verifiers/sessions | `@sui402/sui` |
| Protocol schemas and headers | `@sui402/protocol` |
| Agent policy checks | `@sui402/policy` |
| Durable Redis/Postgres adapters | `@sui402/storage` |
| Marketplace listings | `@sui402/registry` |
| Hosted merchant gateway helpers | `@sui402/gateway` |
| Paid MCP tools | `@sui402/mcp` |

Provider-side minimal shape:

```ts
import express from "express";
import { requireSuiPayment } from "@sui402/server";
import { Sui402Verifier } from "@sui402/sui";

const app = express();

app.get(
  "/premium",
  requireSuiPayment({
    network: "sui:testnet",
    recipient: "0x...",
    coinType: "0x2::sui::SUI",
    amount: "1000000",
    description: "Premium API call",
    verifier: new Sui402Verifier({ network: "sui:testnet" }),
    resource: "GET https://api.example.com/premium"
  }),
  (_req, res) => res.json({ ok: true, paid: true })
);
```

Production SDK rule: pass durable Redis/Postgres stores. In-memory stores are
for tests and local demos only.

## 3. Paid MCP path

For a ready-to-run stdio MCP server:

```bash
npm install -g @sui402/mcp

sui402-mcp-config \
  --merchant 0x... \
  --price 1000000 \
  --tool-name premium_context \
  --out mcp.sui402.json
```

For multiple paid tools, configure `SUI402_MCP_TOOLS_JSON`:

```json
[
  {
    "name": "premium_context",
    "description": "Premium context for agents",
    "amount": "1000000",
    "resource": "mcp:research/premium_context",
    "responseJson": { "ok": true, "context": "paid payload" }
  }
]
```

Production MCP rule: `NODE_ENV=production` must use Redis for challenges and
Postgres for payment records. The bundled MCP server refuses production startup
without durable storage.

## 4. Publisher API path

The easiest publisher flow is URL-first:

1. Paste or submit an upstream API URL.
2. Add payout wallet, network, coin type, and atomic price.
3. Host `.well-known/sui402-publisher.json` or DNS TXT proof.
4. Sign the payout wallet proof message.
5. Operator reviews the application.
6. Run a real paid test.
7. Listing appears in marketplace/scan only when readiness gates pass.

CLI/API route shape:

```bash
curl -sS -X POST "$CONSOLE/v1/publisher/apis/draft" \
  -H "content-type: application/json" \
  -d '{
    "apiUrl": "https://api.example.com/v1/search",
    "merchant": "0x...",
    "network": "sui:testnet",
    "coinType": "0x2::sui::SUI",
    "price": "1000000",
    "applicantEmail": "seller@example.com"
  }'
```

See `docs/publisher-onboarding.md` for the full review/proof flow.

## 5. Marketplace + scan path

Agents use marketplace JSON to find payment opportunities:

```bash
npx @sui402/pay search weather --marketplace-url https://console.example.com
npx @sui402/pay marketplace detail atlas-api --marketplace-url https://console.example.com
```

Operators and agents use scan to inspect evidence:

```bash
npx @sui402/pay scan stats --marketplace-url https://console.example.com
npx @sui402/pay scan payment <tx-digest> --marketplace-url https://console.example.com
npx @sui402/pay scan session <session-id> --marketplace-url https://console.example.com
npx @sui402/pay scan settlement <settlement-id> --marketplace-url https://console.example.com
```

Public scan deliberately labels provenance. A gateway-verified payment, indexed
on-chain session event, signed receipt, and settlement record are different
evidence classes.

## Local proof commands

Run these before claiming the local build is coherent:

```bash
npm run release:check
npm run launch:check
npm run launch:guard:check
```

For npm/package readiness:

```bash
npm run package:check
npm run package:clean-install
```

## Still not locally finishable

These remain external launch blockers:

- hosted staging/prod with DNS/TLS and managed Redis/Postgres
- funded end-to-end testnet rehearsal evidence
- live KMS/HSM/Vault signer smoke test
- third-party Move and backend/SDK audits
- legal/compliance review
- on-call, monitoring, backup/restore drills
- seller KYB/CAPTCHA/identity controls when launch scope requires them
- mainnet signer/UpgradeCap governance
