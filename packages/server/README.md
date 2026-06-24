# @sui402/server

Express middleware and provider helpers for protecting HTTP routes with Sui402
payments.

```bash
npm install @sui402/server
```

Use this package when you operate an API and want to require Sui402 one-shot or
session payments before serving protected resources.

## Minimal route

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

The middleware:

- returns a Sui402 `402 Payment Required` challenge when no proof is present;
- verifies one-shot and session payment proofs;
- rejects expired, mismatched, or replayed challenges when durable stores are
  configured;
- attaches verification details to `res.locals.sui402`.

## Production storage

Use durable stores from `@sui402/storage` in production:

- Redis for challenge state and expiry.
- Postgres for payment records and transaction digest replay protection.

In-memory stores are test/demo adapters. They are not safe for multi-instance or
real-funds production.

See `docs/product-quickstart.md`, `docs/provider-api.md`, and
`docs/security-checklist.md` from the repository root for full launch guidance.
