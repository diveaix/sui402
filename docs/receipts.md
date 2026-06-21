# Spend Receipts

`@sui402/receipts` is the Phase 6 primitive for low-cost nanopayments and future
batched settlement.

Sessions already avoid one on-chain transaction per protected resource. Spend
receipts go one step further: an agent can produce signed off-chain receipts for
tiny usage events, and a future settlement layer can aggregate them.

Real talk: this package is not a full settlement protocol by itself. It provides
canonical receipt IDs, Ed25519 signatures, tamper detection, and expiry checks.
The Move package now includes a first settlement ledger module for receipt replay
accounting and batch evidence, but production batching still needs escrowed fund
movement, dispute windows, finality rules, and external audit.

The package also includes `createSessionSpendReceiptIssuer`, which issues signed
session spend receipts from verified session payment context. Use a durable
`ReceiptSequenceStore` in production; the memory sequence store is only for
single-process development and tests.

## Receipt

```ts
import {
  AwsKmsEd25519SpendReceiptSigner,
  GcpKmsEd25519SpendReceiptSigner,
  createSpendReceipt,
  signSpendReceipt,
  signSpendReceiptWithSigner
} from "@sui402/receipts";

const receipt = createSpendReceipt({
  network: "sui:testnet",
  sessionId: "0x...",
  payer: "0x...",
  merchant: "0x...",
  coinType: "0x2::sui::SUI",
  amount: "1",
  resource: "api:tiny-call",
  sequence: "1",
  issuedAt: new Date().toISOString(),
  expiresAt: "2026-05-20T00:00:00.000Z"
});

const signed = signSpendReceipt({
  receipt,
  signer: "0x...",
  privateKey
});

const kmsReadySigned = await signSpendReceiptWithSigner({
  receipt,
  receiptSigner: {
    signer: "0x...",
    signatureScheme: "ed25519",
    sign: async (bytes) => callKmsOrHsm(bytes)
  }
});
```

`signSpendReceipt` is the local PEM/private-key helper. For production,
`signSpendReceiptWithSigner` and `createSessionSpendReceiptIssuer({ receiptSigner })`
accept any Ed25519 signer that returns a base64url signature over the canonical
receipt bytes. The package includes structural adapters for AWS KMS and GCP KMS,
and the same interface can wrap Vault Transit or an HSM-backed signer.

AWS KMS Ed25519:

```ts
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { AwsKmsEd25519SpendReceiptSigner } from "@sui402/receipts";

const awsSigner = new AwsKmsEd25519SpendReceiptSigner({
  signer: "0x...",
  keyId: "arn:aws:kms:us-east-1:123456789012:key/...",
  client: new KMSClient({ region: "us-east-1" }),
  commandFactory: (input) => new SignCommand(input)
});
```

GCP KMS Ed25519:

```ts
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { GcpKmsEd25519SpendReceiptSigner } from "@sui402/receipts";

const gcpSigner = new GcpKmsEd25519SpendReceiptSigner({
  signer: "0x...",
  keyVersionName:
    "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
  client: new KeyManagementServiceClient(),
  requireVerifiedDataCrc32c: true
});
```

AWS KMS Ed25519 signing uses `MessageType: "RAW"` and
`SigningAlgorithm: "ED25519_SHA_512"`. GCP KMS Ed25519 uses raw `data`, not a
pre-hashed digest. Verify the cloud key's public key against a known receipt
signature before trusting a new signer id.

Settlement note: the current Sui Move settlement ledger stores `signer` as a
Sui address. If receipts will be reconciled against on-chain settlement events,
use the settlement signer address as the receipt signer id and keep the KMS key
id in signer infrastructure metadata.

## Verification

```ts
import { verifySignedSpendReceipt } from "@sui402/receipts";

const result = verifySignedSpendReceipt(signed, publicKey);
if (!result.ok) {
  throw new Error(result.reason);
}
```

Verification checks:

- canonical receipt id
- expiry
- Ed25519 signature over canonical receipt JSON

Receipts include `sessionId`, `payer`, `merchant`, `coinType`, `amount`,
`resource`, `resourceScopeHash`, and `sequence` so they can later be grouped for
settlement.

## Finality And Disputes

`@sui402/receipts` includes policy helpers for off-chain settlement operations:

```ts
import {
  evaluateReceiptFinality,
  validateMonotonicReceiptSequences
} from "@sui402/receipts";

const finality = evaluateReceiptFinality(receipt, {
  minSettlementDelaySeconds: 60,
  disputeWindowSeconds: 24 * 60 * 60,
  maxReceiptAgeSeconds: 7 * 24 * 60 * 60
});

const sequenceCheck = validateMonotonicReceiptSequences(batchReceipts);
```

