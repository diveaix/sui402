# Sui402 Payment Sessions

Payment sessions are the Sui-native advantage.

One-shot payments are useful:

```text
one request -> one payment -> one response
```

Agents need budgets:

```text
fund session once -> spend many times under policy -> revoke or close
```

## Session Object

`AgentPaymentSession<T>` is an owned Sui object:

- `payer`
- `merchant`
- `balance`
- `spent`
- `max_per_request`
- `expires_ms`
- `resource_scope_hash`
- `revoked`

The payer owns the object, so the payer must authorize spends. A spend transfers
coins from the session balance to the merchant and emits `SessionSpent<T>`.

## Server Verification

A provider accepts a session proof when:

- challenge id matches
- network matches
- transaction succeeded
- transaction sender matches payer when supplied
- transaction emitted a matching `SessionSpent<T>` event
- session id, merchant, amount, coin type, challenge id, and resource scope hash match

The resource scope check is important. A session funded for `api:quotes` must
not unlock a different protected scope such as `api:admin` just because the
same merchant accepts both.

## Current State

The Move package is published on Sui testnet:

```text
0x1fee62ada105f56b7ab2288087519ed2dc22de92923db12582b5466c1e0010f9
```

The TypeScript SDK can now list and select usable owned sessions, so agent
clients do not need to hardcode a session object id before every paid request.

## Session Manager API

Providers can mount the read-only session manager router from `@sui402/server`:

```ts
app.use(
  "/sui402",
  createSui402SessionRouter({
    packageId,
    merchant,
    coinType,
    resourceScopeHash
  })
);
```

Endpoints:

- `GET /sui402/config`
- `GET /sui402/owners/:owner/sessions`
- `GET /sui402/owners/:owner/sessions/usable?amount=1000000`

The usable-session endpoint checks owner, merchant, coin type, scope hash,
available balance, per-request cap, expiry, and revocation status. It does not
sign transactions or move funds.

Agents and wallets can consume this API with `Sui402SessionManagerClient` from
`@sui402/client`:

```ts
const manager = new Sui402SessionManagerClient({
  baseUrl: "https://merchant.example/sui402"
});

const usable = await manager.findUsableSession(owner, { amount: "1000000" });
const tx = await manager.buildOpenSessionTransaction({
  maxPerRequest: "1000000",
  expiresMs: String(Date.now() + 86_400_000),
  funding: { kind: "sui", amount: "10000000" }
});
```

For the local provider API:

```powershell
npm run dev:provider
npm run session:inspect
```

## Agent CLI session UX

`@sui402/pay` keeps session operations non-custodial and plan-first:

```powershell
sui402-pay session inspect --resource https://api.example.com/weather --merchant 0x... --amount 1000
sui402-pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000
sui402-pay session fund --session-id 0x... --funding 2500
sui402-pay session close --session-id 0x...
```

`session inspect` now prints a readiness summary: matched sessions, usable
sessions, usable balance, largest usable balance, whether the requested amount
can be covered, and whether a paid call would fall back to a one-shot payment.
The JSON output includes the same `summary` block for agents.

`session open` and `session fund` print budget details before signing. For SUI
funding, the open plan shows how much will be locked in the user-owned session,
how many full requests at `max_per_request` that budget can cover, and any
remainder. State-changing commands still require `--yes`; without it they only
print the plan.

## Observed Session Index

Providers also expose an admin-only observed session index when payment records
are configured:

```text
GET /admin/sessions
GET /admin/sessions?payer=0x...&merchant=0x...&limit=50
GET /admin/sessions/:sessionId
```

This index is derived from verified session payment records. It tracks sessions
that have actually paid the provider, including total observed spend, spend
count, resources, first/last seen timestamps, and latest transaction digest.

Real talk: this is not a full chain indexer yet. It does not discover every
session object on Sui, and it cannot show a funded session before that session
has paid this provider. That is intentional for the first production slice:
operators need a reliable view of observed revenue and replay-protected session
usage before we add broader chain indexing.
