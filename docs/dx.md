# Developer Experience

`@sui402/create-sui402` scaffolds a production-shaped provider service using the
real provider API package.

## Scaffold

```bash
npm run dev -w @sui402/create-sui402 -- ./my-provider \
  --merchant 0x... \
  --price 1000000 \
  --network sui:testnet \
  --resource-scope api:*
```

Generated files:

- `package.json`
- `tsconfig.json`
- `.env.example`
- `src/server.ts`
- `README.md`

The generated server imports:

```ts
import { createProviderApp, createProviderStorage, loadProviderConfig } from "@sui402/provider-api";
```

That means generated projects use the same provider implementation as this
monorepo, not pasted sample logic.

## Safety Defaults

The scaffolder writes files with no overwrite. If the target already contains a
generated path, it fails instead of replacing user work.

The generated `.env.example` includes the merchant, coin type, price, resource
scope, and scope hash so providers can verify the payment surface before running.

## Dashboard

Run the hosted console frontend:

```bash
npm run dev:dashboard
```

The dashboard is a production-shaped frontend shell for merchant operations,
payment review, readiness checks, onboarding, marketplace discovery, and scan
inspection. It can fetch the console API when configured, and its server-rendered
agreement tests cover marketplace/scan cards against the public JSON contracts.

## MCP Client Config

`@sui402/mcp` ships `sui402-mcp-config`, which prints a ready-to-paste
`mcpServers` config block for MCP clients:

```bash
sui402-mcp-config \
  --merchant 0x... \
  --price 1000000 \
  --tool-name premium_context
```

Use `--tools-json` for multi-tool paid MCP servers and `--out <path>` for file
output.

## Agent Payment Helpers

`@sui402/client` can build and sign one-shot Sui402 payments for native SUI and
generic Sui coins such as USDC.

For SUI payments, the wallet/signer can split from the gas coin:

```ts
const handler = createSuiPaymentHandler(wallet);
```

For non-SUI coins, provide either a custom `coinSelector` or a coin-listing
client. The built-in selector pages through owned coin objects, chooses enough
balance, and passes those object IDs to the transaction builder:

```ts
const handler = createSuiPaymentHandler(wallet, {
  coinSelectionClient: suiClient,
  owner: walletAddress
});
```

The selector is intentionally separate from signing. The agent chooses a safe
payment action; the wallet still signs the resulting transaction.
