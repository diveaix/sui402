# Testnet Rehearsal Evidence - 2026-06-18

Generated: 2026-06-18T13:05:52.574Z  
Environment file: .env.testnet-rehearsal  
Loaded defaults: SUI402_INDEXER_CONSOLE_API_KEY, SUI402_REDIS_URL, SUI402_POSTGRES_URL, SUI402_CONSOLE_POSTGRES_URL, SUI402_WALRUS_PUBLISHER_URL, SUI402_WALRUS_AGGREGATOR_URL

## Operator Summary

- Result: PASS for local Testnet payment -> receipt -> settlement -> indexer reconciliation. Production launch remains blocked by real `.env.production` secret rotation and formal launch evidence.
- Rehearsal window: 2026-06-18 12:59-13:05 UTC / 18:29-18:35 IST
- Operator(s): Codex local rehearsal
- Notes link: this evidence file

## Preflight Snapshot

| Check | Evidence |
| --- | --- |
| Node.js version | v22.19.0 |
| npm version | 11.6.2 |
| Sui CLI version | sui 1.73.1-ff1fe0ec4551-dirty |
| Sui active env | testnet |
| Sui active address | 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |
| Sui balance | Funded Testnet address; exact CLI table omitted because Windows console table rendering is not stable in Markdown evidence |

Expected Sui active env: `testnet`.

## Package And Service Configuration

| Field | Value |
| --- | --- |
| session package id | 0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b |
| settlement package id | 0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b |
| Published.toml published-at | 0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b |
| Published.toml original-id | 0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9 |
| merchant address | 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |
| coin type | 0x2::sui::SUI |
| price | 1000000 |
| resource scope | api:market-feed |
| network | sui:testnet |
| Sui gRPC URL | https://fullnode.testnet.sui.io/ |
| console base URL | http://127.0.0.1:4031/ |
| provider base URL | http://127.0.0.1:4031/ |
| dashboard URL | not started for this CLI/API rehearsal |
| dashboard console API URL | http://127.0.0.1:4031/ |
| session endpoint | http://127.0.0.1:4031/gateway/merchants/atlas-api/pay |
| payment endpoint | http://127.0.0.1:4031/gateway/merchants/atlas-api/pay |
| Walrus publisher URL | not configured for this rehearsal |
| Walrus aggregator URL | not configured for this rehearsal |

## Session Payment Evidence

| Field | Value |
| --- | --- |
| session id | 0xc82e7b3237f9e640a7a01c13a6deddfa6a2d1819e17ff052c9345813fcc204c8 |
| session open tx digest | 53diYoTBbgq8ynsza9dQVv91AJWxKueqXKC1GdZBXjJm |
| session spend tx digest | AR9Quw5bdAfYn3pcF7vZig1KL6ziceE454hotJQmLEMV |
| session close tx digest | not closed during this rehearsal |
| HTTP retry response | status 200; response `paid=true`, merchant `atlas-api`, resource `api:market-feed` |
| payment record id | sui:testnet:AR9Quw5bdAfYn3pcF7vZig1KL6ziceE454hotJQmLEMV:6d556302a395a556eddfcc5f536071e213bb9e6516dd6ceaf5e444aa06447264 |
| challenge id | 6d556302a395a556eddfcc5f536071e213bb9e6516dd6ceaf5e444aa06447264 |

## Receipt Evidence

| Field | Value |
| --- | --- |
| receipt id | 373f3e158b34cf1d7a6ce3a682863e63e15591921b3f1858c7a2d2fbc7a95425 |
| signer address | 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |
| payer | 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |
| merchant | 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |
| amount | 1000000 |
| sequence | 1 |
| receipt issued at | 2026-06-18T13:03:42.325Z |

## Settlement Ledger Evidence

| Field | Value |
| --- | --- |
| settlement ledger id | 0xe9f27cdd9e99f1dee3d1dd10e6dfa28f0728498d5e03a58f3683e7397cc0e124 |
| create-ledger tx digest | FbjdvWhabBunx7a2NBvj7hdSzruhby88vzbbKuaMhHQC |
| settlement tx digest | ApB77TRaRhXEuxxFTwCi5euvpyXtBcEt5CEhT5BPfxRR |
| settled receipt id | 373f3e158b34cf1d7a6ce3a682863e63e15591921b3f1858c7a2d2fbc7a95425 |
| inspect-ledger result | receiptCount=1, totalAmount=1000000, owner=0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6 |

## Indexer Evidence

| Field | Value |
| --- | --- |
| source | grpc |
| sink | console-http |
| package id | 0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b |
| start checkpoint | 349913563 |
| cursor key | settlement:0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b:0x2::sui::SUI |
| cursor value | 349913688:0 |
| cursor updated at | 2026-06-18T13:05:36.538Z |
| indexed settlement result | receipt ApB77TRaRhXEuxxFTwCi5euvpyXtBcEt5CEhT5BPfxRR receipt=373f3e158b34cf1d7a6ce3a682863e63e15591921b3f1858c7a2d2fbc7a95425 ledger=0xe9f27cdd9e99f1dee3d1dd10e6dfa28f0728498d5e03a58f3683e7397cc0e124 |

## Reconciliation Evidence

| Moment | Evidence |
| --- | --- |
| before settlement | receiptPaymentCount=1, indexedReceiptEventCount=0, settledCount=0, unsettledCount=1, mismatchedCount=0, duplicateCount=0, orphanedEventCount=0 |
| after settlement | receiptPaymentCount=1, indexedReceiptEventCount=1, settledCount=1, unsettledCount=0, mismatchedCount=0, duplicateCount=0, orphanedEventCount=0 |
| dashboard status | not started for this CLI/API rehearsal; API reconciliation endpoint is green |

## Walrus Evidence

| Export | Blob ID | Object ID | Created At |
| --- | --- | --- | --- |
| payment ledger | not run | not run | Walrus export was not configured for this rehearsal |
| receipt bundle | not run | not run | Walrus export was not configured for this rehearsal |

## Failures And Fixes

| Time | Failure | Cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| 2026-06-18T12:59Z | Session spend returned 402 after a successful Testnet spend | Sui gRPC emitted the framework coin type as `0x000...0002::sui::SUI`, while verifier compared against `0x2::sui::SUI` | Normalize hex address segments inside Move type strings before coin-type matching | Added zero-padded coin type regression; reran Testnet session payment successfully with HTTP 200 |

## Commands Run

```powershell
npm run rehearsal:check -- --env-file .env.testnet-rehearsal
npm run session:demo
npm run settlement:create-ledger
npm run rehearsal:receipt-env
npm run settlement:settle-receipt
npm run indexer:sync -- --max-pages 5 --grpc-max-checkpoints-per-page 25
npm run indexer:sync -- --event-kind settlement --package-id $env:SUI402_SETTLEMENT_PACKAGE_ID --max-pages 5 --grpc-max-checkpoints-per-page 25
npm run settlement:inspect-ledger
npm run rehearsal:evidence -- --env-file .env.testnet-rehearsal
```
