# Deployments

## Testnet

Published with `sui 1.72.1`.

```text
latestPackageId: 0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b
originalPackageId: 0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9
publishDigest: 6BUp5VZhj4sEGBr31hQzLaWoU1tisNRJDoagxC8BLap1
upgradeDigest: 9UjVquayQFD7utJsGuR5P71KLbRF18WxMFD3zf3QyQLU
publisher: 0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6
upgradeCap: 0xa28af186e5aef06e8ae600e90a2b37fd4284bee82e6c4e93761823c6ca657dcb
version: 2
modules: sessions, settlement
```

Use `latestPackageId` for Move calls. Use `originalPackageId` when querying
objects whose types are anchored to the original package.

Smoke test:

```text
sessionId: 0x86abc8b09d3894b406e3bc806e31075c7e6fbd20fe4c1d077d1c572aa4b0baf3
openDigest: 5tTZYekxd2Fgt7LBqfYRG3vN4YRsYXfenccB9aaZujS5
spendDigest: BAa6UjMWKZ7BfpYZ1G7NnXYCm3rt7BNEfm8GBWNQb12S
closeDigest: AkuQmx7xBcP4kQj3pWfoEEC8Di9SbVBgdhXfx9rtm2VQ
resourceScope: mcp:*
resourceScopeHash: 0a67659a3165db3f8279a14a951941663d0749d071d5031f38dcf044350f4bc6
```

The session was opened with 10,000,000 MIST, spent 1,000,000 MIST, and then closed.

HTTP session-payment smoke test:

```text
sessionId: 0x3533a67bc18d1f85d8c29696f31d8b26c27b212dc21dcd2c069a5fba55fdd7cd
openDigest: 6faUBGhHvDdtS4TBSCcK79FQUw7p9xW93E4CKSb2gotg
successfulHttpSpendDigest: EEYBe27AueiEJwdPHcanZHe3WN2gydntSdsusXSGEdf9
closeDigest: H3q6rtie6AcbUZGWePgN7A8BjKsXhTR1niBEBg5GMxmU
```

This test exercised:

```text
GET /premium/session-market -> 402 challenge
sui client ptb -> sessions::spend
retry with Sui402-Payment header -> 200 response
```
