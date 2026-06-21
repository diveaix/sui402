# Sui402 Registry

`@sui402/registry` is the Phase 4 foundation for paid API and MCP discovery.
It defines a normalized listing format plus an Express router for registry APIs.

This is not the whole marketplace yet. Real marketplace work still needs seller
accounts, moderation, reputation, billing analytics, and durable indexed search.
This package gives agents and hosted gateways a concrete listing contract now.

## Listing Shape

Each listing describes one paid resource:

- HTTP API or MCP transport
- provider base URL
- Sui network, merchant, coin type, and price
- resource scope and scope hash
- session support and session manager URL
- protected resource URL or MCP server URL
- tags, status, and metadata

Listings can be created directly or derived from a provider manifest:

```ts
import { createListingFromManifest } from "@sui402/registry";

const listing = createListingFromManifest({
  id: "premium-api",
  name: "Premium API",
  providerBaseUrl: "https://merchant.example",
  transport: "http",
  manifest,
  tags: ["data"]
});
```

## Registry Router

```ts
import express from "express";
import { MemoryListingStore, createRegistryRouter } from "@sui402/registry";

const app = express();
const store = new MemoryListingStore();

app.use(
  "/registry",
  createRegistryRouter({
    store,
    adminApiKey: process.env.SUI402_REGISTRY_ADMIN_API_KEY
  })
);
```

Routes:

- `GET /registry/listings`
- `GET /registry/listings?network=sui:testnet&transport=http&tag=data`
- `GET /registry/listings/:id`
- `POST /registry/listings`

Writes are disabled unless an admin key is configured. Authenticated writes use:

```text
Authorization: Bearer <key>
```

or:

```text
x-sui402-admin-key: <key>
```

## Production Note

`MemoryListingStore` is for tests and local development. A production marketplace
needs a durable store with review workflow and abuse controls. The router/store
interface is intentionally small so a Postgres-backed registry can replace it
without changing client-facing routes.
