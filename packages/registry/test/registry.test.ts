import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { resourceScopeHash, type Sui402ProviderManifest } from "@sui402/protocol";
import {
  MemoryListingStore,
  createListingFromManifest,
  createRegistryRouter,
  createServiceListing
} from "../src/index.js";

const MERCHANT = `0x${"a".repeat(64)}`;

describe("Sui402 registry", () => {
  it("creates marketplace listings from provider manifests", () => {
    const listing = createListingFromManifest({
      id: "premium-api",
      name: "Premium API",
      providerBaseUrl: "https://merchant.example",
      transport: "http",
      manifest: makeManifest(),
      tags: ["data"]
    });

    expect(listing.version).toBe("sui402-0.1");
    expect(listing.sessionSupported).toBe(true);
    expect(listing.sessionManagerUrl).toBe("https://merchant.example/sui402");
    expect(listing.protectedResourceUrl).toBe("https://merchant.example/v1/entitlements/current");
    expect(listing.tags).toEqual(["data"]);
  });

  it("filters listings by transport, network, tag, merchant, and status", async () => {
    const store = new MemoryListingStore();
    const active = createServiceListing({
      id: "active-api",
      name: "Active API",
      providerBaseUrl: "https://merchant.example",
      transport: "http",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*",
      resourceScopeHash: resourceScopeHash("api:*"),
      sessionSupported: true,
      tags: ["data"],
      status: "active"
    });
    const paused = createServiceListing({
      ...active,
      id: "paused-mcp",
      name: "Paused MCP",
      transport: "mcp",
      tags: ["tools"],
      status: "paused"
    });
    await store.upsert(active);
    await store.upsert(paused);

    expect(await store.list({ transport: "http", tag: "data", network: "sui:testnet", merchant: MERCHANT })).toEqual([
      active
    ]);
    expect(await store.list({ status: "paused" })).toEqual([paused]);
  });

  it("serves read-only listing discovery and protects writes", async () => {
    const store = new MemoryListingStore();
    await store.upsert(
      createServiceListing({
        id: "premium-api",
        name: "Premium API",
        providerBaseUrl: "https://merchant.example",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*",
        resourceScopeHash: resourceScopeHash("api:*"),
        sessionSupported: true,
        tags: ["data"]
      })
    );
    const app = express();
    app.use("/registry", createRegistryRouter({ store }));
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const response = await fetch(`${base}/registry/listings?tag=data`);
      const body = await response.json();
      const write = await fetch(`${base}/registry/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "new" })
      });

      expect(response.status).toBe(200);
      expect(body.count).toBe(1);
      expect(body.listings[0].id).toBe("premium-api");
      expect(write.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("allows authenticated listing upserts", async () => {
    const store = new MemoryListingStore();
    const app = express();
    app.use("/registry", createRegistryRouter({ store, adminApiKey: "registry-admin-secret" }));
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/registry/listings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer registry-admin-secret"
        },
        body: JSON.stringify({
          id: "premium-api",
          name: "Premium API",
          providerBaseUrl: "https://merchant.example",
          transport: "http",
          network: "sui:testnet",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:*",
          resourceScopeHash: resourceScopeHash("api:*"),
          sessionSupported: true,
          tags: ["data"]
        })
      });
      const listing = await response.json();

      expect(response.status).toBe(201);
      expect(listing.id).toBe("premium-api");
      expect(await store.get("premium-api")).toBeDefined();
    } finally {
      server.close();
    }
  });
});

function makeManifest(): Sui402ProviderManifest {
  return {
    version: "sui402-0.1",
    service: "merchant-api",
    network: "sui:testnet",
    merchant: MERCHANT,
    coinType: "0x2::sui::SUI",
    price: "1000",
    resourceScope: "api:*",
    resourceScopeHash: resourceScopeHash("api:*"),
    payments: {
      kinds: ["one-shot", "session"],
      challengeTtlSeconds: 300
    },
    sessions: {
      enabled: true,
      packageId: `0x${"f".repeat(64)}`,
      managerPath: "/sui402"
    },
    endpoints: {
      wellKnown: "/.well-known/sui402",
      protectedResource: "/v1/entitlements/current",
      sessionManager: "/sui402"
    }
  };
}

function serverBaseUrl(server: ReturnType<typeof import("node:http").createServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}
