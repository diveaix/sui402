# Sui402 Protocol v0

Sui402 uses HTTP `402 Payment Required` to negotiate machine payments on Sui.

## Provider Discovery

Providers expose `GET /.well-known/sui402` so agents can inspect payment terms
before calling protected resources.

```json
{
  "version": "sui402-0.1",
  "service": "merchant-api",
  "network": "sui:testnet",
  "merchant": "0x...",
  "coinType": "0x2::sui::SUI",
  "price": "1000000",
  "resourceScope": "api:*",
  "resourceScopeHash": "sha256...",
  "payments": {
    "kinds": ["one-shot", "session"],
    "challengeTtlSeconds": 300
  },
  "sessions": {
    "enabled": true,
    "packageId": "0x...",
    "managerPath": "/sui402"
  },
  "endpoints": {
    "wellKnown": "/.well-known/sui402",
    "protectedResource": "/v1/entitlements/current",
    "sessionManager": "/sui402"
  }
}
```

Agents should treat this as discovery metadata, not authorization. The actual
payment obligation is still the server-issued challenge returned with `402`.

## Challenge

Servers return a JSON challenge in the response body and in the
`Sui402-Challenge` header.

```json
{
  "version": "sui402-0.1",
  "id": "sha256...",
  "network": "sui:testnet",
  "recipient": "0x...",
  "coinType": "0x2::sui::SUI",
  "amount": "1000000",
  "resource": "GET https://api.example.com/premium-data",
  "nonce": "random",
  "expiresAt": "2026-05-18T12:00:00.000Z",
  "description": "Premium Sui market data"
}
```

`amount` is a string integer in the smallest unit of `coinType`.

## Payment Proof

Clients retry with `Sui402-Payment`.

```json
{
  "version": "sui402-0.1",
  "challengeId": "sha256...",
  "network": "sui:testnet",
  "txDigest": "...",
  "payer": "0x...",
  "paidAt": "2026-05-18T12:00:05.000Z"
}
```

## Verification

Servers must verify:

- challenge was issued by this server
- challenge is not expired
- challenge nonce/proof has not been consumed
- payment proof challenge/network match
- Sui transaction exists and succeeded
- transaction sender matches `payer` when available
- recipient balance increased by at least `amount` for `coinType`

## Replay Protection

v0 uses two layers of replay protection:

- Challenge replay protection: the challenge id plus nonce can be consumed once.
- Ledger replay protection: a `network + txDigest` pair can unlock only one
  challenge.

Production HTTP providers and MCP tool providers should persist issued/consumed
challenge state in Redis or a database and successful payment records in a
durable ledger such as Postgres.

MCP tools use the same replay model as HTTP endpoints. A paid tool call should
reject any proof whose transaction digest is already recorded in the payment
ledger.

## Session Extension

Sui402 sessions should eventually use a Move object with:

- payer
- merchant
- funded coin balance
- max per request
- expiry
- resource scope
- consumed counter

This avoids one transaction per request while preserving agent spending limits.
