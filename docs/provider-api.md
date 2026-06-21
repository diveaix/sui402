# Provider API

The provider API is the production HTTP surface for a seller or tool provider.

Core routes:

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`
- `GET /.well-known/sui402`
- `GET /sui402/config`
- `GET /sui402/owners/:owner/sessions`
- `GET /sui402/owners/:owner/sessions/usable?amount=1000000`
- `GET /v1/entitlements/current`
- `GET /admin/payments`
- `GET /admin/payments/:id`
- `GET /admin/sessions`
- `GET /admin/sessions/:sessionId`

## Discovery Manifest

`GET /.well-known/sui402` returns a machine-readable manifest with:

- protocol version and service name
- Sui network, merchant address, coin type, and price
- protected resource scope and scope hash
- supported payment kinds: `one-shot` and optionally `session`
- session manager path when sessions are enabled
- canonical provider paths for discovery and protected access

Agents and SDKs can call `discoverSui402Provider` from `@sui402/client` to fetch
and validate this manifest before deciding whether to open a session or make a
one-shot payment.

Operational defaults:

- Every response gets an `x-request-id`.
- Incoming `x-request-id` is preserved when supplied.
- Requests are logged as JSON.
- Security headers disable frame embedding and content sniffing.
- A per-IP rate limit protects all provider routes.
- Optional signed session spend receipts can be emitted after verified session
  payments.
- Readiness probes configured Redis/Postgres dependencies and returns `503` on
  dependency failure.
- Prometheus-compatible request counters and latency histograms are available
  from `/metrics`; restrict this route at ingress in production.

Sui reads and transaction verification use the gRPC Core API. Override the
network default with a production RPC provider or your own fullnode:

```text
SUI402_GRPC_URL=https://your-sui-grpc-endpoint.example
```

Rate limit environment:

```text
SUI402_RATE_LIMIT_WINDOW_MS=60000
SUI402_RATE_LIMIT_MAX_REQUESTS=120
```

Without Redis, the built-in limiter is process-local. When `SUI402_REDIS_URL`
is configured, the provider API automatically uses Redis-backed rate limiting so
limits apply across provider instances.

## Admin Payment Ledger

Admin routes are disabled unless `SUI402_ADMIN_API_KEY` is configured.

```text
SUI402_ADMIN_API_KEY=change-this-long-random-secret
SUI402_ADMIN_MAX_PAYMENTS=100
```

Requests can authenticate with either header:

```text
Authorization: Bearer change-this-long-random-secret
x-sui402-admin-key: change-this-long-random-secret
```

Endpoints:

- `GET /admin/payments`
- `GET /admin/payments?recipient=0x...&limit=50`
- `GET /admin/payments/:id`
- `GET /admin/sessions`
- `GET /admin/sessions?payer=0x...&merchant=0x...&limit=50`
- `GET /admin/sessions/:sessionId`

The admin API returns records from the configured `PaymentRecordStore`. In
production, configure Postgres storage so the ledger survives restarts and can
be queried across provider instances.

`/admin/sessions` is an observed session index built from verified session
payment records. It summarizes session id, payer, merchant, coin type, spend
count, total spent amount, resources, first/last seen timestamps, and latest
transaction digest. It only includes sessions that have paid this provider; use
the `/sui402/owners/:owner/sessions` manager route when an agent or wallet needs
to inspect all currently owned session objects for one payer.

## Receipt Signing

Session spend receipts are disabled by default. To enable them, configure an
Ed25519 signer. Local PEM mode is useful for development and controlled
single-provider deployments:

```text
SUI402_RECEIPT_SIGNER_PROVIDER=local
SUI402_RECEIPT_SIGNER_ID=0x...
SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64=...
SUI402_RECEIPT_TTL_SECONDS=86400
```

`SUI402_RECEIPT_PRIVATE_KEY_PEM` is also supported for local development, but
base64 is easier to pass through deployment systems. In production, pair receipt
signing with Redis so receipt sequences are durable across provider instances.
If receipts will be settled by the current Move settlement ledger,
`SUI402_RECEIPT_SIGNER_ID` must be the Sui address you will record as the
settlement signer.

Generate a local development key:

```powershell
npm run receipt:key
```

Real talk: raw PEM env vars are acceptable for local/small deployments, but the
serious production target is external signing and rotation.

The importable provider app also supports external signer mode. Use this for
AWS KMS, GCP KMS, Vault Transit, or HSM-backed signing:

```ts
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { AwsKmsEd25519SpendReceiptSigner } from "@sui402/receipts";

createProviderApp(
  {
    ...config,
    SUI402_RECEIPT_SIGNER_PROVIDER: "external",
    SUI402_RECEIPT_SIGNER_ID: "0x..."
  },
  {
    receiptSigner: new AwsKmsEd25519SpendReceiptSigner({
      signer: "0x...",
      keyId: "arn:aws:kms:us-east-1:123456789012:key/...",
      client: new KMSClient({ region: "us-east-1" }),
      commandFactory: (input) => new SignCommand(input)
    })
  }
);
```

The bundled `npm run dev:provider` server cannot instantiate your cloud KMS
client by itself; use the importable provider API surface when deploying with a
custom signer.

Rotation rule: change `SUI402_RECEIPT_SIGNER_ID` when changing the backing KMS
key or key version. Keep old public keys trusted until all receipts signed under
the old signer have expired plus any dispute window.
