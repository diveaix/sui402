# Seller Configuration

Sui402 sellers are API or MCP providers that publish payment terms, issue
`402 Payment Required` challenges, and receive Sui payments.

## Testnet Provider

Use testnet for integration, wallet UX, and agent payment rehearsals.

```powershell
$env:NODE_ENV="production"
$env:PORT="4020"
$env:SUI402_NETWORK="sui:testnet"
$env:SUI402_MERCHANT_ADDRESS="0x..."
$env:SUI402_COIN_TYPE="0x2::sui::SUI"
$env:SUI402_PRICE="1000"
$env:SUI402_RESOURCE_SCOPE="api:premium"
$env:SUI402_SERVICE_NAME="seller-testnet-api"
$env:SUI402_ADMIN_API_KEY="replace-with-long-random-secret"
$env:SUI402_REDIS_URL="redis://localhost:6379"
$env:SUI402_POSTGRES_URL="postgres://sui402:sui402@localhost:5432/sui402"
$env:SUI402_RUN_STORAGE_MIGRATIONS="true"
npm run dev:provider
```

Real talk: keep testnet prices tiny. This still spends testnet gas and requires
a funded testnet wallet.

## Mainnet Provider

Mainnet should use durable storage, role-scoped console access, external receipt
signing, TLS, monitoring, backups, and an incident runbook.

```powershell
$env:NODE_ENV="production"
$env:PORT="4020"
$env:SUI402_NETWORK="sui:mainnet"
$env:SUI402_MERCHANT_ADDRESS="0x..."
$env:SUI402_COIN_TYPE="0x2::sui::SUI"
$env:SUI402_PRICE="1000000"
$env:SUI402_RESOURCE_SCOPE="api:premium"
$env:SUI402_SERVICE_NAME="seller-mainnet-api"
$env:SUI402_ADMIN_API_KEY="replace-with-long-random-secret"
$env:SUI402_REDIS_URL="redis://redis:6379"
$env:SUI402_POSTGRES_URL="postgres://sui402:password@postgres:5432/sui402"
$env:SUI402_RUN_STORAGE_MIGRATIONS="true"
node apps/provider-api/dist/server.js
```

## Stablecoin / USDC Sellers

For non-SUI coins, set `SUI402_COIN_TYPE` to the exact Sui coin type accepted by
the merchant. Agents can use `@sui402/client` with `coinSelectionClient` to
select enough owned coin objects for payment.

```ts
const handler = createSuiPaymentHandler(wallet, {
  coinSelectionClient: suiClient,
  owner: walletAddress
});
```

Consequences:

- Benefits: stablecoin pricing is easier for sellers and agents to reason about.
- Costs: agents need enough fragmented coin objects, plus SUI for gas.
- Risk: coin type mistakes are expensive; verify the exact mainnet/testnet coin
  type before publishing a seller manifest.

## Seller Checklist

- Use a merchant wallet controlled by the seller, not a developer test wallet.
- Configure `resourceScope` narrowly, such as `api:weather.premium` or
  `mcp:research/context`.
- Set Redis/Postgres storage before accepting real traffic.
- Use a unique long random `SUI402_ADMIN_API_KEY`.
- Prefer console OIDC or role-scoped operator keys over one shared admin key.
- Test `/.well-known/sui402` before sending agents to the provider.
- Run `npm run production:certify` before release.
- For mainnet, complete external audit, legal review, monitoring, and incident
  response setup first.