Receipt finality states:

- `pending`: settlement delay is still open.
- `disputable`: settlement is allowed, but the dispute window is still open.
- `final`: dispute window has closed and the receipt is still valid.
- `expired`: receipt expired or exceeds the max age policy.

`validateMonotonicReceiptSequences` checks sequence monotonicity per
`network + sessionId + merchant + resourceScopeHash` stream. Use it before
submitting settlement batches so a merchant cannot accidentally settle a stale or
out-of-order receipt batch.

## On-Chain Settlement Ledger

`move/sui402_sessions/sources/settlement.move` adds the first Phase 6 on-chain
ledger primitive:

- `create_ledger` creates an owned `SettlementLedger`.
- `settle_receipt<T>` records one verified receipt id.
- `settle_batch<T>` records a merchant batch and emits batch evidence.
- `is_settled`, `receipt_count`, and `total_amount` expose replay-accounting
  state.

The ledger prevents the same receipt id from being settled twice and emits
`ReceiptSettled<T>` / `BatchSettled<T>` events for indexers and finance tools.

TypeScript PTB builders are exported from `@sui402/sui`:

```ts
import {
  buildCreateSettlementLedgerTransaction,
  buildSettleBatchTransaction
} from "@sui402/sui";

const createLedgerTx = buildCreateSettlementLedgerTransaction({
  packageId: "0x..."
});

const settleBatchTx = buildSettleBatchTransaction({
  packageId: "0x...",
  ledgerId: "0x...",
  merchant: "0x...",
  signer: "0x...",
  receipts: [
    {
      receiptId: "ab...cd",
      payer: "0x...",
      amount: "1000",
      sequence: "1",
      resourceScopeHash: "12...34"
    }
  ]
});
```

Real talk: this module assumes receipts were verified off-chain before
submission. It does not yet verify Ed25519 signatures on-chain or move escrowed
funds. Dispute/finality policy is enforced by the off-chain operator layer until
escrowed settlement is designed and audited.

## Settlement CLI

`@sui402/session-cli` exposes `sui402-settlement` for operator settlement
workflows:

```bash
SUI402_SETTLEMENT_PACKAGE_ID=0x... \
SUI_SECRET_KEY=suiprivkey... \
sui402-settlement create-ledger
```

Submit one receipt record:

```bash
SUI402_SETTLEMENT_PACKAGE_ID=0x... \
SUI402_SETTLEMENT_LEDGER_ID=0x... \
SUI402_RECEIPT_ID=ab...cd \
SUI402_PAYER_ADDRESS=0x... \
SUI402_MERCHANT_ADDRESS=0x... \
SUI402_RECEIPT_SIGNER_ADDRESS=0x... \
SUI402_RECEIPT_AMOUNT=1000 \
SUI402_RECEIPT_SEQUENCE=1 \
SUI402_RESOURCE_SCOPE_HASH=12...34 \
SUI_SECRET_KEY=suiprivkey... \
sui402-settlement settle-receipt
```

`create-ledger` and `settle-receipt` use `SUI_SECRET_KEY` or `SUI_MNEMONIC`
when provided. If neither is set, they fall back to the active Sui CLI wallet
and submit through `sui client ptb`. Batch settlement still expects SDK signer
environment today.

Submit a batch:

```json
{
  "merchant": "0x...",
  "signer": "0x...",
  "receipts": [
    {
      "receiptId": "ab...cd",
      "payer": "0x...",
      "amount": "1000",
      "sequence": "1",
      "resourceScopeHash": "12...34"
    }
  ]
}
```

```bash
SUI402_SETTLEMENT_PACKAGE_ID=0x... \
SUI402_SETTLEMENT_LEDGER_ID=0x... \
SUI402_SETTLEMENT_BATCH_FILE=settlement-batch.json \
SUI_SECRET_KEY=suiprivkey... \
sui402-settlement settle-batch
```

Inspect a ledger:

```bash
SUI402_SETTLEMENT_LEDGER_ID=0x... sui402-settlement inspect-ledger
```

## Rotation Runbook

1. Create a new Ed25519 asymmetric signing key or key version in KMS/HSM.
2. Export or fetch the public key and register it wherever receipt verification
   happens.
3. Deploy the provider with a new `SUI402_RECEIPT_SIGNER_ID` and injected signer
   pointing at the new key.
4. Keep the old public key trusted until all receipts signed by the old key have
   expired.
5. Disable, then schedule deletion of the old private key material or KMS key
   version after the receipt TTL and dispute window have elapsed.
6. Export a final receipt bundle to Walrus before disabling the old signer if
   finance/support teams need immutable audit evidence.
