# Hosted Gateway

`@sui402/gateway` is the Phase 5 foundation for hosted Sui402 payment services.
It lets one gateway process serve multiple merchants, issue Sui402 challenges,
verify payment proofs, and record successful payments through the shared ledger
interfaces.

This is not yet the full hosted product. A complete gateway still needs durable
merchant storage, seller auth, dashboards, webhooks, abuse controls, and
operational runbooks. The router here is the payment core.

## Merchant Config

```ts
import { createGatewayMerchantConfig } from "@sui402/gateway";

const merchant = createGatewayMerchantConfig({
  id: "merchant-api",
  service: "Merchant API",
  network: "sui:testnet",
  merchant: "0x...",
  coinType: "0x2::sui::SUI",
  price: "1000000",
  resourceScope: "api:*",
  upstreamUrl: "https://api.example.com/v1/search",
  upstreamTimeoutMs: 15000,
  sessionPackageId: "0x...",
  paymentPolicy: {
    requireSession: true,
    allowOneShot: false,
    allowedResourceScopes: ["api:*"]
  }
});
```

## Gateway Router

```ts
import express from "express";
import { MemoryMerchantStore, createGatewayRouter } from "@sui402/gateway";

const app = express();
const merchants = new MemoryMerchantStore();

app.use(
  "/gateway",
  createGatewayRouter({
    merchants,
    challengeStore,
    paymentRecords,
    adminApiKey: process.env.SUI402_GATEWAY_ADMIN_API_KEY
  })
);
```

Routes:

- `GET /gateway/merchants/:merchantId/.well-known/sui402`
- `GET|POST /gateway/merchants/:merchantId/pay`
- `GET /gateway/merchants`
- `POST /gateway/merchants`

Admin routes require either:

```text
Authorization: Bearer <key>
```

or:

```text
x-sui402-admin-key: <key>
```

## Payment Flow

An agent calls:

```text
GET /gateway/merchants/merchant-api/pay
```

The gateway returns `402 Payment Required` with a Sui402 challenge. The agent
pays on Sui and retries with `Sui402-Payment`. On success, the gateway records
the payment. If the merchant has `upstreamUrl`, the gateway proxies the paid
request to that upstream URL, preserving the query string and forwarding these
verification headers:

- `x-sui402-merchant-id`
- `x-sui402-resource-scope`
- `x-sui402-payment-digest`
- `x-sui402-session-id` for session payments

The gateway intentionally strips gateway/private request headers such as
`Sui402-Payment`, `Authorization`, and `Cookie` before forwarding to the
publisher upstream. Publishers should trust the `x-sui402-*` headers from the
gateway, not raw client payment headers.

If no `upstreamUrl` is configured, the gateway returns a small verified JSON
response for compatibility with earlier hosted gateway behavior.

Merchant `upstreamUrl` values must use `http` or `https` and point at a public
upstream host. The gateway rejects local/private/link-local/special-use IP
targets such as `localhost`, RFC1918 ranges, loopback, and cloud metadata IPs
before proxying. This is a pragmatic SSRF guard for merchant-configured
upstreams; production deployments should still keep normal network egress
controls around the gateway process.

If a merchant config includes `paymentPolicy`, the gateway enforces it after
proof verification and before ledger recording. This lets a merchant require
session payments, cap accepted amount, restrict coin types, or reject resource
scopes that do not match the configured service.

Production deployments should pass durable Redis/Postgres-backed stores so
challenge state and transaction digest replay protection survive restarts.
