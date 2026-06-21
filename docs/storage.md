# Production Storage

Sui402 uses two storage paths in production:

- Redis-compatible challenge storage for issued challenges and replay prevention.
- Postgres-compatible payment records for the durable payment ledger.
- Ledger-level `network + txDigest` replay protection.
- Redis-compatible receipt sequence counters for signed session spend receipts.

The core `@sui402/server` package only defines interfaces. The
`@sui402/storage` package provides production adapters:

```ts
import { PostgresPaymentRecordStore, RedisChallengeStore, RedisReceiptSequenceStore } from "@sui402/storage";

const challengeStore = new RedisChallengeStore({ client: redis });
const paymentRecords = new PostgresPaymentRecordStore({ client: pool });
const receiptSequences = new RedisReceiptSequenceStore({ client: redis });

await paymentRecords.setup();
```

Provider API environment:

```text
SUI402_REDIS_URL=redis://localhost:6379
SUI402_POSTGRES_URL=postgres://user:password@localhost:5432/sui402
SUI402_PAYMENT_RECORD_TABLE=sui402_payment_records
SUI402_RUN_STORAGE_MIGRATIONS=true
```

In `NODE_ENV=production`, the provider API refuses to start unless both
`SUI402_REDIS_URL` and `SUI402_POSTGRES_URL` are configured. That is deliberate:
in-memory challenge/replay state is not safe for a multi-process or restarted
provider.

The Postgres adapter creates a unique `(network, tx_digest)` index. That means a
single on-chain transaction digest cannot be reused to unlock multiple provider
challenges.

HTTP middleware and MCP paid-tool checks both use `PaymentRecordStore.getByProof`
when it is available. If you build a custom store, implement that method; without
it, the server can still consume individual challenges once, but it cannot detect
one transaction digest being replayed against a different challenge.

## Local Live Verification

Start Redis and Postgres:

```powershell
npm run infra:up
```

Run the live storage integration test:

```powershell
$env:SUI402_REDIS_URL="redis://localhost:6379"
$env:SUI402_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
npm run test:storage:integration
```

Stop local infrastructure:

```powershell
npm run infra:down
```
