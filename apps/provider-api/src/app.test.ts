import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createProviderApp } from "./app.js";
import type { ProviderConfig } from "./config.js";
import { MemoryPaymentRecordStore, type PaymentRecord } from "@sui402/server";
import { Sui402ProviderManifestSchema, createChallenge, resourceScopeHash } from "@sui402/protocol";

const MERCHANT = `0x${"a".repeat(64)}`;

const baseConfig: ProviderConfig = {
  NODE_ENV: "test",
  PORT: 4020,
  SUI402_NETWORK: "sui:testnet",
  SUI402_MERCHANT_ADDRESS: MERCHANT,
  SUI402_COIN_TYPE: "0x2::sui::SUI",
  SUI402_PRICE: "1000",
  SUI402_SESSION_PACKAGE_ID: undefined,
  SUI402_RESOURCE_SCOPE: "api:*",
  SUI402_CHALLENGE_TTL_SECONDS: 300,
  SUI402_SERVICE_NAME: "sui402-provider-api",
  SUI402_REDIS_URL: undefined,
  SUI402_POSTGRES_URL: undefined,
  SUI402_PAYMENT_RECORD_TABLE: "sui402_payment_records",
  SUI402_RUN_STORAGE_MIGRATIONS: false,
  SUI402_RATE_LIMIT_WINDOW_MS: 60_000,
  SUI402_RATE_LIMIT_MAX_REQUESTS: 2,
  SUI402_ADMIN_API_KEY: undefined,
  SUI402_ADMIN_MAX_PAYMENTS: 100,
  SUI402_RECEIPT_SIGNER_PROVIDER: "local",
  SUI402_RECEIPT_SIGNER_ID: undefined,
  SUI402_RECEIPT_PRIVATE_KEY_PEM: undefined,
  SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: undefined,
  SUI402_RECEIPT_TTL_SECONDS: 24 * 60 * 60
};

const silentLogger = {
  log: () => undefined
};

