# @sui402/client

Agent-side SDK for Sui402 payments. It discovers Sui402 provider manifests,
handles HTTP `402 Payment Required` challenges, submits Sui one-shot payments or
session spends, and retries the protected request.

```bash
npm install @sui402/client
```

Use this package in agents, wallets, and API clients that need to consume Sui402-protected services.

## When to use this package

Use `@sui402/client` when you are building an agent or wallet integration in
code. Use `@sui402/pay` when you want a command-line, pay.sh-like experience.

## Minimal client shape

```ts
import { Sui402Client, createPolicyGuardedPaymentHandler, createSuiPaymentHandler } from "@sui402/client";

const client = new Sui402Client({
  paymentHandler: createPolicyGuardedPaymentHandler(createSuiPaymentHandler(signer), {
    policy: {
      allowedNetworks: ["sui:testnet"],
      maxAmount: "1000000"
    }
  })
});

const response = await client.fetch("https://api.example.com/weather");

console.log(await response.json());
```

Agents should set local policy before signing:

- expected network
- expected merchant recipient
- coin type
- max one-shot amount
- session-only preference for repeated calls

Marketplace listings are discovery metadata. The live `402` challenge plus local
policy is the payment authorization surface.

See `docs/product-quickstart.md` from the repository root for the full agent,
SDK, MCP, publisher, marketplace, and scan flow.
