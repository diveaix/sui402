import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  SUI402_PAYMENT_HEADER,
  Sui402ProviderManifestSchema,
  encodeHeader,
  resourceScopeHash
} from "@sui402/protocol";
import { MemoryChallengeStore, MemoryPaymentRecordStore } from "@sui402/server";
import {
  MemoryMerchantStore,
  createGatewayManifest,
  createGatewayMerchantConfig,
  createGatewayRouter
} from "../src/index.js";

const MERCHANT = `0x${"a".repeat(64)}`;

describe("Sui402 gateway", () => {
  it("creates provider manifests for hosted merchants", () => {
    const merchant = createGatewayMerchantConfig({
      id: "merchant-api",
      service: "Merchant API",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*",
      sessionPackageId: `0x${"f".repeat(64)}`
    });
    const manifest = Sui402ProviderManifestSchema.parse(createGatewayManifest(merchant));

    expect(manifest.resourceScopeHash).toBe(resourceScopeHash("api:*"));
    expect(manifest.payments.kinds).toEqual(["one-shot", "session"]);
    expect(manifest.endpoints.protectedResource).toBe("/gateway/merchants/merchant-api/pay");
    expect(manifest.endpoints.sessionManager).toBe("/gateway/merchants/merchant-api/sessions");
  });

  it("serves the advertised session manager config for session-enabled gateway merchants", async () => {
    const store = new MemoryMerchantStore();
    await store.upsert(
      createGatewayMerchantConfig({
        id: "merchant-api",
        service: "Merchant API",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*",
        sessionPackageId: `0x${"f".repeat(64)}`
      })
    );
    const app = express();
    app.use("/gateway", createGatewayRouter({ merchants: store }));
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/gateway/merchants/merchant-api/sessions/config`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        network: "sui:testnet",
        packageId: `0x${"f".repeat(64)}`,
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        resourceScopeHash: resourceScopeHash("api:*")
      });
    } finally {
      server.close();
    }
  });

  it("does not expose session manager routes for one-shot-only merchants", async () => {
    const store = new MemoryMerchantStore();
    await store.upsert(
      createGatewayMerchantConfig({
        id: "one-shot-api",
        service: "One Shot API",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*"
      })
    );
    const app = express();
    app.use("/gateway", createGatewayRouter({ merchants: store }));
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/gateway/merchants/one-shot-api/sessions/config`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("sessions_not_enabled");
    } finally {
      server.close();
    }
  });

  it("protects merchant admin routes", async () => {
    const store = new MemoryMerchantStore();
    const app = express();
    app.use("/gateway", createGatewayRouter({ merchants: store }));
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/gateway/merchants`);
      expect(response.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("allows hosted merchant creation with admin auth", async () => {
    const store = new MemoryMerchantStore();
    const app = express();
    app.use("/gateway", createGatewayRouter({ merchants: store, adminApiKey: "gateway-admin-secret" }));
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/gateway/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer gateway-admin-secret"
        },
        body: JSON.stringify({
          id: "merchant-api",
          service: "Merchant API",
          network: "sui:testnet",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:*"
        })
      });

      expect(response.status).toBe(201);
      expect(await store.get("merchant-api")).toBeDefined();
    } finally {
      server.close();
    }
  });

  it("rejects unsafe merchant upstream URLs", () => {
    const baseMerchant = {
      id: "merchant-api",
      service: "Merchant API",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*"
    } as const;

    for (const upstreamUrl of [
      "ftp://api.example.com/search",
      "https://gateway-private:secret@api.example.com/search",
      "http://localhost/search",
      "http://localhost./search",
      "http://service.localhost./search",
      "http://metadata.google.internal./computeMetadata/v1",
      "http://127.0.0.1/search",
      "http://10.0.0.8/search",
      "http://172.16.0.8/search",
      "http://192.168.0.8/search",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/search",
      "http://[fc00::1]/search",
      "http://[fe80::1]/search",
      "http://[::ffff:127.0.0.1]/search"
    ]) {
      expect(() => createGatewayMerchantConfig({ ...baseMerchant, upstreamUrl }), upstreamUrl).toThrow();
    }

    expect(() =>
      createGatewayMerchantConfig({ ...baseMerchant, upstreamUrl: "https://api.example.com/search" })
    ).not.toThrow();
  });

  it("issues and verifies hosted payment challenges", async () => {
    const store = new MemoryMerchantStore();
    const records = new MemoryPaymentRecordStore();
    await store.upsert(
      createGatewayMerchantConfig({
        id: "merchant-api",
        service: "Merchant API",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*"
      })
    );
    const app = express();
    app.use(
      "/gateway",
      createGatewayRouter({
        merchants: store,
        challengeStore: new MemoryChallengeStore(),
        paymentRecords: records,
        verifierFactory: () => ({
          verifyPayment: async (_challenge, proof) =>
            ({
              ok: true,
              digest: proof.txDigest,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        })
      })
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const first = await fetch(`${base}/gateway/merchants/merchant-api/pay`);
      const body = await first.json();
      const challenge = body.challenge;
      const paid = await fetch(`${base}/gateway/merchants/merchant-api/pay`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: challenge.id,
            network: "sui:testnet",
            txDigest: "digest-1",
            paidAt: "2026-05-19T00:00:00.000Z"
          })
        }
      });
      const paidBody = await paid.json();

      expect(first.status).toBe(402);
      expect(paid.status).toBe(200);
      expect(paidBody.paid).toBe(true);
      expect(await records.getByProof("sui:testnet", "digest-1")).toBeDefined();
    } finally {
      server.close();
    }
  });

  it("proxies paid gateway requests to the merchant upstream", async () => {
    const upstreamHits: Array<{
      query: Record<string, unknown>;
      headers: Record<string, string | undefined>;
    }> = [];
    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof URL ? input.href : input instanceof Request ? input.url : String(input));
      if (url.hostname !== "publisher.example") {
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers);
      const query = Object.fromEntries(url.searchParams.entries());
      upstreamHits.push({
        query,
        headers: {
          merchantId: headers.get("x-sui402-merchant-id") ?? undefined,
          resourceScope: headers.get("x-sui402-resource-scope") ?? undefined,
          paymentDigest: headers.get("x-sui402-payment-digest") ?? undefined,
          rawPayment: headers.get(SUI402_PAYMENT_HEADER) ?? undefined,
          authorization: headers.get("authorization") ?? undefined,
          cookie: headers.get("cookie") ?? undefined
        }
      });

      return new Response(JSON.stringify({ proxied: true, query }), {
        status: 207,
        headers: {
          "content-type": "application/json",
          "x-publisher-response": "ok"
        }
      });
    });

    const store = new MemoryMerchantStore();
    const records = new MemoryPaymentRecordStore();
    const gatewayApp = express();
    const gatewayServer = gatewayApp.listen(0);

    try {
      await store.upsert(
        createGatewayMerchantConfig({
          id: "publisher-api",
          service: "Publisher API",
          network: "sui:testnet",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:publisher",
          upstreamUrl: "https://publisher.example/publisher/search"
        })
      );
      gatewayApp.use(
        "/gateway",
        createGatewayRouter({
          merchants: store,
          challengeStore: new MemoryChallengeStore(),
          paymentRecords: records,
          verifierFactory: () => ({
            verifyPayment: async (_challenge, proof) =>
              ({
                ok: true,
                digest: proof.txDigest,
                recipient: MERCHANT,
                amount: "1000",
                coinType: "0x2::sui::SUI"
              }) as const
          })
        })
      );

      const base = serverBaseUrl(gatewayServer);
      const first = await originalFetch(`${base}/gateway/merchants/publisher-api/pay?q=sui`);
      const body = await first.json();
      const challenge = body.challenge;
      const paid = await originalFetch(`${base}/gateway/merchants/publisher-api/pay?q=sui`, {
        headers: {
          authorization: "Bearer gateway-private",
          cookie: "gateway_session=secret",
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: challenge.id,
            network: "sui:testnet",
            txDigest: "digest-upstream",
            paidAt: "2026-05-19T00:00:00.000Z"
          })
        }
      });
      const paidBody = await paid.json();

      expect(first.status).toBe(402);
      expect(paid.status).toBe(207);
      expect(paid.headers.get("x-publisher-response")).toBe("ok");
      expect(paidBody).toEqual({ proxied: true, query: { q: "sui" } });
      expect(upstreamHits).toHaveLength(1);
      expect(upstreamHits[0]).toMatchObject({
        query: { q: "sui" },
        headers: {
          merchantId: "publisher-api",
          resourceScope: "api:publisher",
          paymentDigest: "digest-upstream",
          rawPayment: undefined,
          authorization: undefined,
          cookie: undefined
        }
      });
      expect(await records.getByProof("sui:testnet", "digest-upstream")).toBeDefined();
    } finally {
      upstreamFetch.mockRestore();
      gatewayServer.close();
    }
  });

  it("blocks unsafe stored upstream URLs before proxy fetch", async () => {
    const store = new MemoryMerchantStore();
    const records = new MemoryPaymentRecordStore();
    await store.upsert({
      ...createGatewayMerchantConfig({
        id: "metadata-api",
        service: "Metadata API",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:metadata"
      }),
      upstreamUrl: "http://169.254.169.254/latest/meta-data"
    });

    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      return originalFetch(input, init);
    });
    const app = express();
    app.use(
      "/gateway",
      createGatewayRouter({
        merchants: store,
        challengeStore: new MemoryChallengeStore(),
        paymentRecords: records,
        verifierFactory: () => ({
          verifyPayment: async (_challenge, proof) =>
            ({
              ok: true,
              digest: proof.txDigest,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        })
      })
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const first = await originalFetch(`${base}/gateway/merchants/metadata-api/pay`);
      const body = await first.json();

      expect(first.status).toBe(502);
      expect(body.error).toBe("unsafe_upstream_url");
      expect(upstreamFetch).not.toHaveBeenCalled();
      expect(await records.getByProof("sui:testnet", "digest-metadata")).toBeUndefined();
    } finally {
      upstreamFetch.mockRestore();
      server.close();
    }
  });

  it("enforces merchant payment policy before granting hosted access", async () => {
    const store = new MemoryMerchantStore();
    const records = new MemoryPaymentRecordStore();
    await store.upsert(
      createGatewayMerchantConfig({
        id: "session-only-api",
        service: "Session Only API",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*",
        paymentPolicy: {
          allowedNetworks: ["sui:testnet"],
          allowedMerchants: [MERCHANT],
          allowedCoinTypes: ["0x2::sui::SUI"],
          allowedResourceScopes: ["api:*"],
          requireSession: true,
          allowOneShot: false
        }
      })
    );
    const app = express();
    app.use(
      "/gateway",
      createGatewayRouter({
        merchants: store,
        challengeStore: new MemoryChallengeStore(),
        paymentRecords: records,
        verifierFactory: () => ({
          verifyPayment: async (_challenge, proof) =>
            ({
              ok: true,
              digest: proof.txDigest,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        })
      })
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const first = await fetch(`${base}/gateway/merchants/session-only-api/pay`);
      const body = await first.json();
      const challenge = body.challenge;
      const paid = await fetch(`${base}/gateway/merchants/session-only-api/pay`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: challenge.id,
            network: "sui:testnet",
            txDigest: "digest-policy-rejected",
            paidAt: "2026-05-19T00:00:00.000Z"
          })
        }
      });
      const paidBody = await paid.json();

      expect(first.status).toBe(402);
      expect(paid.status).toBe(403);
      expect(paidBody.error).toBe("payment_policy_violation");
      expect(await records.getByProof("sui:testnet", "digest-policy-rejected")).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

function serverBaseUrl(server: ReturnType<typeof import("node:http").createServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}