describe("provider app", () => {
  it("adds request ids, security headers, and readiness storage flags", async () => {
    const app = createProviderApp(baseConfig, {
      logger: silentLogger
    });
    const server = app.listen(0);

    try {
      const url = await serverUrl(server, "/health/ready");
      const response = await fetch(url, {
        headers: {
          "x-request-id": "request-1"
        }
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("request-1");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(body.durableChallenges).toBe(false);
      expect(body.durablePaymentRecords).toBe(false);
      expect(body.receiptsEnabled).toBe(false);
      expect(body.durableReceiptSequences).toBe(false);
      expect(body.distributedRateLimit).toBe(false);
    } finally {
      server.close();
    }
  });

  it("returns dependency-aware readiness and Prometheus metrics", async () => {
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_RATE_LIMIT_MAX_REQUESTS: 100
      },
      {
        logger: silentLogger,
        readinessChecks: {
          redis: async () => undefined,
          postgres: async () => {
            throw new Error("database unavailable");
          }
        }
      }
    );
    const server = app.listen(0);

    try {
      const ready = await fetch(await serverUrl(server, "/health/ready"));
      const readyBody = await ready.json();
      const metrics = await fetch(await serverUrl(server, "/metrics"));
      const metricsBody = await metrics.text();

      expect(ready.status).toBe(503);
      expect(readyBody).toMatchObject({
        ok: false,
        dependencies: {
          redis: { ok: true },
          postgres: { ok: false, error: "database unavailable" }
        }
      });
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      expect(metricsBody).toContain("sui402_http_requests_total");
      expect(metricsBody).toContain('path="/health/ready",status="503"');
    } finally {
      server.close();
    }
  });

  it("rate limits repeated requests", async () => {
    const app = createProviderApp(baseConfig, {
      logger: silentLogger
    });
    const server = app.listen(0);

    try {
      const url = await serverUrl(server, "/health/live");
      expect((await fetch(url)).status).toBe(200);
      expect((await fetch(url)).status).toBe(200);

      const limited = await fetch(url);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    } finally {
      server.close();
    }
  });

  it("exposes payment records only with an admin API key", async () => {
    const paymentRecords = new MemoryPaymentRecordStore();
    const payment = makePaymentRecord("payment-1");
    paymentRecords.record(payment);
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_RATE_LIMIT_MAX_REQUESTS: 100,
        SUI402_ADMIN_API_KEY: "admin-key-with-enough-length"
      },
      {
        logger: silentLogger,
        paymentRecords
      }
    );
    const server = app.listen(0);

    try {
      const url = await serverUrl(server, "/admin/payments");
      expect((await fetch(url)).status).toBe(401);

      const response = await fetch(url, {
        headers: {
          authorization: "Bearer admin-key-with-enough-length"
        }
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.count).toBe(1);
      expect(body.records[0].id).toBe(payment.id);
    } finally {
      server.close();
    }
  });

  it("exposes observed session index through the admin API", async () => {
    const paymentRecords = new MemoryPaymentRecordStore();
    const sessionPayment = makePaymentRecord("session-payment-1", {
      kind: "session",
      sessionId: `0x${"e".repeat(64)}`,
      payer: `0x${"b".repeat(64)}`,
      txDigest: "session-digest"
    });
    paymentRecords.record(sessionPayment);
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_RATE_LIMIT_MAX_REQUESTS: 100,
        SUI402_ADMIN_API_KEY: "admin-key-with-enough-length"
      },
      {
        logger: silentLogger,
        paymentRecords
      }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(await serverUrl(server, "/admin/sessions"), {
        headers: {
          "x-sui402-admin-key": "admin-key-with-enough-length"
        }
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.count).toBe(1);
      expect(body.sessions[0]).toMatchObject({
        sessionId: `0x${"e".repeat(64)}`,
        payer: `0x${"b".repeat(64)}`,
        merchant: MERCHANT,
        spendCount: 1,
        spentAmount: "1000",
        lastTxDigest: "session-digest"
      });
    } finally {
      server.close();
    }
  });

  it("reports distributed rate limiting when a shared limiter is configured", async () => {
    const app = createProviderApp(baseConfig, {
      logger: silentLogger,
      rateLimiter: {
        check: () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 })
      }
    });
    const server = app.listen(0);

    try {
      const response = await fetch(await serverUrl(server, "/health/ready"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.distributedRateLimit).toBe(true);
    } finally {
      server.close();
    }
  });

  it("reports receipt signing readiness when signer config and sequence store are present", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_RECEIPT_SIGNER_ID: MERCHANT,
        SUI402_RECEIPT_PRIVATE_KEY_PEM: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
      },
      {
        logger: silentLogger,
        receiptSequenceStore: {
          nextSequence: () => "1"
        }
      }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(await serverUrl(server, "/health/ready"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.receiptsEnabled).toBe(true);
      expect(body.receiptSignerProvider).toBe("local");
      expect(body.durableReceiptSequences).toBe(true);
    } finally {
      server.close();
    }
  });

  it("supports external receipt signer readiness", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_RECEIPT_SIGNER_PROVIDER: "external",
        SUI402_RECEIPT_SIGNER_ID: MERCHANT
      },
      {
        logger: silentLogger,
        receiptSigner: {
          signer: MERCHANT,
          signatureScheme: "ed25519",
          sign: (bytes: Buffer) => nodeSign(null, bytes, privateKey).toString("base64url")
        },
        receiptSequenceStore: {
          nextSequence: () => "1"
        }
      }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(await serverUrl(server, "/health/ready"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.receiptsEnabled).toBe(true);
      expect(body.receiptSignerProvider).toBe("external");
    } finally {
      server.close();
    }
  });

  it("requires an injected signer for external receipt signing", () => {
    expect(() =>
      createProviderApp(
        {
          ...baseConfig,
          SUI402_RECEIPT_SIGNER_PROVIDER: "external",
          SUI402_RECEIPT_SIGNER_ID: MERCHANT
        },
        {
          logger: silentLogger
        }
      )
    ).toThrow("External receipt signing requires ProviderAppOptions.receiptSigner");
  });

  it("exposes a machine-readable Sui402 provider manifest", async () => {
    const app = createProviderApp(
      {
        ...baseConfig,
        SUI402_SESSION_PACKAGE_ID: `0x${"f".repeat(64)}`,
        SUI402_RATE_LIMIT_MAX_REQUESTS: 100
      },
      {
        logger: silentLogger
      }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(await serverUrl(server, "/.well-known/sui402"));
      const manifest = Sui402ProviderManifestSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(manifest.version).toBe("sui402-0.1");
      expect(manifest.payments.kinds).toEqual(["one-shot", "session"]);
      expect(manifest.resourceScopeHash).toBe(resourceScopeHash("api:*"));
      expect(manifest.sessions.managerPath).toBe("/sui402");
      expect(manifest.endpoints.protectedResource).toBe("/v1/entitlements/current");
    } finally {
      server.close();
    }
  });
});

async function serverUrl(server: ReturnType<typeof import("node:http").createServer>, path: string): Promise<string> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return `http://127.0.0.1:${address.port}${path}`;
}

function makePaymentRecord(
  id: string,
  options: { kind?: "one-shot" | "session"; sessionId?: string; payer?: string; txDigest?: string } = {}
): PaymentRecord {
  const challenge = createChallenge({
    network: "sui:testnet",
    recipient: MERCHANT,
    coinType: "0x2::sui::SUI",
    amount: "1000",
    resource: "api:*",
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  const txDigest = options.txDigest ?? "digest";
  const payer = options.payer;

  return {
    id,
    challenge,
    proof:
      options.kind === "session"
        ? {
            version: "sui402-0.1",
            kind: "session",
            challengeId: challenge.id,
            sessionId: options.sessionId ?? `0x${"e".repeat(64)}`,
            network: "sui:testnet",
            txDigest,
            payer,
            spentAt: "2026-05-19T00:00:00.000Z"
          }
        : {
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: challenge.id,
            network: "sui:testnet",
            txDigest,
            payer,
            paidAt: "2026-05-19T00:00:00.000Z"
          },
    verification:
      options.kind === "session"
        ? {
            ok: true,
            digest: txDigest,
            sessionId: options.sessionId ?? `0x${"e".repeat(64)}`,
            payer,
            recipient: MERCHANT,
            amount: "1000",
            coinType: "0x2::sui::SUI"
          }
        : {
            ok: true,
            digest: txDigest,
            payer,
            recipient: MERCHANT,
            amount: "1000",
            coinType: "0x2::sui::SUI"
          },
    resource: challenge.resource,
    createdAt: "2026-05-19T00:00:00.000Z"
  };
}
