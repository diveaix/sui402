# Agent Spending Policies

`@sui402/policy` defines reusable spending guardrails for agent wallets and
client SDKs. It is intentionally independent from any one wallet UI so the same
policy can protect HTTP payments, MCP tool calls, session-based payments, and
merchant-side payment acceptance.

## Policy Shape

```ts
import type { Sui402SpendingPolicy } from "@sui402/policy";

const policy: Sui402SpendingPolicy = {
  allowedNetworks: ["sui:testnet"],
  allowedMerchants: ["0x..."],
  allowedCoinTypes: ["0x2::sui::SUI"],
  allowedResourceScopes: ["api:*"],
  maxAmount: "1000000",
  requireSession: true,
  allowOneShot: false,
  allowSessions: true
};
```

Supported checks:

- network allowlist
- merchant allowlist
- coin type allowlist
- resource scope allowlist with `*` suffix matching
- maximum per-payment amount
- one-shot/session payment kind restrictions
- optional policy expiry

## Client Guard

Wrap a payment handler before giving it to `Sui402Client`:

```ts
import { Sui402Client, createPolicyGuardedPaymentHandler } from "@sui402/client";

const client = new Sui402Client({
  paymentHandler: createPolicyGuardedPaymentHandler(sessionPaymentHandler, {
    policy,
    paymentKind: "session"
  })
});
```

The guard evaluates the challenge before invoking the underlying payment handler.
If a challenge exceeds policy, the signer is not called. It also evaluates again
after the proof is returned to ensure the actual payment kind matches policy.

If a policy restricts payment kinds, pass `paymentKind` explicitly. This prevents
an agent from signing first and only discovering after the fact that the selected
payment kind was disallowed.

## Discovery Preflight

Use policy checks against provider manifests before calling protected endpoints:

```ts
import { discoverSui402Provider } from "@sui402/client";
import { assertProviderManifestAllowed } from "@sui402/policy";

const manifest = await discoverSui402Provider("https://merchant.example");
assertProviderManifestAllowed(policy, manifest);
```

This is a preflight check only. The server-issued `402` challenge remains the
actual payment obligation and must be checked before signing.

## Server Enforcement

Providers and gateways can also enforce a policy after payment proof
verification and before access is granted:

```ts
import { requireSuiPayment } from "@sui402/server";

app.get(
  "/premium",
  requireSuiPayment({
    recipient: "0x...",
    coinType: "0x2::sui::SUI",
    amount: "1000000",
    policy: {
      allowedNetworks: ["sui:testnet"],
      allowedMerchants: ["0x..."],
      allowedCoinTypes: ["0x2::sui::SUI"],
      allowedResourceScopes: ["api:*"],
      requireSession: true,
      allowOneShot: false
    }
  }),
  handler
);
```

If a verified proof violates policy, the server returns
`403 payment_policy_violation` and does not consume the challenge or record a
successful payment.

Hosted gateway merchants can carry the same policy:

```ts
createGatewayMerchantConfig({
  id: "session-only-api",
  service: "Session Only API",
  network: "sui:testnet",
  merchant: "0x...",
  coinType: "0x2::sui::SUI",
  price: "1000000",
  resourceScope: "api:*",
  paymentPolicy: {
    requireSession: true,
    allowOneShot: false,
    allowedResourceScopes: ["api:*"]
  }
});
```
