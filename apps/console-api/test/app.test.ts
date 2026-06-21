import { mkdtempSync, rmSync } from "node:fs";
import { createHash, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createConsoleApp, createConsoleReceiptIssuerFactory, createConsoleStores } from "../src/app.js";
import { loadConsoleConfig, type ConsoleConfig } from "../src/config.js";
import { createChallenge, resourceScopeHash } from "@sui402/protocol";
import { createGatewayMerchantConfig } from "@sui402/gateway";
import { createServiceListing } from "@sui402/registry";
import { createSpendReceipt, signSpendReceipt, verifySignedSpendReceipt } from "@sui402/receipts";
import type { PaymentRecord } from "@sui402/server";
import type { SessionSpendRecord, SettlementRecord } from "@sui402/indexer";
import { buildSettlementReconciliationReport, buildSettlementReport } from "../src/settlements.js";
import {
  MemoryConsoleAuditLogStore,
  createConsoleAuditEvent,
  verifyAuditHashChain
} from "../src/audit.js";

const MERCHANT = `0x${"a".repeat(64)}`;
const execFileAsync = promisify(execFile);
const payCliPath = fileURLToPath(new URL("../../../packages/pay/dist/index.js", import.meta.url));
const PUBLIC_SURFACE_FORBIDDEN_KEYS = new Set([
  "accessToken",
  "adminApiKey",
  "apiKey",
  "authorization",
  "cookie",
  "cookies",
  "headers",
  "mnemonic",
  "operatorKey",
  "password",
  "paymentPolicy",
  "privateKey",
  "publisherAccessToken",
  "rawAuthorizationHeader",
  "rawHeaders",
  "rawRequestBody",
  "requestBody",
  "reviewNotes",
  "riskScore",
  "seedPhrase",
  "sessionPackageId",
  "upstreamTimeoutMs",
  "upstreamUrl",
  "verificationToken"
]);
const PUBLIC_SURFACE_FORBIDDEN_RAW_IDENTITY_KEYS = new Set(["payer", "sender", "submitter"]);
const PUBLIC_SURFACE_FORBIDDEN_KEYS_NORMALIZED = new Set(
  [...PUBLIC_SURFACE_FORBIDDEN_KEYS].map((key) => key.toLowerCase())
);
const PUBLIC_SURFACE_ALLOWED_LEAF_PATHS = [
  /^\$\.schemaVersion$/,
  /^\$\.generatedAt$/,
  /^\$\.dataSource$/,
  /^\$\.count$/,
  /^\$\.limit$/,
  /^\$\.hasMore$/,
  /^\$\.apis\[\]\.(id|name|description|transport|network|merchant|coinType|price|resourceScope|sessionSupported|protectedResourceUrl|sessionManagerUrl|status|updatedAt)$/,
  /^\$\.apis\[\]\.tags\[\]$/,
  /^\$\.apis\[\]\.readiness\.(ready|level)$/,
  /^\$\.apis\[\]\.readiness\.reasons\[\]$/,
  /^\$\.apis\[\]\.readiness\.checks\[\]\.(name|ok|message)$/,
  /^\$\.apis\[\]\.links\.(apiPath|apiUrl|publicPagePath|publicPageUrl|scanMerchantPath|scanMerchantUrl|scanPagePath|scanPageUrl)$/,
  /^\$\.apis\[\]\.commands\.(curl|search|scan|sessionOnly|sessionInspect)$/,
  /^\$\.apis\[\]\.paymentPlan\.(custody|authorizationMode|network|merchant|coinType|amountAtomic|maxOneShotAmount|resourceScope|resourceScopeHash|protectedResourceUrl|sessionSupported|sessionBehavior|sessionManagerUrl)$/,
  /^\$\.apis\[\]\.paymentPlan\.notes\[\]$/,
  /^\$\.apis\[\]\.stats\.(verifiedPayments|sessionPayments|volume)$/,
  /^\$\.apis\[\]\.reliability\.(paidTestObserved|verifiedPayments|sessionPayments|oneShotPayments|recentIndexedPayments|firstVerifiedPaymentAt|lastVerifiedPaymentAt)$/,
  /^\$\.apis\[\]\.reliability\.evidenceWindow\.(from|to|payments)$/,
  /^\$\.apis\[\]\.reliability\.notes\[\]$/,

  /^\$\.api\.(id|name|description|transport|network|merchant|coinType|price|resourceScope|sessionSupported|protectedResourceUrl|sessionManagerUrl|status|updatedAt)$/,
  /^\$\.api\.tags\[\]$/,
  /^\$\.api\.readiness\.(ready|level)$/,
  /^\$\.api\.readiness\.reasons\[\]$/,
  /^\$\.api\.readiness\.checks\[\]\.(name|ok|message)$/,
  /^\$\.api\.links\.(apiPath|apiUrl|publicPagePath|publicPageUrl|scanMerchantPath|scanMerchantUrl|scanPagePath|scanPageUrl)$/,
  /^\$\.api\.commands\.(curl|search|scan|sessionOnly|sessionInspect)$/,
  /^\$\.api\.paymentPlan\.(custody|authorizationMode|network|merchant|coinType|amountAtomic|maxOneShotAmount|resourceScope|resourceScopeHash|protectedResourceUrl|sessionSupported|sessionBehavior|sessionManagerUrl)$/,
  /^\$\.api\.paymentPlan\.notes\[\]$/,
  /^\$\.api\.stats\.(verifiedPayments|sessionPayments|volume)$/,
  /^\$\.api\.reliability\.(paidTestObserved|verifiedPayments|sessionPayments|oneShotPayments|recentIndexedPayments|firstVerifiedPaymentAt|lastVerifiedPaymentAt)$/,
  /^\$\.api\.reliability\.evidenceWindow\.(from|to|payments)$/,
  /^\$\.api\.reliability\.notes\[\]$/,
  /^\$\.merchant\.(id|service|network|merchant|coinType|price|resourceScope|status|sessionsEnabled)$/,
  /^\$\.listing\.(id|name|description|transport|network|merchant|coinType|price|resourceScope|sessionSupported|protectedResourceUrl|sessionManagerUrl|status|updatedAt)$/,
  /^\$\.listing\.tags\[\]$/,
  /^\$\.listing\.readiness\.(ready|level)$/,
  /^\$\.listing\.readiness\.reasons\[\]$/,
  /^\$\.listing\.readiness\.checks\[\]\.(name|ok|message)$/,
  /^\$\.listing\.links\.(apiPath|apiUrl|publicPagePath|publicPageUrl|scanMerchantPath|scanMerchantUrl|scanPagePath|scanPageUrl)$/,
  /^\$\.listing\.commands\.(curl|search|scan|sessionOnly|sessionInspect)$/,
  /^\$\.listing\.paymentPlan\.(custody|authorizationMode|network|merchant|coinType|amountAtomic|maxOneShotAmount|resourceScope|resourceScopeHash|protectedResourceUrl|sessionSupported|sessionBehavior|sessionManagerUrl)$/,
  /^\$\.listing\.paymentPlan\.notes\[\]$/,
  /^\$\.listing\.stats\.(verifiedPayments|sessionPayments|volume)$/,
  /^\$\.listing\.reliability\.(paidTestObserved|verifiedPayments|sessionPayments|oneShotPayments|recentIndexedPayments|firstVerifiedPaymentAt|lastVerifiedPaymentAt)$/,
  /^\$\.listing\.reliability\.evidenceWindow\.(from|to|payments)$/,
  /^\$\.listing\.reliability\.notes\[\]$/,
  /^\$\.trust\.(listingPublished|merchantPublished|upstreamConfigured|sessionsEnabled)$/,
  /^\$\.readiness\.(ready|level)$/,
  /^\$\.readiness\.reasons\[\]$/,
  /^\$\.readiness\.checks\[\]\.(name|ok|message)$/,
  /^\$\.commands\.(curl|search|scan)$/,
  /^\$\.commands\.(sessionOnly|sessionInspect)$/,
  /^\$\.paymentPlan\.(custody|authorizationMode|network|merchant|coinType|amountAtomic|maxOneShotAmount|resourceScope|resourceScopeHash|protectedResourceUrl|sessionSupported|sessionBehavior|sessionManagerUrl)$/,
  /^\$\.paymentPlan\.notes\[\]$/,
  /^\$\.stats\.(verifiedPayments|sessionPayments|volume)$/,
  /^\$\.reliability\.(paidTestObserved|verifiedPayments|sessionPayments|oneShotPayments|recentIndexedPayments|firstVerifiedPaymentAt|lastVerifiedPaymentAt)$/,
  /^\$\.reliability\.evidenceWindow\.(from|to|payments)$/,
  /^\$\.reliability\.notes\[\]$/,
  /^\$\.links\.(apiPath|apiUrl|publicPagePath|publicPageUrl|scanMerchantPath|scanMerchantUrl|scanPagePath|scanPageUrl|marketplacePath|marketplaceUrl|protectedResourceUrl|sessionManagerUrl|merchantApiPath|merchantApiUrl|merchantPublicPagePath|merchantPublicPageUrl|merchantMarketplacePath|merchantMarketplaceUrl|publicPagePath|publicPageUrl)$/,

  /^\$\.totals\.(apis|activeApis|sellers|verifiedPayments|sessionPayments|indexedSessionSpends)$/,
  /^\$\.(networks|transports|coins|volumeByCoin)\.[^.]+$/,
  /^\$\.recentPayments\[\]\.(id|digest|displayDigest|network|kind|challengeId|merchantId|recipient|coinType|amount|resource|createdAt|sessionId)$/,
  /^\$\.recentPayments\[\]\.evidence\.(class|source|publicIdentifier|challengeId|observedAt)$/,
  /^\$\.recentPayments\[\]\.evidence\.classes\[\]$/,
  /^\$\.recentPayments\[\]\.links\.(apiPath|apiUrl|publicPagePath|publicPageUrl|merchantApiPath|merchantApiUrl|merchantPublicPagePath|merchantPublicPageUrl|merchantMarketplacePath|merchantMarketplaceUrl)$/,
  /^\$\.recentPayments\[\]\.receipt\.(id|signer|sequence|expiresAt)$/,

  /^\$\.(id|digest|displayDigest|network|kind|challengeId|merchantId|recipient|coinType|amount|resource|createdAt|sessionId)$/,
  /^\$\.evidence\.(class|source|publicIdentifier|challengeId|observedAt|eventSeq|indexedAt)$/,
  /^\$\.evidence\.classes\[\]$/,
  /^\$\.indexerProgress\.(eventKind|cursorKey|cursor|updatedAt|checkpoint|eventOffset|label)$/,
  /^\$\.receipt\.(id|signer|sequence|expiresAt)$/,
  /^\$\.caveats\[\]$/,

  /^\$\.(sessionId|packageId|payerHash|merchant|spendCount|spentAmount|spentTotal|firstSeenAt|lastSeenAt|lastTxDigest)$/,
  /^\$\.identityRedaction\.(payer|sender|signer|submitter)$/,
  /^\$\.resourceScopeHashes\[\]$/,
  /^\$\.spends\[\]\.(id|network|packageId|coinType|txDigest|eventSeq|sessionId|payerHash|merchant|amount|spentTotal|challengeId|resourceScopeHash|senderHash|timestampMs|indexedAt)$/,
  /^\$\.spends\[\]\.identityRedaction\.(payer|sender)$/,
  /^\$\.spends\[\]\.evidence\.(class|source|publicIdentifier|eventSeq|indexedAt)$/,

  /^\$\.(packageId|txDigest|eventSeq|ledgerId|receiptId|payerHash|signerHash|sequence|resourceScopeHash|submitterHash|receiptCount|totalAmount|senderHash|timestampMs|indexedAt)$/
];

const baseConfig: ConsoleConfig = {
  NODE_ENV: "test",
  PORT: 4030,
  SUI402_CONSOLE_ADMIN_API_KEY: undefined,
  SUI402_CONSOLE_OIDC_ROLE_CLAIM: "roles",
  SUI402_CONSOLE_OIDC_SUBJECT_CLAIM: "sub",
  SUI402_CONSOLE_PROVIDER_BASE_URL: "http://localhost:4030",
  SUI402_CONSOLE_STORAGE_DRIVER: "memory",
  SUI402_CONSOLE_FILE_STORE_PATH: ".sui402/console-store.json",
  SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE: "sui402_merchant_applications",
  SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE: "sui402_merchant_change_requests",
  SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE: "sui402_settlement_events",
  SUI402_CONSOLE_INDEXER_CURSOR_TABLE: "sui402_indexer_cursors",
  SUI402_CONSOLE_AUDIT_TABLE: "sui402_console_audit_events",
  SUI402_CONSOLE_RATE_LIMIT_TABLE: "sui402_console_rate_limits",
  SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX: 20,
  SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS: 60000,
  SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX: 30,
  SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS: 60000,
  SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX: 600,
  SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_WINDOW_MS: 60000,
  SUI402_CONSOLE_PUBLIC_READ_CACHE_SECONDS: 15,
  SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS: 72,
  SUI402_RECEIPT_SIGNER_PROVIDER: "local",
  SUI402_RECEIPT_SIGNER_ID: undefined,
  SUI402_RECEIPT_PRIVATE_KEY_PEM: undefined,
  SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: undefined,
  SUI402_RECEIPT_TTL_SECONDS: 86400,
  SUI402_WALRUS_PUBLISHER_URL: undefined,
  SUI402_WALRUS_EPOCHS: 5
};

describe("console API", () => {
  it("rejects unknown public-surface fields in the field policy guard", () => {
    expect(collectPublicSurfacePolicyViolations({ api: { id: "safe", debugTrace: "private-ish" } })).toEqual([
      "unknown:$.api.debugTrace"
    ]);
  });

  it("appends audit events with monotonic timestamps and an intact hash chain", async () => {
    const audit = new MemoryConsoleAuditLogStore();
    const createdAt = "2026-05-19T00:00:00.000Z";
    await Promise.all(
      ["audit-a", "audit-b", "audit-c"].map((id) =>
        audit.append({
          id,
          action: "merchant_application.submit",
          createdAt
        })
      )
    );
    const events = audit.list({ limit: 10 });

    expect(verifyAuditHashChain(events)).toMatchObject({ ok: true, checked: 3 });
    expect(new Set(events.map((event) => event.createdAt)).size).toBe(3);
  });

  it("redacts secret-shaped audit metadata before hashing or storage", () => {
    const event = createConsoleAuditEvent({
      id: "audit-secret-redaction",
      action: "merchant_application.publisher_session.issue",
      createdAt: "2026-05-19T00:00:00.000Z",
      metadata: {
        merchantId: "weather-api",
        accessTokenHash: "sha256:abc123",
        headers: {
          authorization: "Bearer sui402p_super-secret",
          "x-sui402-publisher-token": "sui402p_header-secret"
        },
        nested: [
          {
            publisherSessionToken: "sui402ps_session-secret",
            safeDigest: "payment-digest-1"
          },
          "copy this token sui402v_public-verification-token"
        ]
      }
    });

    const encoded = JSON.stringify(event);

    expect(event.metadata).toMatchObject({
      merchantId: "weather-api",
      accessTokenHash: "sha256:abc123",
      headers: "[redacted:audit-secret]",
      nested: [
        {
          publisherSessionToken: "[redacted:audit-secret]",
          safeDigest: "payment-digest-1"
        },
        "[redacted:audit-secret]"
      ]
    });
    expect(event.hash).toBeDefined();
    expect(encoded).not.toContain("super-secret");
    expect(encoded).not.toContain("header-secret");
    expect(encoded).not.toContain("session-secret");
    expect(encoded).not.toContain("public-verification-token");
  });

  it("returns dashboard overview data", async () => {
    const app = createConsoleApp(baseConfig);
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/overview`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.kpis.verifiedPayments).toBeGreaterThan(0);
      expect(body.payments.length).toBeGreaterThan(0);
      expect(body.readiness.length).toBe(4);
      expect(body.merchants.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it("does not wildcard CORS token-bearing publisher headers in production", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_PROVIDER_BASE_URL: "https://console.example.com",
        SUI402_CONSOLE_CORS_ORIGINS: "https://dashboard.example.com"
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const disallowed = await fetch(`${base}/health/live`, {
        headers: { origin: "https://evil.example" }
      });
      const allowed = await fetch(`${base}/health/live`, {
        headers: { origin: "https://dashboard.example.com" }
      });

      expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://dashboard.example.com");
      expect(allowed.headers.get("access-control-allow-headers")).toContain("x-sui402-publisher-token");
    } finally {
      server.close();
    }
  });

  it("exposes public marketplace and scan summaries", async () => {
    const app = createConsoleApp(baseConfig);
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const marketplace = await fetch(`${base}/v1/marketplace/apis?q=atlas`);
      const marketplaceBody = await marketplace.json();
      const scan = await fetch(`${base}/v1/scan/stats`);
      const scanBody = await scan.json();
      const payment = await fetch(`${base}/v1/scan/payments/digest-atlas-1`);
      const paymentBody = await payment.json();
      const merchant = await fetch(`${base}/v1/scan/merchants/atlas-api`);
      const merchantBody = await merchant.json();
      const marketplaceDetail = await fetch(`${base}/v1/marketplace/apis/atlas-api`);
      const marketplaceDetailBody = await marketplaceDetail.json();
      const marketplacePage = await fetch(`${base}/marketplace/atlas-api`);
      const marketplacePageHtml = await marketplacePage.text();
      const paymentPage = await fetch(`${base}/scan/payment/digest-atlas-1`);
      const paymentPageHtml = await paymentPage.text();
      const merchantPage = await fetch(`${base}/scan/merchant/atlas-api`);
      const merchantPageHtml = await merchantPage.text();
      const missingMarketplaceDetail = await fetch(`${base}/v1/marketplace/apis/not-indexed`);
      const missingMarketplaceDetailBody = await missingMarketplaceDetail.json();
      const missingMarketplacePage = await fetch(`${base}/marketplace/not-indexed`);
      const missingMarketplacePageHtml = await missingMarketplacePage.text();
      const unknownPublicPages = await Promise.all(
        [
          {
            name: "marketplace",
            url: `${base}/marketplace/not-indexed`,
            jsonPath: "/v1/marketplace/apis/not-indexed",
            identifier: "not-indexed"
          },
          {
            name: "payment",
            url: `${base}/scan/payment/not-indexed-digest`,
            jsonPath: "/v1/scan/payments/not-indexed-digest",
            identifier: "not-indexed-digest"
          },
          {
            name: "merchant",
            url: `${base}/scan/merchant/not-indexed-merchant`,
            jsonPath: "/v1/scan/merchants/not-indexed-merchant",
            identifier: "not-indexed-merchant"
          },
          {
            name: "session",
            url: `${base}/scan/session/not-indexed-session`,
            jsonPath: "/v1/scan/sessions/not-indexed-session",
            identifier: "not-indexed-session"
          },
          {
            name: "settlement",
            url: `${base}/scan/settlement/not-indexed-settlement`,
            jsonPath: "/v1/scan/settlements/not-indexed-settlement",
            identifier: "not-indexed-settlement"
          }
        ].map(async (page) => {
          const response = await fetch(page.url);
          return { ...page, response, html: await response.text() };
        })
      );

      assertPublicSurfacePolicy("marketplace search", marketplaceBody);
      assertPublicSurfacePolicy("scan stats", scanBody);
      assertPublicSurfacePolicy("scan payment", paymentBody);
      assertPublicSurfacePolicy("scan merchant", merchantBody);
      assertPublicSurfacePolicy("marketplace detail", marketplaceDetailBody);

      expect(marketplace.status).toBe(200);
      expect(marketplace.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=60");
      expect(marketplace.headers.get("vary")).toContain("accept");
      expect(marketplaceBody).toMatchObject({
        schemaVersion: "sui402.marketplace.v1",
        dataSource: "console-api",
        limit: expect.any(Number),
        hasMore: expect.any(Boolean)
      });
      expect(marketplaceBody.count).toBeGreaterThan(0);
      expect(marketplaceBody.apis[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        network: expect.stringMatching(/^sui:/),
        price: expect.any(String),
        readiness: {
          ready: true,
          level: "ready",
          checks: expect.arrayContaining([
            expect.objectContaining({ name: "listing_active", ok: true }),
            expect.objectContaining({ name: "merchant_published", ok: true }),
            expect.objectContaining({ name: "protected_access", ok: true })
          ])
        },
        stats: {
          verifiedPayments: expect.any(Number)
        },
        links: {
          apiPath: "/v1/marketplace/apis/atlas-api",
          apiUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/marketplace/apis/atlas-api`,
          publicPagePath: "/marketplace/atlas-api",
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/marketplace/atlas-api`,
          scanMerchantPath: "/v1/scan/merchants/atlas-api",
          scanPagePath: "/scan/merchant/atlas-api"
        },
        commands: {
          curl: expect.stringContaining("--max-one-shot-amount 1000000"),
          sessionOnly: expect.stringContaining("--session-only"),
          sessionInspect: expect.stringContaining("--merchant")
        },
        paymentPlan: {
          custody: "user_owned",
          network: "sui:testnet",
          merchant: expect.any(String),
          coinType: "0x2::sui::SUI",
          amountAtomic: "1000000",
          maxOneShotAmount: "1000000",
          resourceScope: "api:market-feed",
          sessionSupported: true,
          sessionBehavior: "session_first_with_capped_one_shot_fallback"
        }
      });
      expect(scan.status).toBe(200);
      expect(scan.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=60");
      expect(scanBody).toMatchObject({
        schemaVersion: "sui402.scan.v1",
        dataSource: "console-api"
      });
      expect(scanBody.totals).toMatchObject({
        apis: expect.any(Number),
        activeApis: expect.any(Number),
        sellers: expect.any(Number),
        verifiedPayments: expect.any(Number)
      });
      expect(scanBody.recentPayments.length).toBeGreaterThan(0);
      expect(scanBody.recentPayments[0]).toMatchObject({
        digest: expect.any(String),
        displayDigest: expect.any(String),
        evidence: {
          class: "gateway_verified",
          classes: expect.arrayContaining(["gateway_verified"]),
          source: "console_gateway",
          publicIdentifier: expect.any(String),
          challengeId: expect.any(String),
          observedAt: expect.any(String)
        },
        links: {
          apiPath: expect.stringMatching(/^\/v1\/scan\/payments\//),
          publicPagePath: expect.stringMatching(/^\/scan\/payment\//),
          publicPageUrl: expect.stringMatching(/^http:\/\/localhost:4030\/scan\/payment\//)
        }
      });
      expect(payment.status).toBe(200);
      expect(paymentBody).toMatchObject({
        digest: "digest-atlas-1",
        merchantId: "atlas-api",
        resource: "api:market-feed",
        kind: "one-shot",
        evidence: {
          class: "gateway_verified",
          classes: ["gateway_verified"],
          source: "console_gateway",
          publicIdentifier: "digest-atlas-1",
          challengeId: expect.any(String),
          observedAt: "2026-05-19T00:00:00.000Z"
        },
        links: {
          apiPath: "/v1/scan/payments/digest-atlas-1",
          publicPagePath: "/scan/payment/digest-atlas-1",
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/payment/digest-atlas-1`,
          merchantApiPath: "/v1/scan/merchants/atlas-api",
          merchantPublicPagePath: "/scan/merchant/atlas-api",
          merchantMarketplacePath: "/marketplace/atlas-api"
        }
      });
      expect(merchant.status).toBe(200);
      expect(merchantBody).toMatchObject({
        merchant: {
          id: "atlas-api",
          sessionsEnabled: true
        },
        stats: {
          verifiedPayments: 1
        },
        links: {
          apiPath: "/v1/scan/merchants/atlas-api",
          publicPagePath: "/scan/merchant/atlas-api",
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/merchant/atlas-api`,
          marketplacePath: "/marketplace/atlas-api",
          marketplaceUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/marketplace/atlas-api`
        }
      });
      expect(marketplaceDetail.status).toBe(200);
      expect(marketplaceDetailBody).toMatchObject({
        schemaVersion: "sui402.marketplace.api.v1",
        dataSource: "console-api",
        api: {
          id: "atlas-api",
          status: "active",
          stats: {
            verifiedPayments: 1
          }
        },
        merchant: {
          id: "atlas-api",
          sessionsEnabled: true
        },
        trust: {
          listingPublished: true,
          merchantPublished: true,
          upstreamConfigured: true,
          sessionsEnabled: true
        },
        readiness: {
          ready: true,
          level: "ready",
          reasons: []
        },
        commands: {
          curl: expect.stringContaining("--max-one-shot-amount 1000000"),
          search: "sui402-pay search Atlas API",
          scan: "sui402-pay scan merchant atlas-api",
          sessionOnly: expect.stringContaining("--session-only"),
          sessionInspect: expect.stringContaining("sui402-pay session inspect")
        },
        paymentPlan: {
          custody: "user_owned",
          authorizationMode: "live_402_challenge_plus_local_policy",
          network: "sui:testnet",
          amountAtomic: "1000000",
          maxOneShotAmount: "1000000",
          resourceScope: "api:market-feed",
          sessionBehavior: "session_first_with_capped_one_shot_fallback"
        },
        stats: {
          verifiedPayments: 1
        },
        links: {
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/marketplace/atlas-api`,
          scanPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/merchant/atlas-api`
        }
      });
      expect(marketplaceDetailBody.recentPayments[0]).toMatchObject({
        digest: "digest-atlas-1",
        merchantId: "atlas-api",
        evidence: {
          class: "gateway_verified",
          source: "console_gateway",
          publicIdentifier: "digest-atlas-1"
        },
        links: {
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/payment/digest-atlas-1`
        }
      });
      expect(marketplaceDetailBody.merchant).not.toHaveProperty("upstreamUrl");
      expect(JSON.stringify(marketplaceDetailBody)).not.toContain("upstreamTimeoutMs");
      expect(JSON.stringify(marketplaceDetailBody)).not.toContain("sessionPackageId");
      expect(JSON.stringify(marketplaceDetailBody)).not.toContain("paymentPolicy");
      expect(marketplacePage.status).toBe(200);
      expect(marketplacePage.headers.get("content-type")).toContain("text/html");
      expect(marketplacePage.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=60");
      expect(marketplacePageHtml).toContain("<title>Atlas API | Sui402 Marketplace</title>");
      expect(marketplacePageHtml).toContain('meta property="og:title" content="Atlas API | Sui402 Marketplace"');
      expect(marketplacePageHtml).toContain('rel="alternate" type="application/json"');
      expect(marketplacePageHtml).toContain("Launch readiness");
      expect(marketplacePageHtml).toContain("Agent path");
      expect(marketplacePageHtml).toContain("Public safety");
      expect(marketplacePageHtml).toContain("paid_test_observed");
      expect(marketplacePageHtml).toContain("sui402-pay curl");
      expect(marketplacePageHtml).toContain("--max-one-shot-amount 1000000");
      expect(marketplacePageHtml).not.toContain("upstreamTimeoutMs");
      expect(marketplacePageHtml).not.toContain("sessionPackageId");
      expect(marketplacePageHtml).not.toContain("paymentPolicy");
      expect(paymentPage.status).toBe(200);
      expect(paymentPageHtml).toContain("<title>Payment diges...as-1 | Sui402 Scan</title>");
      expect(paymentPageHtml).toContain('meta property="og:description"');
      expect(paymentPageHtml).toContain('rel="alternate" type="application/json"');
      expect(paymentPageHtml).toContain("Evidence class");
      expect(paymentPageHtml).toContain("one-shot payment proof");
      expect(paymentPageHtml).toContain("Public safety");
      expect(paymentPageHtml).toContain("sui402-pay scan payment digest-atlas-1");
      expect(merchantPage.status).toBe(200);
      expect(merchantPageHtml).toContain("<title>Atlas API | Sui402 Scan</title>");
      expect(merchantPageHtml).toContain("Merchant evidence");
      expect(merchantPageHtml).toContain("marketplace listing found");
      expect(merchantPageHtml).toContain("/marketplace/atlas-api");
      expect(missingMarketplaceDetail.status).toBe(404);
      expect(missingMarketplaceDetailBody).toMatchObject({
        error: "marketplace_api_not_found",
        dataSource: "console-api",
        notIndexedYet: true
      });
      expect(missingMarketplacePage.status).toBe(404);
      expect(missingMarketplacePageHtml).toContain('meta name="robots" content="noindex,follow"');
      expect(missingMarketplacePageHtml).toContain("What happened");
      for (const page of unknownPublicPages) {
        expect(page.response.status, `${page.name} status`).toBe(404);
        expect(page.response.headers.get("content-type"), `${page.name} content-type`).toContain("text/html");
        expect(page.response.headers.get("cache-control"), `${page.name} cache`).toBe(
          "public, max-age=15, stale-while-revalidate=60"
        );
        expect(page.html, `${page.name} robots`).toContain('meta name="robots" content="noindex,follow"');
        expect(page.html, `${page.name} alternate json`).toContain(`rel="alternate" type="application/json"`);
        expect(page.html, `${page.name} json path`).toContain(page.jsonPath);
        expect(page.html, `${page.name} identifier`).toContain(page.identifier);
        expect(page.html, `${page.name} copy`).toContain("not indexed");
        expect(page.html, `${page.name} no raw json error`).not.toContain('{"error"');
        expect(page.html, `${page.name} no stack leak`).not.toContain("Error:");
        expect(page.html, `${page.name} no private config`).not.toContain("upstreamTimeoutMs");
        expect(page.html, `${page.name} no policy leak`).not.toContain("paymentPolicy");
      }
    } finally {
      server.close();
    }
  });

  it("keeps public marketplace/scan JSON, public pages, and sui402-pay CLI output in agreement", async () => {
    const app = createConsoleApp(baseConfig);
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const marketplaceDetail = await fetch(`${base}/v1/marketplace/apis/atlas-api`);
      const marketplaceDetailBody = await marketplaceDetail.json();
      const marketplacePage = await fetch(`${base}/marketplace/atlas-api`);
      const marketplacePageHtml = await marketplacePage.text();
      const scanStats = await fetch(`${base}/v1/scan/stats`);
      const scanStatsBody = await scanStats.json();
      const paymentDetail = await fetch(`${base}/v1/scan/payments/digest-atlas-1`);
      const paymentDetailBody = await paymentDetail.json();
      const paymentPage = await fetch(`${base}/scan/payment/digest-atlas-1`);
      const paymentPageHtml = await paymentPage.text();
      const merchantDetail = await fetch(`${base}/v1/scan/merchants/atlas-api`);
      const merchantDetailBody = await merchantDetail.json();

      const marketplaceCli = await runPayCli(["marketplace", "detail", "atlas-api"], base);
      const scanStatsCli = await runPayCli(["scan", "stats"], base);
      const paymentCli = await runPayCli(["scan", "payment", "digest-atlas-1"], base);
      const merchantCli = await runPayCli(["scan", "merchant", "atlas-api"], base);

      expect(marketplaceDetail.status).toBe(200);
      expect(marketplaceDetailBody.api.id).toBe("atlas-api");
      expect(marketplaceDetailBody.commands).toMatchObject({
        curl: expect.stringContaining("--max-one-shot-amount 1000000"),
        search: "sui402-pay search Atlas API",
        scan: "sui402-pay scan merchant atlas-api",
        sessionOnly: expect.stringContaining("--session-only"),
        sessionInspect: expect.stringContaining("sui402-pay session inspect")
      });
      expect(marketplaceDetailBody.paymentPlan).toMatchObject({
        network: marketplaceDetailBody.api.network,
        coinType: marketplaceDetailBody.api.coinType,
        amountAtomic: marketplaceDetailBody.api.price,
        maxOneShotAmount: marketplaceDetailBody.api.price,
        resourceScope: marketplaceDetailBody.api.resourceScope,
        sessionBehavior: "session_first_with_capped_one_shot_fallback"
      });
      expect(marketplacePageHtml).toContain(marketplaceDetailBody.commands.curl);
      expect(marketplacePageHtml).toContain("Launch readiness");
      expect(marketplacePageHtml).toContain("Agent path");
      expect(marketplaceCli.stdout).toContain("atlas-api  Atlas API");
      expect(marketplaceCli.stdout).toContain(`call: ${marketplaceDetailBody.commands.curl}`);
      expect(marketplaceCli.stdout).toContain(`search: ${marketplaceDetailBody.commands.search}`);
      expect(marketplaceCli.stdout).toContain(`scan: ${marketplaceDetailBody.commands.scan}`);
      expect(marketplaceCli.stdout).toContain(`session-only: ${marketplaceDetailBody.commands.sessionOnly}`);
      expect(marketplaceCli.stdout).toContain(`session inspect: ${marketplaceDetailBody.commands.sessionInspect}`);
      expect(marketplaceCli.stdout).toContain(`max one-shot: ${marketplaceDetailBody.api.price}`);
      expect(marketplaceCli.stdout).toContain("session behavior: session_first_with_capped_one_shot_fallback");
      expect(marketplaceCli.stdout).toContain("readiness: ready");
      expect(marketplaceCli.stdout).toContain(`stats: ${marketplaceDetailBody.stats.verifiedPayments} verified`);

      expect(scanStats.status).toBe(200);
      expect(scanStatsBody.totals).toMatchObject({
        apis: expect.any(Number),
        verifiedPayments: expect.any(Number),
        sessionPayments: expect.any(Number)
      });
      expect(scanStatsCli.stdout).toContain("Sui402 scan:");
      expect(scanStatsCli.stdout).toContain(`apis: ${scanStatsBody.totals.apis}`);
      expect(scanStatsCli.stdout).toContain(`verifiedPayments: ${scanStatsBody.totals.verifiedPayments}`);
      expect(scanStatsCli.stdout).toContain(`sessionPayments: ${scanStatsBody.totals.sessionPayments}`);

      expect(paymentDetail.status).toBe(200);
      expect(paymentDetailBody).toMatchObject({
        digest: "digest-atlas-1",
        merchantId: "atlas-api",
        resource: "api:market-feed"
      });
      expect(paymentPageHtml).toContain("Evidence class");
      expect(paymentPageHtml).toContain("one-shot payment proof");
      expect(paymentCli.stdout).toContain(`digest: ${paymentDetailBody.digest}`);
      expect(paymentCli.stdout).toContain(`merchant id: ${paymentDetailBody.merchantId}`);
      expect(paymentCli.stdout).toContain(`resource: ${paymentDetailBody.resource}`);

      expect(merchantDetail.status).toBe(200);
      expect(merchantDetailBody).toMatchObject({
        merchant: {
          id: "atlas-api",
          service: "Atlas API"
        },
        stats: {
          verifiedPayments: 1
        }
      });
      expect(merchantCli.stdout).toContain("atlas-api  Atlas API");
      expect(merchantCli.stdout).toContain(`stats: ${merchantDetailBody.stats.verifiedPayments} verified`);
      expect(merchantCli.stdout).toContain("digest-atlas-1");
    } finally {
      server.close();
    }
  }, 20_000);

  it("attributes marketplace stats to the recorded listing id before using recipient fallback", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const stores = createConsoleStores(baseConfig, false);
    await stores.listings.upsert(
      createServiceListing({
        id: "alpha-api",
        name: "Alpha API",
        providerBaseUrl: "http://localhost:4030",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:*",
        resourceScopeHash: resourceScopeHash("api:*"),
        sessionSupported: false,
        protectedResourceUrl: "http://localhost:4030/gateway/merchants/alpha-api/pay",
        tags: ["api"],
        status: "active"
      })
    );
    await stores.listings.upsert(
      createServiceListing({
        id: "gamma-api",
        name: "Gamma API",
        providerBaseUrl: "http://localhost:4030",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:gamma",
        resourceScopeHash: resourceScopeHash("api:gamma"),
        sessionSupported: false,
        protectedResourceUrl: "http://localhost:4030/gateway/merchants/gamma-api/pay",
        tags: ["api"],
        status: "active"
      })
    );
    await stores.listings.upsert(
      createServiceListing({
        id: "beta-api",
        name: "Beta API",
        providerBaseUrl: "http://localhost:4030",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:beta",
        resourceScopeHash: resourceScopeHash("api:beta"),
        sessionSupported: false,
        protectedResourceUrl: "http://localhost:4030/gateway/merchants/beta-api/pay",
        tags: ["api"],
        status: "active"
      })
    );
    await stores.listings.upsert(
      createServiceListing({
        id: "delta-api",
        name: "Delta API",
        providerBaseUrl: "http://localhost:4030",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "2000",
        resourceScope: "api:delta",
        resourceScopeHash: resourceScopeHash("api:delta"),
        sessionSupported: false,
        protectedResourceUrl: "http://localhost:4030/gateway/merchants/delta-api/pay",
        tags: ["api"],
        status: "active"
      })
    );
    await stores.listings.upsert(
      createServiceListing({
        id: "epsilon-api",
        name: "Epsilon API",
        providerBaseUrl: "http://localhost:4030",
        transport: "http",
        network: "sui:testnet",
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:epsilon",
        resourceScopeHash: resourceScopeHash("api:epsilon"),
        sessionSupported: false,
        protectedResourceUrl: "http://localhost:4030/gateway/merchants/epsilon-api/pay",
        tags: ["api"],
        status: "active"
      })
    );
    await stores.payments.record(
      paymentRecordWithReceipt({
        privateKey,
        id: "alpha-payment",
        amount: "1000",
        sequence: "1",
        merchantId: "alpha-api"
      })
    );
    await stores.payments.record(
      paymentRecordWithReceipt({
        privateKey,
        id: "delta-wrong-price-payment",
        amount: "1000",
        resource: "api:delta",
        sequence: "2",
        merchantId: "delta-api"
      })
    );
    await stores.payments.record(
      paymentRecordWithReceipt({
        privateKey,
        id: "epsilon-wrong-resource-payment",
        amount: "1000",
        resource: "api:old-epsilon",
        sequence: "3",
        merchantId: "epsilon-api"
      })
    );
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/marketplace/apis`);
      const body = await response.json();
      const stats = new Map(body.apis.map((api: { id: string; stats: { verifiedPayments: number } }) => [api.id, api.stats]));
      const limitedSearch = await fetch(`${serverBaseUrl(server)}/v1/marketplace/apis?q=beta&limit=1`);
      const limitedSearchBody = await limitedSearch.json();

      expect(response.status).toBe(200);
      expect(stats.get("alpha-api")).toMatchObject({ verifiedPayments: 1 });
      expect(stats.get("beta-api")).toMatchObject({ verifiedPayments: 0 });
      expect(stats.get("delta-api")).toMatchObject({ verifiedPayments: 0 });
      expect(stats.get("epsilon-api")).toMatchObject({ verifiedPayments: 0 });
      expect(limitedSearch.status).toBe(200);
      expect(limitedSearchBody).toMatchObject({
        count: 1,
        limit: 1,
        hasMore: false
      });
      expect(limitedSearchBody.apis.map((api: { id: string }) => api.id)).toEqual(["beta-api"]);
      expect(limitedSearchBody.apis[0]).toMatchObject({
        readiness: {
          ready: false,
          level: "needs_review",
          reasons: expect.arrayContaining(["Gateway merchant is missing"])
        }
      });
    } finally {
      server.close();
    }
  });

  it("exposes public scan session and settlement details", async () => {
    const stores = createConsoleStores(baseConfig, false);
    const sessionId = `0x${"e".repeat(64)}`;
    const rawPayer = `0x${"b".repeat(64)}`;
    const rawSigner = `0x${"c".repeat(64)}`;
    const packageId = `0x${"1".repeat(64)}`;
    const payerHash = `sha256:${createHash("sha256").update(rawPayer.toLowerCase()).digest("hex")}`;
    const signerHash = `sha256:${createHash("sha256").update(rawSigner.toLowerCase()).digest("hex")}`;
    await stores.sessionSpends.upsert({
      id: "session-spend-1",
      network: "sui:testnet",
      packageId,
      coinType: "0x2::sui::SUI",
      txDigest: "session-spend-digest-1",
      eventSeq: "0",
      sessionId,
      payer: rawPayer,
      merchant: MERCHANT,
      amount: "1000",
      spentTotal: "1000",
      challengeId: "challenge-1",
      resourceScopeHash: resourceScopeHash("api:*"),
      sender: rawPayer,
      timestampMs: "1780000000000",
      indexedAt: "2026-05-19T00:00:00.000Z"
    });
    await stores.indexerCursors.setCursor(`${packageId}:0x2::sui::SUI`, "345425755:0");
    await stores.settlementEvents.upsert(
      settlementRecord({
        id: "settlement-detail-id",
        packageId,
        txDigest: "settlement-detail-digest",
        receiptId: "44".repeat(32),
        amount: "1000"
      })
    );
    await stores.indexerCursors.setCursor(`settlement:${packageId}:0x2::sui::SUI`, "345425756:1");
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const session = await fetch(`${base}/v1/scan/sessions/${sessionId}`);
      const sessionBody = await session.json();
      const settlement = await fetch(`${base}/v1/scan/settlements/settlement-detail-digest`);
      const settlementBody = await settlement.json();
      const sessionPage = await fetch(`${base}/scan/session/${sessionId}`);
      const sessionPageHtml = await sessionPage.text();
      const settlementPage = await fetch(`${base}/scan/settlement/settlement-detail-digest`);
      const settlementPageHtml = await settlementPage.text();
      const sessionCli = await runPayCli(["scan", "session", sessionId], base);
      const settlementCli = await runPayCli(["scan", "settlement", "settlement-detail-digest"], base);

      assertPublicSurfacePolicy("scan session", sessionBody);
      assertPublicSurfacePolicy("scan settlement", settlementBody);

      expect(session.status).toBe(200);
      expect(sessionBody).toMatchObject({
        sessionId,
        spendCount: 1,
        spentAmount: "1000",
        payerHash,
        identityRedaction: {
          payer: "redacted_with_stable_hash"
        },
        lastTxDigest: "session-spend-digest-1",
        evidence: {
          class: "onchain_indexed",
          source: "sui402_indexer",
          publicIdentifier: "session-spend-digest-1",
          eventSeq: "0",
          indexedAt: "2026-05-19T00:00:00.000Z"
        },
        indexerProgress: {
          eventKind: "session-spend",
          cursorKey: `${packageId}:0x2::sui::SUI`,
          cursor: "345425755:0",
          checkpoint: "345425755",
          eventOffset: 0,
          label: "checkpoint_cursor",
          updatedAt: expect.any(String)
        },
        links: {
          apiPath: `/v1/scan/sessions/${sessionId}`,
          publicPagePath: `/scan/session/${sessionId}`,
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/session/${sessionId}`
        }
      });
      expect(sessionBody.spends[0]).toMatchObject({
        id: "session-spend-1",
        challengeId: "challenge-1",
        payerHash,
        senderHash: payerHash,
        identityRedaction: {
          payer: "redacted_with_stable_hash",
          sender: "redacted_with_stable_hash"
        },
        evidence: {
          class: "onchain_indexed",
          source: "sui402_indexer",
          publicIdentifier: "session-spend-digest-1",
          eventSeq: "0",
          indexedAt: "2026-05-19T00:00:00.000Z"
        }
      });
      expect(sessionBody).not.toHaveProperty("payer");
      expect(sessionBody.spends[0]).not.toHaveProperty("payer");
      expect(sessionBody.spends[0]).not.toHaveProperty("sender");
      expect(JSON.stringify(sessionBody)).not.toContain(rawPayer);
      expect(settlement.status).toBe(200);
      expect(settlementBody).toMatchObject({
        id: "settlement-detail-id",
        txDigest: "settlement-detail-digest",
        receiptId: "44".repeat(32),
        amount: "1000",
        payerHash,
        signerHash,
        submitterHash: payerHash,
        senderHash: payerHash,
        identityRedaction: {
          payer: "redacted_with_stable_hash",
          signer: "redacted_with_stable_hash",
          submitter: "redacted_with_stable_hash",
          sender: "redacted_with_stable_hash"
        },
        evidence: {
          class: "settlement_record",
          source: "sui402_indexer",
          publicIdentifier: "settlement-detail-digest",
          eventSeq: "0",
          indexedAt: "2026-05-19T00:00:00.000Z"
        },
        indexerProgress: {
          eventKind: "settlement",
          cursorKey: `settlement:${packageId}:0x2::sui::SUI`,
          cursor: "345425756:1",
          checkpoint: "345425756",
          eventOffset: 1,
          label: "checkpoint_cursor",
          updatedAt: expect.any(String)
        },
        caveats: expect.arrayContaining([expect.stringContaining("does not prove escrowed fund movement")]),
        links: {
          apiPath: "/v1/scan/settlements/settlement-detail-digest",
          publicPagePath: "/scan/settlement/settlement-detail-digest",
          publicPageUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/scan/settlement/settlement-detail-digest`
        }
      });
      expect(settlementBody).not.toHaveProperty("payer");
      expect(settlementBody).not.toHaveProperty("signer");
      expect(settlementBody).not.toHaveProperty("submitter");
      expect(settlementBody).not.toHaveProperty("sender");
      expect(JSON.stringify(settlementBody)).not.toContain(rawPayer);
      expect(JSON.stringify(settlementBody)).not.toContain(rawSigner);
      expect(sessionPage.status).toBe(200);
      expect(sessionPage.headers.get("content-type")).toContain("text/html");
      expect(sessionPageHtml).toContain("<title>Session 0xeee...eeee | Sui402 Scan</title>");
      expect(sessionPageHtml).toContain("sui402-pay scan session");
      expect(sessionPageHtml).toContain("Session evidence");
      expect(sessionPageHtml).toContain("Indexer progress");
      expect(sessionPageHtml).toContain("345425755:0");
      expect(sessionPageHtml).toContain("redacted");
      expect(sessionPageHtml).not.toContain(rawPayer);
      expect(sessionCli.stdout).toContain("Sui402 scan session:");
      expect(sessionCli.stdout).toContain(`session: ${sessionBody.sessionId}`);
      expect(sessionCli.stdout).toContain(`spent: ${sessionBody.spentAmount} SUI`);
      expect(sessionCli.stdout).toContain(`spends: ${sessionBody.spendCount}`);
      expect(sessionCli.stdout).toContain(`last tx: ${sessionBody.lastTxDigest}`);
      expect(sessionCli.stdout).toContain("indexer cursor: 345425755:0");
      expect(sessionCli.stdout).toContain("checkpoint: 345425755");
      expect(sessionCli.stdout).toContain(`payer hash: ${payerHash}`);
      expect(sessionCli.stdout).not.toContain(rawPayer);
      expect(settlementPage.status).toBe(200);
      expect(settlementPage.headers.get("content-type")).toContain("text/html");
      expect(settlementPageHtml).toContain("<title>Settlement settl...gest | Sui402 Scan</title>");
      expect(settlementPageHtml).toContain("sui402-pay scan settlement settlement-detail-digest");
      expect(settlementPageHtml).toContain("Settlement evidence");
      expect(settlementPageHtml).toContain("Indexer progress");
      expect(settlementPageHtml).toContain("345425756:1");
      expect(settlementPageHtml).toContain("Evidence limits");
      expect(settlementPageHtml).toContain("does not prove escrowed fund movement");
      expect(settlementPageHtml).toContain("legal settlement finality");
      expect(settlementPageHtml).not.toContain(rawPayer);
      expect(settlementPageHtml).not.toContain(rawSigner);
      expect(settlementCli.stdout).toContain("Sui402 scan settlement:");
      expect(settlementCli.stdout).toContain(`id: ${settlementBody.id}`);
      expect(settlementCli.stdout).toContain(`tx: ${settlementBody.txDigest}`);
      expect(settlementCli.stdout).toContain(`receipt: ${settlementBody.receiptId}`);
      expect(settlementCli.stdout).toContain(`amount: ${settlementBody.amount}`);
      expect(settlementCli.stdout).toContain("indexer cursor: 345425756:1");
      expect(settlementCli.stdout).toContain("checkpoint: 345425756");
    } finally {
      server.close();
    }
  });

  it("looks up scan payment and settlement records outside the recent window", async () => {
    const stores = createConsoleStores(baseConfig, false);
    await stores.payments.record(
      scanPaymentRecord({
        id: "old-payment",
        txDigest: "old-payment-digest",
        createdAt: "2026-01-01T00:00:00.000Z"
      })
    );
    await stores.settlementEvents.upsert(
      settlementRecord({
        id: "old-settlement-id",
        txDigest: "old-settlement-digest",
        receiptId: "old-receipt-id",
        timestampMs: "1",
        indexedAt: "2026-01-01T00:00:00.000Z"
      })
    );
    for (let index = 0; index < 1005; index += 1) {
      await stores.payments.record(
        scanPaymentRecord({
          id: `new-payment-${index}`,
          txDigest: `new-payment-${index}-digest`,
          createdAt: new Date(Date.UTC(2026, 4, 20, 0, 0, index)).toISOString()
        })
      );
      await stores.settlementEvents.upsert(
        settlementRecord({
          id: `new-settlement-${index}`,
          txDigest: `new-settlement-${index}-digest`,
          receiptId: `new-receipt-${index}`,
          timestampMs: String(1000 + index),
          indexedAt: new Date(Date.UTC(2026, 4, 20, 0, 0, index)).toISOString()
        })
      );
    }
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const payment = await fetch(`${base}/v1/scan/payments/old-payment-digest?network=sui:testnet`);
      const paymentBody = await payment.json();
      const wrongNetworkPayment = await fetch(`${base}/v1/scan/payments/old-payment-digest?network=sui:mainnet`);
      const settlement = await fetch(`${base}/v1/scan/settlements/old-receipt-id`);
      const settlementBody = await settlement.json();

      expect(payment.status).toBe(200);
      expect(paymentBody).toMatchObject({
        id: "old-payment",
        digest: "old-payment-digest",
        network: "sui:testnet"
      });
      expect(wrongNetworkPayment.status).toBe(404);
      expect(settlement.status).toBe(200);
      expect(settlementBody).toMatchObject({
        id: "old-settlement-id",
        txDigest: "old-settlement-digest",
        receiptId: "old-receipt-id"
      });
    } finally {
      server.close();
    }
  });

  it("reports storage readiness failures and exposes Prometheus metrics", async () => {
    const stores = createConsoleStores(baseConfig, false);
    stores.checkReady = async () => {
      throw new Error("postgres unavailable");
    };
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const ready = await fetch(`${base}/health/ready`);
      const readyBody = await ready.json();
      const metrics = await fetch(`${base}/metrics`);
      const metricsBody = await metrics.text();

      expect(ready.status).toBe(503);
      expect(readyBody).toMatchObject({
        ok: false,
        dependencies: {
          storage: { ok: false, error: "postgres unavailable" }
        }
      });
      expect(metrics.status).toBe(200);
      expect(metricsBody).toContain("sui402_http_requests_total");
      expect(metricsBody).toContain('path="/health/ready",status="503"');
    } finally {
      server.close();
    }
  });

  it("creates gateway merchants and registry listings through console action route", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/merchants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "merchant-api",
          service: "Merchant API",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:*",
          transport: "http"
        })
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.merchant.id).toBe("merchant-api");
      expect(body.listing.id).toBe("merchant-api");
      expect(body.manifest.endpoints.protectedResource).toBe("/gateway/merchants/merchant-api/pay");
    } finally {
      server.close();
    }
  });

  it("creates signed session receipts for console gateway merchants when configured", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const merchant = createGatewayMerchantConfig({
      id: "merchant-api",
      service: "Merchant API",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*",
      sessionPackageId: `0x${"1".repeat(64)}`
    });
    const factory = createConsoleReceiptIssuerFactory({
      ...baseConfig,
      SUI402_RECEIPT_SIGNER_ID: MERCHANT,
      SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        "utf8"
      ).toString("base64")
    });
    const issuer = factory?.(merchant);
    const challenge = createChallenge({
      network: merchant.network,
      recipient: merchant.merchant,
      coinType: merchant.coinType,
      amount: merchant.price,
      resource: merchant.resourceScope,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    const first = await issuer?.({
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: "0xsession",
        network: merchant.network,
        txDigest: "digest-1",
        payer: MERCHANT,
        spentAt: "2026-05-19T00:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest-1",
        sessionId: "0xsession",
        payer: MERCHANT,
        recipient: merchant.merchant,
        amount: merchant.price,
        coinType: merchant.coinType
      },
      request: {} as never
    });
    const second = await issuer?.({
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: "0xsession",
        network: merchant.network,
        txDigest: "digest-2",
        payer: MERCHANT,
        spentAt: "2026-05-19T00:00:01.000Z"
      },
      verification: {
        ok: true,
        digest: "digest-2",
        sessionId: "0xsession",
        payer: MERCHANT,
        recipient: merchant.merchant,
        amount: merchant.price,
        coinType: merchant.coinType
      },
      request: {} as never
    });

    expect(first?.signer).toBe(MERCHANT);
    expect(first?.receipt.sequence).toBe("1");
    expect(second?.receipt.sequence).toBe("2");
    expect(first?.receipt.metadata).toMatchObject({
      challengeId: challenge.id,
      txDigest: "digest-1",
      service: "Merchant API",
      merchantId: "merchant-api"
    });
    expect(verifySignedSpendReceipt(first!, publicKey).ok).toBe(true);
  });

  it("rejects local receipt signing config without a private key", () => {
    expect(() =>
      loadConsoleConfig({
        NODE_ENV: "test",
        SUI402_RECEIPT_SIGNER_ID: "receipt-key-1"
      })
    ).toThrow("Local receipt signing requires SUI402_RECEIPT_PRIVATE_KEY_PEM or SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64");
  });

  it("requires admin auth for merchant creation in production", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_ADMIN_API_KEY: "console-admin-secret"
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const unauthenticated = await fetch(`${serverBaseUrl(server)}/v1/merchants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const authenticated = await fetch(`${serverBaseUrl(server)}/v1/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer console-admin-secret"
        },
        body: JSON.stringify({
          id: "merchant-api",
          service: "Merchant API",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:*"
        })
      });

      expect(unauthenticated.status).toBe(401);
      expect(authenticated.status).toBe(201);
    } finally {
      server.close();
    }
  });

  it("submits merchant applications without publishing live merchants", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS: 24
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const submit = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-1",
          request: {
            id: "applicant-api",
            service: "Applicant API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:applicant",
            transport: "http"
          },
          applicant: {
            email: "seller@example.com",
            organization: "Seller Co"
          }
        })
      });
      const gatewayMerchants = await fetch(`${base}/gateway/merchants`);
      const overview = await fetch(`${base}/v1/overview`);
      const overviewBody = await overview.json();

      expect(submit.status).toBe(202);
      const submitBody = await submit.json();
      const submittedApplication = submitBody.application;
      expect(submittedApplication).toMatchObject({
        id: "application-1",
        status: "pending",
        request: { id: "applicant-api" }
      });
      expect(submitBody.abuseControls).toMatchObject({
        schemaVersion: "sui402.publisher-intake-abuse-controls.v1",
        reviewSlaHours: 24,
        reviewDueAt: submittedApplication.reviewDueAt,
        intakeRateLimit: {
          max: baseConfig.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
          windowMs: baseConfig.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
        },
        takedown: {
          pendingApplication: {
            method: "POST",
            path: "/v1/merchant-applications/application-1/review",
            body: {
              action: "reject"
            }
          },
          publishedMerchant: {
            method: "PATCH",
            path: "/v1/seller/merchants/applicant-api",
            body: {
              status: "paused"
            }
          }
        },
        escalation: {
          operatorQueuePath: "/v1/merchant-applications?status=pending",
          auditTrailPath: "/v1/audit-events?targetId=application-1",
          applicantContact: "seller@example.com"
        }
      });
      expect(submitBody.abuseControls.requiredReviewChecks).toEqual(
        expect.arrayContaining([expect.stringContaining("abuse risk"), expect.stringContaining("paid-test evidence")])
      );
      expect(Date.parse(submittedApplication.reviewDueAt) - Date.parse(submittedApplication.submittedAt)).toBe(
        24 * 60 * 60 * 1000
      );
      expect((await gatewayMerchants.json()).count).toBe(0);
      expect(overviewBody.merchantApplications).toHaveLength(1);
      expect(overviewBody.merchantApplications[0].status).toBe("pending");
      expect(overviewBody.merchantApplications[0].abuseControls).toMatchObject({
        reviewSlaHours: 24,
        takedown: {
          pendingApplication: {
            path: "/v1/merchant-applications/application-1/review"
          }
        }
      });
      expect(overviewBody.merchantApplications[0].reviewDraft).toMatchObject({
        publishMode: "review_only",
        gatewayMerchant: {
          id: "applicant-api",
          resourceScope: "api:applicant"
        },
        registryListing: {
          id: "applicant-api",
          protectedResourceUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/applicant-api/pay`
        },
        gates: expect.arrayContaining([expect.objectContaining({ id: "operator_review", passed: false })])
      });
    } finally {
      server.close();
    }
  });

  it("creates a URL-first publisher API draft with exact verification next steps and token-gated status", async () => {
    const app = createConsoleApp(baseConfig, {
      seed: false,
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://publisher.example/openapi.json");
        expect(init?.redirect).toBe("error");
        return Response.json({
          openapi: "3.1.0",
          info: { title: "Publisher Search", version: "1.2.3" },
          paths: {
            "/v1/search": {
              get: {
                operationId: "search",
                summary: "Search records",
                tags: ["search"]
              }
            },
            "/v1/items/{id}": {
              post: {
                operationId: "createItem"
              }
            }
          }
        });
      }
    });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const draft = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiUrl: "https://publisher.example/openapi.json",
          openApiOperationId: "search",
          merchant: MERCHANT,
          applicantEmail: "publisher@example.com"
        })
      });
      const draftBody = await draft.json();
      const application = draftBody.application;
      const unauthenticatedStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`);
      const queryTokenStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status?token=${application.verification.accessToken}`);
      const publicNonceSession = await fetch(`${base}/v1/publisher/apis/${application.id}/session`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.token }
      });
      const sessionExchange = await fetch(`${base}/v1/publisher/apis/${application.id}/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sui402-publisher-token": application.verification.accessToken
        },
        body: JSON.stringify({ ttlSeconds: 60 })
      });
      const sessionBody = await sessionExchange.json();
      const status = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const statusBody = await status.json();
      const sessionStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { authorization: `Bearer ${sessionBody.publisherSessionToken}` }
      });
      const sessionStatusBody = await sessionStatus.json();
      const overview = await fetch(`${base}/v1/overview`);
      const overviewBody = await overview.json();
      const applicationList = await fetch(`${base}/v1/merchant-applications`);
      const applicationListBody = await applicationList.json();
      const gatewayMerchants = await fetch(`${base}/gateway/merchants`);

      expect(draft.status).toBe(202);
      expect(draft.headers.get("cache-control")).toBe("no-store");
      expect(draft.headers.get("pragma")).toBe("no-cache");
      expect(draft.headers.get("x-content-type-options")).toBe("nosniff");
      expect(draft.headers.get("referrer-policy")).toBe("no-referrer");
      expect(application).toMatchObject({
        status: "pending",
        request: {
          id: "publisher-example-v1",
          service: "Publisher API",
          upstreamUrl: "https://publisher.example/v1/search",
          resourceScope: "api:publisher-example-v1:get:v1-search",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000000",
          transport: "http"
        }
      });
      expect(application.verification.accessToken).toMatch(/^sui402p_/);
      expect(application.verification.accessToken).not.toBe(application.verification.token);
      expect(draftBody.abuseControls).toMatchObject({
        schemaVersion: "sui402.publisher-intake-abuse-controls.v1",
        reviewSlaHours: baseConfig.SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS,
        hostPolicy: {
          allowlistConfigured: false,
          blocklistConfigured: false
        },
        takedown: {
          pendingApplication: {
            path: `/v1/merchant-applications/${application.id}/review`
          },
          publishedMerchant: {
            path: "/v1/seller/merchants/publisher-example-v1"
          }
        },
        escalation: {
          auditTrailPath: `/v1/audit-events?targetId=${application.id}`,
          applicantContact: "publisher@example.com"
        }
      });
      expect(draftBody.preview).toMatchObject({
        merchantId: "publisher-example-v1",
        protectedResourcePath: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/publisher-example-v1/pay`,
        verificationUrl: "https://publisher.example/.well-known/sui402-publisher.json",
        openApi: {
          sourceUrl: "https://publisher.example/openapi.json",
          title: "Publisher Search",
          version: "1.2.3",
          endpointCount: 2,
          suggestedEndpoints: expect.arrayContaining([
            expect.objectContaining({
              method: "GET",
              path: "/v1/search",
              suggestedResourceScope: "api:publisher-example-v1:get:v1-search"
            })
          ])
        },
        selectedOpenApiEndpoint: {
          method: "GET",
          path: "/v1/search",
          operationId: "search",
          suggestedResourceScope: "api:publisher-example-v1:get:v1-search"
        },
        reviewDraft: {
          publishMode: "review_only",
          gatewayMerchant: {
            id: "publisher-example-v1",
            service: "Publisher API",
            upstreamUrl: "https://publisher.example/v1/search",
            resourceScope: "api:publisher-example-v1:get:v1-search",
            merchant: MERCHANT,
            price: "1000000"
          },
          registryListing: {
            id: "publisher-example-v1",
            providerBaseUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/`,
            protectedResourceUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/publisher-example-v1/pay`,
            resourceScope: "api:publisher-example-v1:get:v1-search",
            status: "active"
          },
          gates: expect.arrayContaining([
            expect.objectContaining({ id: "ownership_verification", passed: false }),
            expect.objectContaining({ id: "operator_review", passed: false }),
            expect.objectContaining({ id: "paid_test_evidence", passed: false })
          ])
        }
      });
      expect(draftBody.nextSteps).toMatchObject({
        verificationRequired: true,
        readyForReview: false,
        phase: "verify_ownership",
        verificationDocument: {
          sui402: "publisher-verification-v1",
          applicationId: application.id,
          merchantId: "publisher-example-v1",
          upstreamUrl: "https://publisher.example/v1/search",
          verificationToken: application.verification.token
        },
        selfServeActions: expect.arrayContaining([
          expect.objectContaining({ id: "publish_verification" }),
          expect.objectContaining({ id: "run_verification" }),
          expect.objectContaining({
            id: "check_status",
            command: `curl -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/status"`
          })
        ]),
        operatorActions: []
      });
      expect(unauthenticatedStatus.status).toBe(403);
      expect(queryTokenStatus.status).toBe(403);
      expect(publicNonceSession.status).toBe(403);
      expect(sessionExchange.status).toBe(201);
      expect(sessionExchange.headers.get("cache-control")).toBe("no-store");
      expect(sessionBody).toMatchObject({
        schemaVersion: "sui402.publisher-session.v1",
        applicationId: application.id,
        merchantId: "publisher-example-v1",
        tokenType: "Bearer",
        ttlSeconds: 60,
        commands: {
          status: `curl -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/status"`,
          probe: `curl -X POST -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/probe"`
        }
      });
      expect(sessionBody.publisherSessionToken).toMatch(/^sui402ps_/);
      expect(sessionBody.expiresAt).toEqual(expect.any(String));
      expect(JSON.stringify(sessionBody)).not.toContain(application.verification.accessToken);
      expect(status.status).toBe(200);
      expect(status.headers.get("cache-control")).toBe("no-store");
      expect(statusBody.publisherAuth).toMatchObject({
        kind: "publisher_access_token"
      });
      expect(statusBody.application.verification).toMatchObject({
        accessTokenPresent: true,
        accessTokenHash: expect.stringMatching(/^sha256:/)
      });
      expect(statusBody.application.verification).not.toHaveProperty("accessToken");
      expect(statusBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(statusBody)).not.toContain(application.verification.accessToken);
      expect(sessionStatus.status).toBe(200);
      expect(sessionStatus.headers.get("cache-control")).toBe("no-store");
      expect(sessionStatusBody.publisherAuth).toMatchObject({
        kind: "publisher_session",
        sessionId: expect.stringMatching(/^psess_/),
        expiresAt: sessionBody.expiresAt
      });
      expect(sessionStatusBody.application.verification).toMatchObject({
        accessTokenPresent: true,
        accessTokenHash: statusBody.application.verification.accessTokenHash
      });
      expect(sessionStatusBody.application.verification).not.toHaveProperty("accessToken");
      expect(sessionStatusBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(sessionStatusBody)).not.toContain(application.verification.accessToken);
      expect(overview.status).toBe(200);
      expect(overview.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(overviewBody)).not.toContain(application.verification.accessToken);
      expect(overviewBody.merchantApplications[0].verification).toMatchObject({
        accessTokenPresent: true,
        accessTokenHash: statusBody.application.verification.accessTokenHash
      });
      expect(overviewBody.merchantApplications[0].verification).not.toHaveProperty("accessToken");
      expect(overviewBody.merchantApplications[0].verification).not.toHaveProperty("token");
      expect(applicationList.status).toBe(200);
      expect(applicationList.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(applicationListBody)).not.toContain(application.verification.accessToken);
      expect(applicationListBody.applications[0].verification).not.toHaveProperty("accessToken");
      expect(applicationListBody.applications[0].verification).not.toHaveProperty("token");
      expect(statusBody.nextSteps.verificationDocument.verificationToken).toBe(application.verification.token);
      expect(statusBody.nextSteps.phase).toBe("verify_ownership");
      expect(statusBody.nextSteps.selfServeActions).toContainEqual(
        expect.objectContaining({
          id: "check_status",
          command: `curl -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/status"`
        })
      );
      expect(statusBody.preview.openApi).toMatchObject({
        endpointCount: 2,
        suggestedResourceScopes: expect.arrayContaining(["api:publisher-example-v1:get:v1-search"])
      });
      expect(statusBody.preview.selectedOpenApiEndpoint).toMatchObject({
        operationId: "search",
        suggestedResourceScope: "api:publisher-example-v1:get:v1-search"
      });
      expect(statusBody.preview.reviewDraft).toMatchObject({
        publishMode: "review_only",
        gatewayMerchant: {
          id: "publisher-example-v1",
          resourceScope: "api:publisher-example-v1:get:v1-search"
        },
        registryListing: {
          id: "publisher-example-v1",
          protectedResourceUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/publisher-example-v1/pay`
        }
      });
      expect((await gatewayMerchants.json()).count).toBe(0);
    } finally {
      server.close();
    }
  });

  it("previews publisher OpenAPI endpoint selection without creating applications or tokens", async () => {
    const stores = createConsoleStores(baseConfig, false);
    const app = createConsoleApp(baseConfig, {
      stores,
      seed: false,
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://publisher.example/openapi.json");
        expect(init?.redirect).toBe("error");
        return Response.json({
          openapi: "3.1.0",
          info: { title: "Publisher Search", version: "1.2.3" },
          paths: {
            "/v1/search": {
              get: {
                operationId: "search",
                summary: "Search records",
                tags: ["search"]
              }
            },
            "/v1/items/{id}": {
              post: {
                operationId: "createItem"
              }
            }
          }
        });
      }
    });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const response = await fetch(`${base}/v1/publisher/apis/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiUrl: "https://publisher.example/openapi.json",
          openApiMethod: "GET",
          openApiPath: "/v1/search",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).toMatchObject({
        schemaVersion: "sui402.publisher-api-preview.v1",
        preview: {
          merchantId: "publisher-example-v1",
          service: "Publisher API",
          upstreamUrl: "https://publisher.example/v1/search",
          price: "2500",
          resourceScope: "api:publisher-example-v1:get:v1-search",
          openApi: {
            endpointCount: 2,
            suggestedEndpoints: expect.arrayContaining([
              expect.objectContaining({
                method: "GET",
                path: "/v1/search",
                suggestedResourceScope: "api:publisher-example-v1:get:v1-search"
              })
            ])
          },
          selectedOpenApiEndpoint: {
            method: "GET",
            path: "/v1/search",
            operationId: "search"
          },
          reviewDraft: {
            publishMode: "review_only",
            gatewayMerchant: {
              id: "publisher-example-v1",
              resourceScope: "api:publisher-example-v1:get:v1-search"
            }
          }
        },
        conflicts: {
          merchantApplicationExists: false,
          merchantOrListingExists: false
        }
      });
      expect(body).not.toHaveProperty("application");
      expect(JSON.stringify(body)).not.toContain("sui402p_");
      expect(JSON.stringify(body)).not.toContain("sui402v_");
      expect(await stores.merchantApplications.list({ limit: 10 })).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("rotates legacy publisher access tokens without accepting the public verification nonce", async () => {
    const stores = createConsoleStores(baseConfig, false);
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const draft = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          id: "legacy-token-api",
          service: "Legacy Token API",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const draftBody = await draft.json();
      const application = draftBody.application;
      const { accessToken: _oldAccessToken, ...legacyVerification } = application.verification;
      await stores.merchantApplications.update({
        ...application,
        verification: legacyVerification
      });

      const publicNonceStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { "x-sui402-publisher-token": application.verification.token }
      });
      const rotation = await fetch(`${base}/v1/merchant-applications/${application.id}/publisher-access-token/rotate`, {
        method: "POST"
      });
      const rotationBody = await rotation.json();
      const newAccessToken = rotationBody.publisherAccessToken;
      const rotatedStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { "x-sui402-publisher-token": newAccessToken }
      });
      const sessionExchange = await fetch(`${base}/v1/publisher/apis/${application.id}/session`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": newAccessToken }
      });
      const sessionBody = await sessionExchange.json();
      const sessionStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { authorization: `Bearer ${sessionBody.publisherSessionToken}` }
      });
      const secondRotation = await fetch(`${base}/v1/merchant-applications/${application.id}/publisher-access-token/rotate`, {
        method: "POST"
      });
      const secondRotationBody = await secondRotation.json();
      const staleSessionStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { authorization: `Bearer ${sessionBody.publisherSessionToken}` }
      });
      const secondRotatedStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { "x-sui402-publisher-token": secondRotationBody.publisherAccessToken }
      });
      const staleAccessStatus = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const stored = await stores.merchantApplications.get(application.id);
      const auditEvents = await stores.audit.list({ limit: 10 });

      expect(publicNonceStatus.status).toBe(403);
      expect(rotation.status).toBe(200);
      expect(newAccessToken).toMatch(/^sui402p_/);
      expect(newAccessToken).not.toBe(application.verification.token);
      expect(newAccessToken).not.toBe(application.verification.accessToken);
      expect(rotationBody.note).toContain("returned only for this rotation response");
      expect(rotationBody.application.verification).toMatchObject({
        accessTokenPresent: true,
        accessTokenHash: expect.stringMatching(/^sha256:/)
      });
      expect(rotationBody.application.verification).not.toHaveProperty("accessToken");
      expect(rotationBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(rotationBody.application)).not.toContain(newAccessToken);
      expect(sessionExchange.status).toBe(201);
      expect(sessionStatus.status).toBe(200);
      expect(secondRotation.status).toBe(200);
      expect(secondRotationBody.application.verification).not.toHaveProperty("accessToken");
      expect(secondRotationBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(secondRotationBody.application)).not.toContain(secondRotationBody.publisherAccessToken);
      expect(staleSessionStatus.status).toBe(403);
      expect(secondRotatedStatus.status).toBe(200);
      expect(stored?.verification?.accessToken).toBe(secondRotationBody.publisherAccessToken);
      expect(stored?.metadata).toMatchObject({
        publisherAccessTokenRotatedAt: secondRotationBody.rotatedAt
      });
      expect(rotatedStatus.status).toBe(200);
      expect(staleAccessStatus.status).toBe(403);
      expect(auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "merchant_application.publisher_access_token.rotate",
            targetId: application.id,
            metadata: expect.objectContaining({
              merchantId: "legacy-token-api",
              previousAccessTokenWasMissing: true
            })
          })
        ])
      );
      expect(JSON.stringify(auditEvents)).not.toContain(newAccessToken);
      expect(JSON.stringify(auditEvents)).not.toContain(secondRotationBody.publisherAccessToken);
      expect(JSON.stringify(auditEvents)).not.toContain(sessionBody.publisherSessionToken);
      expect(JSON.stringify(auditEvents)).not.toContain(application.verification.accessToken);
    } finally {
      server.close();
    }
  });

  it("rate limits invalid publisher credentials without throttling valid publisher auth", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX: 1,
        SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS: 60000
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const draft = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "publisher-auth-limit-test" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          id: "publisher-auth-limit-api",
          service: "Publisher Auth Limit API",
          merchant: MERCHANT,
          price: "1000"
        })
      });
      const draftBody = await draft.json();
      const application = draftBody.application;
      const headers = { "x-sui402-publisher-token": "wrong-token", "user-agent": "publisher-auth-limit-test" };

      const firstInvalid = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, { headers });
      const secondInvalid = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, { headers });
      const valid = await fetch(`${base}/v1/publisher/apis/${application.id}/status`, {
        headers: {
          "x-sui402-publisher-token": application.verification.accessToken,
          "user-agent": "publisher-auth-limit-test"
        }
      });
      const secondInvalidBody = await secondInvalid.json();

      expect(firstInvalid.status).toBe(403);
      expect(firstInvalid.headers.get("cache-control")).toBe("no-store");
      expect(secondInvalid.status).toBe(429);
      expect(secondInvalid.headers.get("retry-after")).toBe("60");
      expect(secondInvalidBody).toMatchObject({
        error: "rate_limited",
        message: "Too many invalid publisher credentials. Try again later."
      });
      expect(valid.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("rejects OpenAPI operation selection without an import URL", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiOperationId: "search",
          merchant: MERCHANT
        })
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("openapi_selection_requires_import");
    } finally {
      server.close();
    }
  });

  it("rejects unknown selected OpenAPI operations before creating publisher drafts", async () => {
    const app = createConsoleApp(baseConfig, {
      seed: false,
      fetch: async () =>
        Response.json({
          openapi: "3.1.0",
          paths: {
            "/v1/search": {
              get: {
                operationId: "search"
              }
            }
          }
        })
    });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiUrl: "https://publisher.example/openapi.json",
          openApiOperationId: "missingOperation",
          merchant: MERCHANT
        })
      });
      const body = await response.json();
      const applications = await fetch(`${serverBaseUrl(server)}/v1/merchant-applications`);
      const applicationsBody = await applications.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("openapi_operation_not_found");
      expect(applicationsBody.applications).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("rejects unsafe OpenAPI import URLs before fetching publisher drafts", async () => {
    let fetched = false;
    const app = createConsoleApp(baseConfig, {
      seed: false,
      fetch: async () => {
        fetched = true;
        return Response.json({});
      }
    });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiUrl: "http://127.0.0.1:1234/openapi.json",
          merchant: MERCHANT
        })
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("unsafe_upstream_url");
      expect(fetched).toBe(false);
    } finally {
      server.close();
    }
  });

  it("enforces public intake host allow and block policy for publisher drafts", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS: "publisher.example,*.trusted.example",
        SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS: "blocked.example,*.abuse.example"
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const allowed = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://api.trusted.example/v1/search",
          id: "trusted-api",
          service: "Trusted API",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const notAllowed = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://not-on-list.example/v1/search",
          id: "not-allowed-api",
          service: "Not Allowed API",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const notAllowedBody = await notAllowed.json();
      const blocked = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://foo.abuse.example/v1/search",
          id: "blocked-api",
          service: "Blocked API",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const blockedBody = await blocked.json();
      const blockedOpenApi = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          openApiUrl: "https://blocked.example/openapi.json",
          id: "blocked-openapi",
          service: "Blocked OpenAPI",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const blockedOpenApiBody = await blockedOpenApi.json();

      expect(allowed.status).toBe(202);
      expect(notAllowed.status).toBe(403);
      expect(notAllowedBody).toMatchObject({
        error: "public_intake_host_not_allowed",
        hostname: "not-on-list.example",
        policy: "allowed_hosts"
      });
      expect(blocked.status).toBe(403);
      expect(blockedBody).toMatchObject({
        error: "public_intake_host_blocked",
        hostname: "foo.abuse.example",
        policy: "blocked_hosts"
      });
      expect(blockedOpenApi.status).toBe(403);
      expect(blockedOpenApiBody).toMatchObject({
        error: "public_intake_host_blocked",
        hostname: "blocked.example",
        policy: "blocked_hosts"
      });
    } finally {
      server.close();
    }
  });

  it("enforces public intake host policy for low-level merchant applications", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS: "blocked.example"
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "blocked-low-level",
          request: {
            id: "blocked-low-level-api",
            service: "Blocked Low Level API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:blocked",
            upstreamUrl: "https://blocked.example/v1/search"
          }
        })
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        error: "public_intake_host_blocked",
        hostname: "blocked.example"
      });
    } finally {
      server.close();
    }
  });

  it("ignores malformed persisted OpenAPI metadata in publisher status previews", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "malformed-openapi-metadata",
          request: {
            id: "metadata-api",
            service: "Metadata API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:metadata",
            upstreamUrl: "https://publisher.example/v1/search"
          },
          metadata: {
            openApi: {
              endpointCount: -1,
              suggestedEndpoints: [{ method: "TRACE", path: "", suggestedResourceScope: "" }],
              suggestedResourceScopes: ["api:metadata"]
            }
          }
        })
      });
      const submitBody = await response.json();
      const status = await fetch(`${serverBaseUrl(server)}/v1/publisher/apis/${submitBody.application.id}/status`, {
        headers: { "x-sui402-publisher-token": submitBody.application.verification.accessToken }
      });
      const statusBody = await status.json();

      expect(response.status).toBe(202);
      expect(status.status).toBe(200);
      expect(statusBody.preview.openApi).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("probes publisher API readiness and reports paid test evidence separately", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const stores = createConsoleStores(baseConfig, false);
    let verificationDocument: unknown;
    const verificationFetch: typeof fetch = async () =>
      new Response(JSON.stringify(verificationDocument), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const app = createConsoleApp(baseConfig, { stores, seed: false, fetch: verificationFetch });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const draft = await fetch(`${base}/v1/publisher/apis/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiUrl: "https://publisher.example/v1/search",
          id: "probe-api",
          service: "Probe API",
          merchant: MERCHANT,
          price: "2500"
        })
      });
      const draftBody = await draft.json();
      const application = draftBody.application;
      verificationDocument = draftBody.nextSteps.verificationDocument;

      const verify = await fetch(`${base}/v1/merchant-applications/${application.id}/verify`, { method: "POST" });
      const verifyBody = await verify.json();
      const queryTokenProbe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe?token=${application.verification.accessToken}`, {
        method: "POST"
      });
      const preApprovalProbe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const preApprovalBody = await preApprovalProbe.json();
      const review = await fetch(`${base}/v1/merchant-applications/${application.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "probe verified"
        })
      });
      const reviewBody = await review.json();
      const sessionExchange = await fetch(`${base}/v1/publisher/apis/${application.id}/session`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const sessionBody = await sessionExchange.json();
      const probe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const probeBody = await probe.json();
      const sessionProbe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionBody.publisherSessionToken}` }
      });
      const sessionProbeBody = await sessionProbe.json();

      expect(verify.status).toBe(200);
      expect(verifyBody.nextSteps).toMatchObject({
        phase: "operator_review",
        readyForReview: true,
        selfServeActions: expect.arrayContaining([
          expect.objectContaining({
            id: "check_status",
            command: `curl -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/status"`
          }),
          expect.objectContaining({
            id: "probe_readiness",
            command: `curl -X POST -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/probe"`
          })
        ]),
        operatorActions: expect.arrayContaining([
          expect.objectContaining({ id: "review_application" }),
          expect.objectContaining({ id: "publish_listing" }),
          expect.objectContaining({ id: "reject_application" })
        ])
      });
      expect(queryTokenProbe.status).toBe(403);
      expect(preApprovalProbe.status).toBe(409);
      expect(preApprovalBody).toMatchObject({
        ready: false,
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "application_review", ok: false })
        ])
      });
      expect(review.status).toBe(200);
      expect(reviewBody.reviewEvidence).toMatchObject({
        ownershipVerification: {
          required: true,
          verified: true
        },
        paidTest: {
          requiredForPublicLaunch: true,
          status: "pending_post_publish"
        }
      });
      expect(sessionExchange.status).toBe(201);
      expect(probe.status).toBe(409);
      expect(sessionProbe.status).toBe(409);
      expect(sessionProbeBody.publisherAuth).toMatchObject({
        kind: "publisher_session",
        sessionId: expect.stringMatching(/^psess_/)
      });
      await stores.payments.record(
        paymentRecordWithReceipt({
          privateKey,
          id: "probe-wrong-price-paid-test",
          amount: "1000",
          resource: "api:probe-api",
          sequence: "6",
          merchantId: "probe-api"
        })
      );
      const wrongTermsProbe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const wrongTermsProbeBody = await wrongTermsProbe.json();
      expect(probeBody).toMatchObject({
        ready: false,
        gatewayReady: true,
        applicationId: application.id,
        merchantId: "probe-api",
        unpaidProbe: {
          expectedStatus: 402,
          protectedResourceUrl: `${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/probe-api/pay`,
          challengeIssued: false,
          challenge: {
            network: "sui:testnet",
            recipient: MERCHANT,
            amount: "2500",
            resource: "api:probe-api"
          }
        },
        paidProbe: {
          supported: false,
          nextAction: {
            label: "Run paid test call",
            command: `${"sui402-pay curl"} ${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/probe-api/pay --max-one-shot-amount 2500`
          },
          evidence: {
            requiredForPublicLaunch: true,
            observed: false,
            status: "missing",
            verifiedPayments: 0
          }
        }
      });
      expect(probeBody.paidTestWizard).toMatchObject({
        schemaVersion: "sui402.publisher-paid-test-wizard.v1",
        readyForPublicLaunch: false,
        currentGate: "run_paid_test",
        commands: {
          checkStatus: `${"curl"} -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/status"`,
          rerunProbe: `${"curl -X POST"} -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/v1/publisher/apis/${application.id}/probe"`,
          unpaidChallenge: `${"curl -i"} "${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/probe-api/pay"`,
          paidCall: `${"sui402-pay curl"} ${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/probe-api/pay --max-one-shot-amount 2500`,
          inspectMarketplace: "sui402-pay marketplace detail probe-api",
          scanMerchant: "sui402-pay scan merchant probe-api"
        },
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "publish_or_verify", status: "done" }),
          expect.objectContaining({ id: "confirm_unpaid_402", status: "done" }),
          expect.objectContaining({ id: "run_paid_call", status: "current" }),
          expect.objectContaining({ id: "rerun_probe", status: "current" })
        ]),
        safety: expect.arrayContaining([
          "Uses a local non-custodial payer wallet.",
          "Caps one-shot fallback spend at the listed API price."
        ])
      });
      expect(probeBody.checks).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "paid_test_observed", ok: false })])
      );
      expect(wrongTermsProbe.status).toBe(409);
      expect(wrongTermsProbeBody.paidProbe.evidence).toMatchObject({
        observed: false,
        verifiedPayments: 0
      });
      await stores.payments.record(
        paymentRecordWithReceipt({
          privateKey,
          id: "probe-paid-test",
          amount: "2500",
          resource: "api:probe-api",
          sequence: "7",
          merchantId: "probe-api"
        })
      );
      const paidProbe = await fetch(`${base}/v1/publisher/apis/${application.id}/probe`, {
        method: "POST",
        headers: { "x-sui402-publisher-token": application.verification.accessToken }
      });
      const paidProbeBody = await paidProbe.json();
      expect(paidProbe.status).toBe(200);
      expect(paidProbeBody).toMatchObject({
        ready: true,
        gatewayReady: true,
        checks: expect.arrayContaining([expect.objectContaining({ name: "paid_test_observed", ok: true })])
      });
      expect(paidProbeBody.paidProbe).toMatchObject({
        supported: true,
        nextAction: {
          label: "Repeat paid test call",
          command: `${"sui402-pay curl"} ${baseConfig.SUI402_CONSOLE_PROVIDER_BASE_URL}/gateway/merchants/probe-api/pay --max-one-shot-amount 2500`
        },
        evidence: {
          observed: true,
          status: "observed",
          verifiedPayments: 1,
          sessionPayments: 1,
          volume: "2500",
          recentPayments: [expect.objectContaining({ digest: "probe-paid-test-digest" })]
        }
      });
      expect(paidProbeBody.paidTestWizard).toMatchObject({
        readyForPublicLaunch: true,
        currentGate: "complete",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "run_paid_call", status: "done" }),
          expect.objectContaining({ id: "rerun_probe", status: "done" })
        ])
      });
    } finally {
      server.close();
    }
  });

  it("requires publisher well-known verification before approving upstream-backed applications", async () => {
    let verificationDocument: unknown;
    const verificationFetch: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://publisher.example/.well-known/sui402-publisher.json");
      return new Response(JSON.stringify(verificationDocument), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const app = createConsoleApp(baseConfig, { seed: false, fetch: verificationFetch });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const submit = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-verify",
          request: {
            id: "verified-api",
            service: "Verified API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:verified",
            upstreamUrl: "https://publisher.example/v1/search",
            transport: "http"
          }
        })
      });
      const submitBody = await submit.json();
      const submitted = submitBody.application;
      const prematureReview = await fetch(`${base}/v1/merchant-applications/application-verify/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "checking gate"
        })
      });
      const prematureReviewBody = await prematureReview.json();

      verificationDocument = {
        sui402: "publisher-verification-v1",
        applicationId: submitted.id,
        merchantId: submitted.request.id,
        upstreamUrl: submitted.verification.expectedUpstreamUrl,
        verificationToken: submitted.verification.token
      };
      const verify = await fetch(`${base}/v1/merchant-applications/application-verify/verify`, {
        method: "POST"
      });
      const verifyBody = await verify.json();
      const review = await fetch(`${base}/v1/merchant-applications/application-verify/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "publisher control verified"
        })
      });
      const reviewBody = await review.json();

      expect(submit.status).toBe(202);
      expect(submitted.verification).toMatchObject({
        method: "well-known",
        status: "pending",
        verificationUrl: "https://publisher.example/.well-known/sui402-publisher.json",
        expectedUpstreamUrl: "https://publisher.example/v1/search"
      });
      expect(submitBody.nextSteps).toMatchObject({
        status: "pending",
        verificationRequired: true,
        readyForReview: false,
        phase: "verify_ownership",
        verificationUrl: "https://publisher.example/.well-known/sui402-publisher.json",
        verificationDocument: {
          sui402: "publisher-verification-v1",
          applicationId: "application-verify",
          merchantId: "verified-api",
          upstreamUrl: "https://publisher.example/v1/search",
          verificationToken: submitted.verification.token
        }
      });
      expect(prematureReview.status).toBe(409);
      expect(prematureReviewBody.error).toBe("publisher_verification_required");
      expect(prematureReviewBody.verification).toMatchObject({
        status: "pending",
        accessTokenPresent: true,
        accessTokenHash: expect.stringMatching(/^sha256:/)
      });
      expect(prematureReviewBody.verification).not.toHaveProperty("accessToken");
      expect(prematureReviewBody.verification).not.toHaveProperty("token");
      expect(JSON.stringify(prematureReviewBody)).not.toContain(submitted.verification.accessToken);
      expect(verify.status).toBe(200);
      expect(verifyBody.verification).toMatchObject({ status: "verified" });
      expect(verifyBody.verification).not.toHaveProperty("accessToken");
      expect(verifyBody.verification).not.toHaveProperty("token");
      expect(verifyBody.application.verification).toMatchObject({
        status: "verified",
        accessTokenPresent: true,
        accessTokenHash: prematureReviewBody.verification.accessTokenHash
      });
      expect(verifyBody.application.verification).not.toHaveProperty("accessToken");
      expect(verifyBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(verifyBody)).not.toContain(submitted.verification.accessToken);
      expect(verifyBody.nextSteps).toMatchObject({
        status: "pending",
        verificationRequired: true,
        readyForReview: true,
        phase: "operator_review"
      });
      expect(review.status).toBe(200);
      expect(reviewBody.application).toMatchObject({
        status: "approved",
        publishedMerchantId: "verified-api"
      });
      expect(reviewBody.application.verification).not.toHaveProperty("accessToken");
      expect(reviewBody.application.verification).not.toHaveProperty("token");
      expect(JSON.stringify(reviewBody)).not.toContain(submitted.verification.accessToken);
    } finally {
      server.close();
    }
  });

  it("allows DNS TXT publisher verification when the well-known document is unavailable", async () => {
    const stores = createConsoleStores(baseConfig, false);
    const app = createConsoleApp(baseConfig, {
      stores,
      seed: false,
      fetch: async () => new Response("not found", { status: 404 }),
      resolveTxt: async (hostname) => {
        expect(hostname).toBe("_sui402-publisher.publisher.example");
        const application = await stores.merchantApplications.get("application-dns-verify");
        const value = application?.verification?.dnsTxtValue;
        return value ? [[value]] : [];
      }
    });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const submit = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-dns-verify",
          request: {
            id: "dns-api",
            service: "DNS API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:dns",
            upstreamUrl: "https://publisher.example/v1/search",
            transport: "http"
          }
        })
      });
      const submitBody = await submit.json();
      const verify = await fetch(`${base}/v1/merchant-applications/application-dns-verify/verify`, { method: "POST" });
      const verifyBody = await verify.json();
      const review = await fetch(`${base}/v1/merchant-applications/application-dns-verify/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "dns ownership verified"
        })
      });

      expect(submit.status).toBe(202);
      expect(submitBody.nextSteps).toMatchObject({
        dnsTxtName: "_sui402-publisher.publisher.example",
        dnsTxtValue: expect.stringContaining("sui402=publisher-verification-v1")
      });
      expect(verify.status).toBe(200);
      expect(verifyBody.verification).toMatchObject({
        method: "dns-txt",
        status: "verified",
        dnsTxtName: "_sui402-publisher.publisher.example",
        dnsTxtValue: submitBody.application.verification.dnsTxtValue
      });
      expect(review.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("verifies payout wallet signatures without bypassing upstream ownership proof", async () => {
    const payoutKeypair = new Ed25519Keypair();
    const payoutWallet = payoutKeypair.getPublicKey().toSuiAddress();
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const submit = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-wallet-proof",
          request: {
            id: "wallet-proof-api",
            service: "Wallet Proof API",
            merchant: payoutWallet,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:wallet-proof",
            upstreamUrl: "https://publisher.example/v1/search",
            transport: "http"
          }
        })
      });
      const submitBody = await submit.json();
      const application = submitBody.application;
      const message = publisherWalletProofMessage({
        applicationId: application.id,
        merchantId: application.request.id,
        payoutWallet,
        network: application.request.network,
        coinType: application.request.coinType,
        price: application.request.price,
        resourceScope: application.request.resourceScope,
        upstreamUrl: application.request.upstreamUrl
      });
      const badMessageSignature = await payoutKeypair.signPersonalMessage(new TextEncoder().encode(`${message}\nprice=9999`));
      const badMessage = await fetch(`${base}/v1/merchant-applications/${application.id}/wallet-proof`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          signature: badMessageSignature.signature
        })
      });
      const badMessageBody = await badMessage.json();
      const signed = await payoutKeypair.signPersonalMessage(new TextEncoder().encode(message));
      const walletProof = await fetch(`${base}/v1/merchant-applications/${application.id}/wallet-proof`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          signature: signed.signature
        })
      });
      const walletProofBody = await walletProof.json();
      const prematureReview = await fetch(`${base}/v1/merchant-applications/${application.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "wallet proof only is not enough"
        })
      });
      const prematureReviewBody = await prematureReview.json();

      expect(submit.status).toBe(202);
      expect(badMessage.status).toBe(400);
      expect(badMessageBody).toMatchObject({
        error: "wallet_proof_invalid",
        expectedAddress: payoutWallet
      });
      expect(walletProof.status).toBe(200);
      expect(walletProofBody.walletProof).toMatchObject({
        schemaVersion: "sui402.publisher-wallet-proof.v1",
        status: "verified",
        method: "sui-personal-message",
        address: payoutWallet,
        applicationId: application.id,
        merchantId: "wallet-proof-api",
        network: "sui:testnet",
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:wallet-proof",
        upstreamUrl: "https://publisher.example/v1/search",
        messageHash: expect.stringMatching(/^sha256:/),
        signatureHash: expect.stringMatching(/^sha256:/),
        verifiedAt: expect.any(String)
      });
      expect(walletProofBody.application.walletProof).toMatchObject({
        address: payoutWallet,
        messageHash: walletProofBody.walletProof.messageHash
      });
      expect(walletProofBody.application.reviewDraft.gates).toContainEqual(
        expect.objectContaining({
          id: "payout_wallet_proof",
          passed: true
        })
      );
      expect(JSON.stringify(walletProofBody)).not.toContain(signed.signature);
      expect(prematureReview.status).toBe(409);
      expect(prematureReviewBody.error).toBe("publisher_verification_required");
    } finally {
      server.close();
    }
  });

  it("rejects unsafe upstream URLs during public merchant application intake", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-unsafe-upstream",
          request: {
            id: "unsafe-api",
            service: "Unsafe API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:unsafe",
            upstreamUrl: "http://localhost:1234/private"
          }
        })
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("unsafe_upstream_url");
    } finally {
      server.close();
    }
  });

  it("rate limits public merchant application submissions", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX: 1,
        SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS: 60000
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const first = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "rate-limit-test" },
        body: JSON.stringify({
          id: "application-rate-limit-1",
          request: {
            id: "rate-limit-api-1",
            service: "Rate Limit API 1",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:rate-limit-1"
          }
        })
      });
      const second = await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "rate-limit-test" },
        body: JSON.stringify({
          id: "application-rate-limit-2",
          request: {
            id: "rate-limit-api-2",
            service: "Rate Limit API 2",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:rate-limit-2"
          }
        })
      });
      const body = await second.json();

      expect(first.status).toBe(202);
      expect(second.status).toBe(429);
      expect(body).toMatchObject({
        error: "rate_limited",
        retryAfterSeconds: expect.any(Number)
      });
    } finally {
      server.close();
    }
  });

  it("rate limits public marketplace and scan reads with separate buckets", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX: 1,
        SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_WINDOW_MS: 60000
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const headers = { "user-agent": "public-read-rate-limit-test" };
      const firstScan = await fetch(`${base}/v1/scan/stats`, { headers });
      const secondScan = await fetch(`${base}/v1/scan/stats`, { headers });
      const marketplace = await fetch(`${base}/v1/marketplace/apis`, { headers });
      const secondScanBody = await secondScan.json();

      expect(firstScan.status).toBe(200);
      expect(firstScan.headers.get("cache-control")).toBe("public, max-age=15, stale-while-revalidate=60");
      expect(secondScan.status).toBe(429);
      expect(secondScan.headers.get("retry-after")).toBeTruthy();
      expect(secondScan.headers.get("cache-control")).toBe("no-store");
      expect(secondScanBody).toMatchObject({
        error: "rate_limited",
        message: expect.stringContaining("public scan requests")
      });
      expect(marketplace.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("reviews merchant applications and publishes approved merchants", async () => {
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
        { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
        { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] }
      ])
    };
    const app = createConsoleApp(config, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-approve",
          request: {
            id: "approved-api",
            service: "Approved API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:approved"
          }
        })
      });

      const forbiddenList = await fetch(`${base}/v1/merchant-applications`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const review = await fetch(`${base}/v1/merchant-applications/application-approve/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer merchant-admin-key"
        },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "KYB complete"
        })
      });
      const body = await review.json();
      const manifest = await fetch(`${base}/gateway/merchants/approved-api/.well-known/sui402`);

      expect(forbiddenList.status).toBe(403);
      expect(review.status).toBe(200);
      expect(body.application).toMatchObject({
        status: "approved",
        reviewer: "ops@example.com",
        publishedMerchantId: "approved-api"
      });
      expect(body.merchant.id).toBe("approved-api");
      expect(manifest.status).toBe(200);
      expect((await manifest.json()).service).toBe("Approved API");
    } finally {
      server.close();
    }
  });

  it("rejects merchant applications without publishing merchants", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-reject",
          request: {
            id: "rejected-api",
            service: "Rejected API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:rejected"
          }
        })
      });
      const review = await fetch(`${base}/v1/merchant-applications/application-reject/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          reason: "Unsupported risk profile"
        })
      });
      const merchant = await fetch(`${base}/gateway/merchants/rejected-api/.well-known/sui402`);

      expect(review.status).toBe(200);
      expect((await review.json()).application).toMatchObject({
        status: "rejected",
        reviewReason: "Unsupported risk profile"
      });
      expect(merchant.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("enforces role-scoped operator keys in production", async () => {
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
        { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
        { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] },
        { id: "exporter", key: "exporter-key-with-len", roles: ["exporter"] },
        { id: "indexer", key: "indexer-key-with-len", roles: ["indexer"] }
      ])
    };
    const app = createConsoleApp(config, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const unauthorizedOverview = await fetch(`${base}/v1/overview`);
      const overview = await fetch(`${base}/v1/overview`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const forbiddenCreate = await fetch(`${base}/v1/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer viewer-key-with-length"
        },
        body: JSON.stringify({})
      });
      const allowedCreate = await fetch(`${base}/v1/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer merchant-admin-key"
        },
        body: JSON.stringify({
          id: "role-api",
          service: "Role API",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:role"
        })
      });
      const allowedExportList = await fetch(`${base}/v1/exports`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const forbiddenCursor = await fetch(`${base}/v1/indexer/cursors/test-cursor`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const allowedCursor = await fetch(`${base}/v1/indexer/cursors/test-cursor`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer indexer-key-with-len"
        },
        body: JSON.stringify({ cursor: "10:0" })
      });

      expect(unauthorizedOverview.status).toBe(401);
      expect(overview.status).toBe(200);
      expect(forbiddenCreate.status).toBe(403);
      expect(await forbiddenCreate.json()).toMatchObject({
        error: "forbidden",
        requiredRole: "merchant_admin"
      });
      expect(allowedCreate.status).toBe(201);
      expect(allowedExportList.status).toBe(200);
      expect(forbiddenCursor.status).toBe(403);
      expect(allowedCursor.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("enforces operator key validity windows for rotation", async () => {
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
        {
          id: "old-viewer",
          key: "old-viewer-key-with-length",
          roles: ["viewer"],
          expiresAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "new-viewer",
          key: "new-viewer-key-with-length",
          roles: ["viewer"],
          notBefore: "2026-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      ])
    };
    const app = createConsoleApp(config, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const oldKey = await fetch(`${base}/v1/overview`, {
        headers: { authorization: "Bearer old-viewer-key-with-length" }
      });
      const newKey = await fetch(`${base}/v1/overview`, {
        headers: { authorization: "Bearer new-viewer-key-with-length" }
      });

      expect(oldKey.status).toBe(401);
      expect(newKey.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("accepts OIDC JWT operator roles from a JWKS endpoint", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" });
    const jwksServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] }));
    });
    jwksServer.listen(0);

    try {
      const issuer = "https://issuer.example";
      const audience = "sui402-console";
      const token = signJwt({
        header: { alg: "RS256", kid: "test-key", typ: "JWT" },
        claims: {
          iss: issuer,
          aud: audience,
          sub: "ops-user@example.com",
          roles: ["viewer"],
          exp: Math.floor(Date.now() / 1000) + 300
        },
        privateKey
      });
      const app = createConsoleApp(
        {
          ...baseConfig,
          NODE_ENV: "production",
          SUI402_CONSOLE_OIDC_ISSUER: issuer,
          SUI402_CONSOLE_OIDC_AUDIENCE: audience,
          SUI402_CONSOLE_OIDC_JWKS_URL: `${serverBaseUrl(jwksServer)}/.well-known/jwks.json`
        },
        { seed: false }
      );
      const server = app.listen(0);

      try {
        const base = serverBaseUrl(server);
        const overview = await fetch(`${base}/v1/overview`, {
          headers: { authorization: `Bearer ${token}` }
        });
        const forbiddenCreate = await fetch(`${base}/v1/merchants`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({})
        });

        expect(overview.status).toBe(200);
        expect(forbiddenCreate.status).toBe(403);
        expect(await forbiddenCreate.json()).toMatchObject({
          error: "forbidden",
          requiredRole: "merchant_admin"
        });
      } finally {
        server.close();
      }
    } finally {
      jwksServer.close();
    }
  });

  it("records admin-only audit events for sensitive console actions", async () => {
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
        { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
        { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] },
        { id: "admin", key: "admin-key-with-length", roles: ["admin"] }
      ])
    };
    const app = createConsoleApp(config, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      await fetch(`${base}/v1/merchant-applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "application-audit",
          request: {
            id: "audit-api",
            service: "Audit API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:audit"
          }
        })
      });
      const review = await fetch(`${base}/v1/merchant-applications/application-audit/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer merchant-admin-key",
          "x-request-id": "request-audit-1"
        },
        body: JSON.stringify({
          action: "approve",
          reviewer: "ops@example.com",
          reason: "KYB complete"
        })
      });
      const forbidden = await fetch(`${base}/v1/audit-events`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const auditResponse = await fetch(`${base}/v1/audit-events?targetId=application-audit`, {
        headers: { authorization: "Bearer admin-key-with-length" }
      });
      const auditVerification = await fetch(`${base}/v1/audit-events/verify`, {
        headers: { authorization: "Bearer admin-key-with-length" }
      });
      const audit = await auditResponse.json();
      const verification = await auditVerification.json();

      expect(review.status).toBe(200);
      expect(forbidden.status).toBe(403);
      expect(auditResponse.status).toBe(200);
      expect(auditVerification.status).toBe(200);
      expect(audit.events.map((event: { action: string }) => event.action)).toEqual(
        expect.arrayContaining(["merchant_application.approve", "merchant_application.submit"])
      );
      const approvalEvent = audit.events.find(
        (event: { action: string }) => event.action === "merchant_application.approve"
      );
      expect(approvalEvent).toMatchObject({
        actorId: "merchant-admin",
        actorRoles: ["merchant_admin"],
        requestId: "request-audit-1",
        targetType: "merchant_application",
        targetId: "application-audit"
      });
      expect(approvalEvent.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(verification).toMatchObject({
        ok: true,
        checked: expect.any(Number),
        headHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
    } finally {
      server.close();
    }
  });

  it("keeps the legacy console admin key as a superuser", async () => {
    const app = createConsoleApp(
      {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_ADMIN_API_KEY: "legacy-admin-secret"
      },
      { seed: false }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sui402-admin-key": "legacy-admin-secret"
        },
        body: JSON.stringify({
          id: "legacy-api",
          service: "Legacy API",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:legacy"
        })
      });

      expect(response.status).toBe(201);
    } finally {
      server.close();
    }
  });

  it("applies console RBAC to mounted gateway admin routes", async () => {
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
        { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
        { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] }
      ])
    };
    const app = createConsoleApp(config, { seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const forbidden = await fetch(`${base}/gateway/merchants`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const allowed = await fetch(`${base}/gateway/merchants`, {
        headers: { authorization: "Bearer merchant-admin-key" }
      });

      expect(forbidden.status).toBe(403);
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).count).toBe(0);
    } finally {
      server.close();
    }
  });

  it("persists console merchants and listings in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const createResponse = await fetch(`${serverBaseUrl(firstServer)}/v1/merchants`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "persisted-api",
            service: "Persisted API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:persisted",
            transport: "http"
          })
        });

        expect(createResponse.status).toBe(201);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const overviewResponse = await fetch(`${serverBaseUrl(secondServer)}/v1/overview`);
        const overview = await overviewResponse.json();

        expect(overview.merchants.map((merchant: { id: string }) => merchant.id)).toContain("persisted-api");
        expect(overview.listings.map((listing: { id: string }) => listing.id)).toContain("persisted-api");
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("serves durable public marketplace and scan records from recreated file storage", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-public-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstStores = createConsoleStores(config, false);
      const firstApp = createConsoleApp(config, { stores: firstStores, seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const createResponse = await fetch(`${serverBaseUrl(firstServer)}/v1/merchants`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "persisted-api",
            service: "Persisted API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:*",
            transport: "http"
          })
        });
        expect(createResponse.status).toBe(201);

        await firstStores.payments.record(
          paymentRecordWithReceipt({
            privateKey,
            id: "persisted-payment",
            amount: "1000",
            sequence: "1",
            merchantId: "persisted-api"
          })
        );
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const base = serverBaseUrl(secondServer);
        const marketplace = await fetch(`${base}/v1/marketplace/apis?q=persisted`);
        const marketplaceBody = await marketplace.json();
        const marketplaceDetail = await fetch(`${base}/v1/marketplace/apis/persisted-api`);
        const marketplaceDetailBody = await marketplaceDetail.json();
        const marketplacePage = await fetch(`${base}/marketplace/persisted-api`);
        const marketplacePageHtml = await marketplacePage.text();
        const scanStats = await fetch(`${base}/v1/scan/stats`);
        const scanStatsBody = await scanStats.json();
        const payment = await fetch(`${base}/v1/scan/payments/persisted-payment-digest`);
        const paymentBody = await payment.json();
        const merchant = await fetch(`${base}/v1/scan/merchants/persisted-api`);
        const merchantBody = await merchant.json();

        expect(marketplace.status).toBe(200);
        expect(marketplaceBody.apis).toHaveLength(1);
        expect(marketplaceBody.apis[0]).toMatchObject({
          id: "persisted-api",
          stats: {
            verifiedPayments: 1,
            sessionPayments: 1,
            volume: "1000"
          },
          reliability: {
            paidTestObserved: true,
            verifiedPayments: 1,
            sessionPayments: 1,
            oneShotPayments: 0,
            recentIndexedPayments: 1,
            firstVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
            lastVerifiedPaymentAt: "2026-05-19T00:00:00.000Z"
          }
        });

        expect(marketplaceDetail.status).toBe(200);
        expect(marketplaceDetailBody).toMatchObject({
          api: {
            id: "persisted-api"
          },
          readiness: {
            ready: true
          },
          reliability: {
            paidTestObserved: true,
            recentIndexedPayments: 1
          },
          recentPayments: [
            expect.objectContaining({
              digest: "persisted-payment-digest",
              merchantId: "persisted-api"
            })
          ]
        });

        expect(marketplacePage.status).toBe(200);
        expect(marketplacePageHtml).toContain("Persisted API");
        expect(marketplacePageHtml).toContain("Paid test observed");
        expect(marketplacePageHtml).toContain("2026-05-19T00:00:00.000Z");

        expect(scanStats.status).toBe(200);
        expect(scanStatsBody.totals.verifiedPayments).toBe(1);
        expect(scanStatsBody.totals.sessionPayments).toBe(1);

        expect(payment.status).toBe(200);
        expect(paymentBody).toMatchObject({
          digest: "persisted-payment-digest",
          merchantId: "persisted-api",
          evidence: {
            class: "signed_receipt"
          }
        });

        expect(merchant.status).toBe(200);
        expect(merchantBody).toMatchObject({
          merchant: {
            id: "persisted-api"
          },
          stats: {
            verifiedPayments: 1,
            sessionPayments: 1,
            volume: "1000"
          },
          listing: {
            id: "persisted-api",
            reliability: {
              paidTestObserved: true,
              verifiedPayments: 1
            }
          }
        });

        assertPublicSurfacePolicy("durable marketplace search", marketplaceBody);
        assertPublicSurfacePolicy("durable marketplace detail", marketplaceDetailBody);
        assertPublicSurfacePolicy("durable scan stats", scanStatsBody);
        assertPublicSurfacePolicy("durable scan payment", paymentBody);
        assertPublicSurfacePolicy("durable scan merchant", merchantBody);
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists merchant applications in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-applications-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(firstServer)}/v1/merchant-applications`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "application-persisted",
            request: {
              id: "persisted-application-api",
              service: "Persisted Application API",
              merchant: MERCHANT,
              coinType: "0x2::sui::SUI",
              price: "1000",
              resourceScope: "api:persisted-application"
            }
          })
        });

        expect(response.status).toBe(202);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const overviewResponse = await fetch(`${serverBaseUrl(secondServer)}/v1/overview`);
        const overview = await overviewResponse.json();

        expect(overview.merchantApplications).toHaveLength(1);
        expect(overview.merchantApplications[0].id).toBe("application-persisted");
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists audit events in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-audit-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(firstServer)}/v1/merchants`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "audit-persisted-api",
            service: "Audit Persisted API",
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:audit-persisted",
            transport: "http"
          })
        });

        expect(response.status).toBe(201);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(secondServer)}/v1/audit-events?action=merchant.create`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.events).toHaveLength(1);
        expect(body.events[0]).toMatchObject({
          action: "merchant.create",
          targetType: "merchant",
          targetId: "audit-persisted-api"
        });
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lists and aggregates indexed session spend records", async () => {
    const stores = createConsoleStores(baseConfig, false);
    await stores.sessionSpends.upsert(
      sessionSpendRecord({
        id: "digest-1:0",
        amount: "1000",
        timestampMs: "1780000000000"
      })
    );
    await stores.sessionSpends.upsert(
      sessionSpendRecord({
        id: "digest-2:0",
        txDigest: "digest-2",
        amount: "2500",
        timestampMs: "1780000001000"
      })
    );
    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const spendsResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/session-spends?limit=10`);
      const spendsBody = await spendsResponse.json();
      const sessionsResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/sessions`);
      const sessionsBody = await sessionsResponse.json();
      const overviewResponse = await fetch(`${serverBaseUrl(server)}/v1/overview`);
      const overview = await overviewResponse.json();

      expect(spendsResponse.status).toBe(200);
      expect(spendsBody.records).toHaveLength(2);
      expect(spendsBody.records[0].id).toBe("digest-2:0");
      expect(sessionsResponse.status).toBe(200);
      expect(sessionsBody.sessions).toHaveLength(1);
      expect(sessionsBody.sessions[0].spentAmount).toBe("3500");
      expect(sessionsBody.sessions[0].spendCount).toBe(2);
      expect(overview.kpis.indexedSessionSpends).toBe(2);
      expect(overview.kpis.indexedSessions).toBe(1);
    } finally {
      server.close();
    }
  });

  it("enforces seller-scoped merchant access and constrained seller updates", async () => {
    const stores = createConsoleStores(baseConfig, true);
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_SELLER_KEYS_JSON: JSON.stringify([
        { id: "atlas-viewer", key: "atlas-viewer-key-with-length", merchantIds: ["atlas-api"], roles: ["seller_viewer"] },
        { id: "atlas-admin", key: "atlas-admin-key-with-length", merchantIds: ["atlas-api"], roles: ["seller_admin"] },
        { id: "signal-admin", key: "signal-admin-key-with-length", merchantIds: ["signal-mcp"], roles: ["seller_admin"] }
      ])
    };
    const app = createConsoleApp(config, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const unauthorized = await fetch(`${base}/v1/seller/merchants/atlas-api`);
      const ownRead = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        headers: { authorization: "Bearer atlas-viewer-key-with-length" }
      });
      const crossRead = await fetch(`${base}/v1/seller/merchants/signal-mcp`, {
        headers: { authorization: "Bearer atlas-viewer-key-with-length" }
      });
      const forbiddenUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer atlas-viewer-key-with-length"
        },
        body: JSON.stringify({ price: "2000000" })
      });
      const immutableUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer atlas-admin-key-with-length"
        },
        body: JSON.stringify({ merchant: `0x${"f".repeat(64)}` })
      });
      const upstreamUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer atlas-admin-key-with-length"
        },
        body: JSON.stringify({ upstreamUrl: "https://publisher.example/v2/search" })
      });
      const upstreamUpdateBody = await upstreamUpdate.json();
      const allowedUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer atlas-admin-key-with-length",
          "x-request-id": "seller-update-1"
        },
        body: JSON.stringify({ service: "Atlas API Pro", price: "2000000", status: "paused" })
      });
      const ownReadBody = await ownRead.json();
      const updated = await allowedUpdate.json();
      const auditEvents = await stores.audit.list({ action: "seller.merchant.update", targetId: "atlas-api", limit: 10 });

      expect(unauthorized.status).toBe(401);
      expect(ownRead.status).toBe(200);
      expect(ownReadBody.merchant).toMatchObject({ id: "atlas-api", service: "Atlas API" });
      expect(crossRead.status).toBe(403);
      expect(forbiddenUpdate.status).toBe(403);
      expect(immutableUpdate.status).toBe(400);
      expect(upstreamUpdate.status).toBe(409);
      expect(upstreamUpdateBody).toMatchObject({
        error: "upstream_verification_required",
        requestedUpstreamUrl: "https://publisher.example/v2/search"
      });
      expect(allowedUpdate.status).toBe(200);
      expect(updated.merchant).toMatchObject({ id: "atlas-api", service: "Atlas API Pro", price: "2000000", status: "paused" });
      expect(await stores.merchants.get("atlas-api")).toMatchObject({ service: "Atlas API Pro", price: "2000000", status: "paused" });
      expect(await stores.listings.get("atlas-api")).toMatchObject({ name: "Atlas API Pro", price: "2000000", status: "paused" });
      expect(auditEvents[0]).toMatchObject({
        actorId: "atlas-admin",
        actorRoles: ["seller_admin"],
        requestId: "seller-update-1",
        targetType: "merchant",
        targetId: "atlas-api"
      });
    } finally {
      server.close();
    }
  });

  it("accepts OIDC seller JWTs with merchant-scoped claims instead of static seller keys", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" });
    const jwks = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: "seller-key", alg: "RS256", use: "sig" }] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, resolve));
    const jwksPort = (jwks.address() as AddressInfo).port;
    const stores = createConsoleStores(baseConfig, true);
    const config: ConsoleConfig = {
      ...baseConfig,
      NODE_ENV: "production",
      SUI402_CONSOLE_SELLER_KEYS_JSON: undefined,
      SUI402_CONSOLE_OIDC_ISSUER: "https://issuer.example",
      SUI402_CONSOLE_OIDC_AUDIENCE: "sui402-console",
      SUI402_CONSOLE_OIDC_JWKS_URL: `http://127.0.0.1:${jwksPort}/jwks.json`,
      SUI402_CONSOLE_OIDC_ROLE_CLAIM: "roles",
      SUI402_CONSOLE_OIDC_SUBJECT_CLAIM: "sub",
      SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM: "merchant_ids"
    };
    const app = createConsoleApp(config, { stores, seed: false });
    const server = app.listen(0);
    const now = Math.floor(Date.now() / 1000);
    const sellerViewerToken = signJwt({
      header: { alg: "RS256", kid: "seller-key" },
      privateKey,
      claims: {
        iss: "https://issuer.example",
        aud: "sui402-console",
        sub: "seller-user-1",
        exp: now + 300,
        roles: ["seller_viewer"],
        merchant_ids: ["atlas-api"]
      }
    });
    const sellerAdminToken = signJwt({
      header: { alg: "RS256", kid: "seller-key" },
      privateKey,
      claims: {
        iss: "https://issuer.example",
        aud: "sui402-console",
        sub: "seller-admin-1",
        exp: now + 300,
        roles: ["seller_admin"],
        merchant_ids: ["atlas-api"]
      }
    });
    const noMerchantScopeToken = signJwt({
      header: { alg: "RS256", kid: "seller-key" },
      privateKey,
      claims: {
        iss: "https://issuer.example",
        aud: "sui402-console",
        sub: "seller-no-scope",
        exp: now + 300,
        roles: ["seller_admin"],
        merchant_ids: []
      }
    });

    try {
      const base = serverBaseUrl(server);
      const ownRead = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        headers: { authorization: `Bearer ${sellerViewerToken}` }
      });
      const crossRead = await fetch(`${base}/v1/seller/merchants/signal-mcp`, {
        headers: { authorization: `Bearer ${sellerViewerToken}` }
      });
      const viewerUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sellerViewerToken}`
        },
        body: JSON.stringify({ status: "paused" })
      });
      const noScopeRead = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        headers: { authorization: `Bearer ${noMerchantScopeToken}` }
      });
      const adminUpdate = await fetch(`${base}/v1/seller/merchants/atlas-api`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sellerAdminToken}`,
          "x-request-id": "oidc-seller-update-1"
        },
        body: JSON.stringify({ status: "paused" })
      });
      const adminUpdateBody = await adminUpdate.json();
      const auditEvents = await stores.audit.list({ action: "seller.merchant.update", targetId: "atlas-api", limit: 10 });

      expect(ownRead.status).toBe(200);
      expect(crossRead.status).toBe(403);
      expect(viewerUpdate.status).toBe(403);
      expect(noScopeRead.status).toBe(401);
      expect(adminUpdate.status).toBe(200);
      expect(adminUpdateBody.merchant).toMatchObject({ id: "atlas-api", status: "paused" });
      expect(auditEvents[0]).toMatchObject({
        actorId: "seller-admin-1",
        actorRoles: ["seller_admin"],
        requestId: "oidc-seller-update-1"
      });
    } finally {
      server.close();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
    }
  });

  describe("operator-reviewed seller merchant change requests", () => {
    it("lets a seller_admin submit a pending change request without mutating live merchant state", async () => {
      const stores = createConsoleStores(baseConfig, true);
      const originalMerchant = await stores.merchants.get("atlas-api");
      const originalListing = await stores.listings.get("atlas-api");
      const requestedMerchant = `0x${"f".repeat(64)}`;
      const config: ConsoleConfig = {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_SELLER_KEYS_JSON: JSON.stringify([
          { id: "atlas-admin", key: "atlas-admin-key-with-length", merchantIds: ["atlas-api"], roles: ["seller_admin"] }
        ])
      };
      const app = createConsoleApp(config, { stores, seed: false });
      const server = app.listen(0);

      try {
        const base = serverBaseUrl(server);
        const submit = await fetch(`${base}/v1/seller/merchants/atlas-api/change-requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer atlas-admin-key-with-length",
            "x-request-id": "merchant-change-submit-1"
          },
          body: JSON.stringify({
            id: "atlas-change-1",
            changes: {
              merchant: requestedMerchant
            },
            reason: "Rotate payout wallet after key ceremony"
          })
        });
        const crossMerchantSubmit = await fetch(`${base}/v1/seller/merchants/signal-mcp/change-requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer atlas-admin-key-with-length"
          },
          body: JSON.stringify({
            id: "signal-change-1",
            changes: { merchant: requestedMerchant },
            reason: "Should not be allowed"
          })
        });
        const submitBody = await submit.json();
        const crossMerchantBody = await crossMerchantSubmit.json();
        const auditEvents = await stores.audit.list({ targetId: "atlas-change-1", limit: 10 });

        expect(submit.status).toBe(202);
        expect(submitBody.request).toMatchObject({
          id: "atlas-change-1",
          merchantId: "atlas-api",
          status: "pending",
          changes: {
            merchant: requestedMerchant
          },
          requestedBy: "atlas-admin"
        });
        expect(crossMerchantSubmit.status).toBe(403);
        expect(crossMerchantBody.error).toBe("merchant_forbidden");
        expect(await stores.merchants.get("atlas-api")).toEqual(originalMerchant);
        expect(await stores.listings.get("atlas-api")).toEqual(originalListing);
        expect(auditEvents).toContainEqual(
          expect.objectContaining({
            action: "seller.merchant_change.request",
            actorId: "atlas-admin",
            actorRoles: ["seller_admin"],
            requestId: "merchant-change-submit-1",
            targetType: "merchant_change_request",
            targetId: "atlas-change-1",
            metadata: expect.objectContaining({
              merchantId: "atlas-api",
              changedFields: ["merchant"],
              requested: expect.objectContaining({ merchant: requestedMerchant })
            })
          })
        );
      } finally {
        server.close();
      }
    });

    it("prevents viewer approval and lets an operator approval update the merchant and listing", async () => {
      const stores = createConsoleStores(baseConfig, true);
      const requestedMerchant = `0x${"f".repeat(64)}`;
      const config: ConsoleConfig = {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_SELLER_KEYS_JSON: JSON.stringify([
          { id: "atlas-admin", key: "atlas-admin-key-with-length", merchantIds: ["atlas-api"], roles: ["seller_admin"] }
        ]),
        SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
          { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
          { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] }
        ])
      };
      const app = createConsoleApp(config, { stores, seed: false });
      const server = app.listen(0);

      try {
        const base = serverBaseUrl(server);
        await fetch(`${base}/v1/seller/merchants/atlas-api/change-requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer atlas-admin-key-with-length"
          },
          body: JSON.stringify({
            id: "atlas-change-approve",
            changes: {
              merchant: requestedMerchant
            },
            reason: "Prepared payout wallet rotation for operator approval"
          })
        });
        const viewerApproval = await fetch(`${base}/v1/merchant-change-requests/atlas-change-approve/review`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer viewer-key-with-length"
          },
          body: JSON.stringify({ action: "approve", reason: "I can read but should not approve" })
        });
        const approval = await fetch(`${base}/v1/merchant-change-requests/atlas-change-approve/review`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer merchant-admin-key",
            "x-request-id": "merchant-change-approve-1"
          },
          body: JSON.stringify({ action: "approve", reason: "Operator reviewed and approved" })
        });
        const viewerApprovalBody = await viewerApproval.json();
        const approvalBody = await approval.json();
        const auditEvents = await stores.audit.list({ targetId: "atlas-change-approve", limit: 10 });

        expect(viewerApproval.status).toBe(403);
        expect(viewerApprovalBody.error).toBe("forbidden");
        expect(approval.status).toBe(200);
        expect(approvalBody.request).toMatchObject({
          id: "atlas-change-approve",
          merchantId: "atlas-api",
          status: "approved",
          reviewer: "merchant-admin",
          reviewReason: "Operator reviewed and approved"
        });
        expect(await stores.merchants.get("atlas-api")).toMatchObject({
          merchant: requestedMerchant,
          service: "Atlas API",
          status: "active"
        });
        expect(await stores.listings.get("atlas-api")).toMatchObject({
          merchant: requestedMerchant,
          name: "Atlas API",
          status: "active"
        });
        expect(auditEvents.map((event) => event.action)).toEqual(
          expect.arrayContaining(["seller.merchant_change.request", "merchant_change.approve"])
        );
        expect(auditEvents).toContainEqual(
          expect.objectContaining({
            action: "merchant_change.approve",
            actorId: "merchant-admin",
            actorRoles: ["merchant_admin"],
            requestId: "merchant-change-approve-1",
            targetType: "merchant_change_request",
            targetId: "atlas-change-approve",
            metadata: expect.objectContaining({
              merchantId: "atlas-api",
              changedFields: ["merchant"],
              requested: expect.objectContaining({ merchant: requestedMerchant })
            })
          })
        );
      } finally {
        server.close();
      }
    });

    it("records rejection audit events while leaving merchant and listing values unchanged", async () => {
      const stores = createConsoleStores(baseConfig, true);
      const originalMerchant = await stores.merchants.get("atlas-api");
      const originalListing = await stores.listings.get("atlas-api");
      const config: ConsoleConfig = {
        ...baseConfig,
        NODE_ENV: "production",
        SUI402_CONSOLE_SELLER_KEYS_JSON: JSON.stringify([
          { id: "atlas-admin", key: "atlas-admin-key-with-length", merchantIds: ["atlas-api"], roles: ["seller_admin"] }
        ]),
        SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
          { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] }
        ])
      };
      const app = createConsoleApp(config, { stores, seed: false });
      const server = app.listen(0);

      try {
        const base = serverBaseUrl(server);
        await fetch(`${base}/v1/seller/merchants/atlas-api/change-requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer atlas-admin-key-with-length"
          },
          body: JSON.stringify({
            id: "atlas-change-reject",
            changes: {
              coinType: "0x2::coin::COIN"
            },
            reason: "Switch settlement coin"
          })
        });
        const rejection = await fetch(`${base}/v1/merchant-change-requests/atlas-change-reject/review`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer merchant-admin-key",
            "x-request-id": "merchant-change-reject-1"
          },
          body: JSON.stringify({ action: "reject", reason: "Price change needs revised KYB evidence" })
        });
        const rejectionBody = await rejection.json();
        const auditEvents = await stores.audit.list({ targetId: "atlas-change-reject", limit: 10 });

        expect(rejection.status).toBe(200);
        expect(rejectionBody.request).toMatchObject({
          id: "atlas-change-reject",
          merchantId: "atlas-api",
          status: "rejected",
          reviewer: "merchant-admin",
          reviewReason: "Price change needs revised KYB evidence"
        });
        expect(await stores.merchants.get("atlas-api")).toEqual(originalMerchant);
        expect(await stores.listings.get("atlas-api")).toEqual(originalListing);
        expect(auditEvents.map((event) => event.action)).toEqual(
          expect.arrayContaining(["seller.merchant_change.request", "merchant_change.reject"])
        );
        expect(auditEvents).toContainEqual(
          expect.objectContaining({
            action: "merchant_change.reject",
            actorId: "merchant-admin",
            actorRoles: ["merchant_admin"],
            requestId: "merchant-change-reject-1",
            targetType: "merchant_change_request",
            targetId: "atlas-change-reject",
            metadata: expect.objectContaining({
              merchantId: "atlas-api",
              reason: "Price change needs revised KYB evidence"
            })
          })
        );
      } finally {
        server.close();
      }
    });
  });

  it("ingests indexed session spend records through an admin route", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/indexer/session-spends`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record: sessionSpendRecord() })
      });
      const body = await response.json();
      const listResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/session-spends`);
      const listBody = await listResponse.json();

      expect(response.status).toBe(201);
      expect(body.upserted).toBe(1);
      expect(listResponse.status).toBe(200);
      expect(listBody.records).toHaveLength(1);
      expect(listBody.records[0].sessionId).toBe(`0x${"e".repeat(64)}`);
    } finally {
      server.close();
    }
  });

  it("ingests and lists indexed settlement events through admin routes", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/indexer/settlement-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record: settlementRecord() })
      });
      const body = await response.json();
      const listResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/settlement-events?ledgerId=0x${"9".repeat(64)}`);
      const listBody = await listResponse.json();
      const overviewResponse = await fetch(`${serverBaseUrl(server)}/v1/overview`);
      const overview = await overviewResponse.json();

      expect(response.status).toBe(201);
      expect(body.upserted).toBe(1);
      expect(listResponse.status).toBe(200);
      expect(listBody.records).toHaveLength(1);
      expect(listBody.records[0]).toMatchObject({
        kind: "receipt",
        ledgerId: `0x${"9".repeat(64)}`,
        merchant: MERCHANT
      });
      expect(overview.kpis.indexedSettlementEvents).toBe(1);
    } finally {
      server.close();
    }
  });

  it("stores and retrieves indexer cursors through the indexer route", async () => {
    const app = createConsoleApp(baseConfig, { seed: false });
    const server = app.listen(0);
    const key = `settlement:0x${"f".repeat(64)}:0x2::sui::SUI`;
    const encodedKey = encodeURIComponent(key);

    try {
      const missingResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/cursors/${encodedKey}`);
      const updateResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/cursors/${encodedKey}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cursor: "345425755:0" })
      });
      const updateBody = await updateResponse.json();
      const getResponse = await fetch(`${serverBaseUrl(server)}/v1/indexer/cursors/${encodedKey}`);
      const getBody = await getResponse.json();

      expect(missingResponse.status).toBe(404);
      expect(updateResponse.status).toBe(200);
      expect(updateBody.state).toMatchObject({ key, cursor: "345425755:0" });
      expect(getResponse.status).toBe(200);
      expect(getBody.state).toMatchObject({ key, cursor: "345425755:0" });
    } finally {
      server.close();
    }
  });

  it("persists indexer cursors in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-cursor-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };
    const key = "settlement:testnet:sui";
    const encodedKey = encodeURIComponent(key);

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);
      try {
        const response = await fetch(`${serverBaseUrl(firstServer)}/v1/indexer/cursors/${encodedKey}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cursor: "345425755:1" })
        });
        expect(response.status).toBe(200);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);
      try {
        const response = await fetch(`${serverBaseUrl(secondServer)}/v1/indexer/cursors/${encodedKey}`);
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.state).toMatchObject({ key, cursor: "345425755:1" });
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists indexed session spend records in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-indexer-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(firstServer)}/v1/indexer/session-spends`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ record: sessionSpendRecord() })
        });

        expect(response.status).toBe(201);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(secondServer)}/v1/indexer/sessions`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.sessions).toHaveLength(1);
        expect(body.sessions[0].sessionId).toBe(`0x${"e".repeat(64)}`);
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists indexed settlement events in file storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sui402-console-settlement-indexer-"));
    const filePath = join(directory, "console-store.json");
    const config: ConsoleConfig = {
      ...baseConfig,
      SUI402_CONSOLE_STORAGE_DRIVER: "file",
      SUI402_CONSOLE_FILE_STORE_PATH: filePath
    };

    try {
      const firstApp = createConsoleApp(config, { seed: false });
      const firstServer = firstApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(firstServer)}/v1/indexer/settlement-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ record: settlementRecord() })
        });

        expect(response.status).toBe(201);
      } finally {
        firstServer.close();
      }

      const secondApp = createConsoleApp(config, { seed: false });
      const secondServer = secondApp.listen(0);

      try {
        const response = await fetch(`${serverBaseUrl(secondServer)}/v1/indexer/settlement-events`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.records).toHaveLength(1);
        expect(body.records[0].receiptId).toBe("33".repeat(32));
      } finally {
        secondServer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes payment ledger exports to Walrus and records blob ids", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ newlyCreated: { blobObject: { id: "0xblob", blobId: "blob-123" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_WALRUS_PUBLISHER_URL: "https://publisher.example"
      },
      { fetch: mockFetch }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/exports/payment-ledger/walrus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 2 })
      });
      const body = await response.json();
      const listResponse = await fetch(`${serverBaseUrl(server)}/v1/exports`);
      const listBody = await listResponse.json();

      expect(response.status).toBe(201);
      expect(body.export.blobId).toBe("blob-123");
      expect(body.export.paymentCount).toBe(2);
      expect(body.artifact.kind).toBe("audit-log");
      expect(listBody.exports).toHaveLength(1);
      expect(listBody.exports[0].blobId).toBe("blob-123");
    } finally {
      server.close();
    }
  });

  it("anchors a verified recent audit-chain window to Walrus", async () => {
    let publishedArtifact: Record<string, unknown> | undefined;
    const mockFetch: typeof fetch = async (_input, init) => {
      publishedArtifact = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ newlyCreated: { blobObject: { id: "0xaudit", blobId: "audit-blob" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const stores = createConsoleStores(baseConfig, false);
    const first = createConsoleAuditEvent({
      id: "audit-1",
      action: "merchant_application.submit",
      createdAt: "2026-05-19T00:00:00.000Z"
    });
    const second = createConsoleAuditEvent({
      id: "audit-2",
      action: "merchant_application.approve",
      previousHash: first.hash,
      createdAt: "2026-05-19T00:01:00.000Z"
    });
    const third = createConsoleAuditEvent({
      id: "audit-3",
      action: "merchant.create",
      previousHash: second.hash,
      createdAt: "2026-05-19T00:02:00.000Z"
    });
    await stores.audit.record(first);
    await stores.audit.record(second);
    await stores.audit.record(third);

    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_WALRUS_PUBLISHER_URL: "https://publisher.example"
      },
      { stores, fetch: mockFetch, seed: false }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/exports/audit-head/walrus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 2 })
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.export).toMatchObject({
        kind: "audit-head",
        blobId: "audit-blob",
        paymentCount: 2
      });
      expect(body.verification).toMatchObject({
        ok: true,
        checked: 2,
        firstEventId: "audit-2",
        lastEventId: "audit-3",
        rootPreviousHash: first.hash,
        headHash: third.hash
      });
      expect(publishedArtifact).toMatchObject({
        kind: "audit-log",
        payload: {
          checked: 2,
          rootPreviousHash: first.hash,
          headHash: third.hash
        },
        metadata: {
          exportKind: "audit-head",
          privacy: "hash-boundary-only"
        }
      });
    } finally {
      server.close();
    }
  });

  it("returns settlement summaries and payment drill-down rows", async () => {
    const app = createConsoleApp(baseConfig);
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/settlements?limit=50`);
      const body = await response.json();
      const filteredResponse = await fetch(`${serverBaseUrl(server)}/v1/settlements?merchantId=atlas-api`);
      const filtered = await filteredResponse.json();

      expect(response.status).toBe(200);
      expect(body.summaries.length).toBeGreaterThan(0);
      expect(body.payments.length).toBeGreaterThan(0);
      expect(body.summaries[0]).toMatchObject({
        merchantId: expect.any(String),
        paymentCount: expect.any(Number),
        totalAmount: expect.any(String)
      });
      expect(body.caveats).toEqual(expect.arrayContaining([expect.stringContaining("refund guarantees")]));
      expect(filteredResponse.status).toBe(200);
      expect(filtered.summaries.every((summary: { merchantId: string }) => summary.merchantId === "atlas-api")).toBe(true);
      expect(filtered.payments.every((payment: { merchantId: string }) => payment.merchantId === "atlas-api")).toBe(true);
    } finally {
      server.close();
    }
  });

  it("attaches payment-ledger export context to settlement summaries", async () => {
    const stores = createConsoleStores(baseConfig, true);
    const payments = await stores.payments.listRecent(100);
    const report = buildSettlementReport({
      payments,
      exports: [
        {
          id: "export-1",
          kind: "payment-ledger",
          artifactId: "a".repeat(64),
          artifactKind: "audit-log",
          blobId: "blob-123",
          paymentCount: 2,
          createdAt: "2026-05-20T00:00:00.000Z",
          metadata: {
            merchantId: "atlas-api"
          }
        }
      ],
      query: { merchantId: "atlas-api", limit: 100 }
    });

    expect(report.summaries[0]).toMatchObject({
      merchantId: "atlas-api",
      exportedPaymentCount: 2,
      latestExportBlobId: "blob-123"
    });
    expect(report.caveats).toEqual(expect.arrayContaining([expect.stringContaining("Operational reconciliation only")]));
  });

  it("reconciles signed receipts against indexed settlement events", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const settledPayment = paymentRecordWithReceipt({
      privateKey,
      id: "settled-payment",
      amount: "1000",
      sequence: "1"
    });
    const mismatchedPayment = paymentRecordWithReceipt({
      privateKey,
      id: "mismatched-payment",
      amount: "2000",
      sequence: "2"
    });
    const unsettledPayment = paymentRecordWithReceipt({
      privateKey,
      id: "unsettled-payment",
      amount: "3000",
      sequence: "3"
    });

    const report = buildSettlementReconciliationReport({
      payments: [settledPayment, mismatchedPayment, unsettledPayment],
      settlementEvents: [
        settlementRecordFromPayment(settledPayment, { txDigest: "settled-tx" }),
        settlementRecordFromPayment(mismatchedPayment, { txDigest: "mismatch-tx", amount: "2500" }),
        settlementRecord({ id: "orphaned-tx:0", txDigest: "orphaned-tx", receiptId: "44".repeat(32) })
      ],
      query: { limit: 100 }
    });

    expect(report.summary).toMatchObject({
      receiptPaymentCount: 3,
      indexedReceiptEventCount: 3,
      settledCount: 1,
      unsettledCount: 1,
      mismatchedCount: 1,
      orphanedEventCount: 1,
      settledAmount: "1000",
      unsettledAmount: "3000"
    });
    expect(report.caveats).toEqual(expect.arrayContaining([expect.stringContaining("legal settlement finality")]));
    expect(report.rows.map((row) => row.status)).toEqual(["mismatched", "unsettled", "orphaned", "settled"]);
    expect(report.rows[0]).toMatchObject({
      status: "mismatched",
      receiptId: mismatchedPayment.receipt?.receipt.id,
      mismatchReasons: ["amount"]
    });
  });

  it("returns settlement reconciliation through the console API", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const stores = createConsoleStores(baseConfig, false);
    const payment = paymentRecordWithReceipt({
      privateKey,
      id: "api-settled-payment",
      amount: "1000",
      sequence: "1"
    });
    await stores.payments.record(payment);
    await stores.settlementEvents.upsert(settlementRecordFromPayment(payment));

    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/settlement-reconciliation?limit=100`);
      const body = await response.json();
      const overviewResponse = await fetch(`${serverBaseUrl(server)}/v1/overview`);
      const overview = await overviewResponse.json();

      expect(response.status).toBe(200);
      expect(body.caveats).toEqual(expect.arrayContaining([expect.stringContaining("external audit")]));
      expect(body.summary).toMatchObject({
        receiptPaymentCount: 1,
        indexedReceiptEventCount: 1,
        settledCount: 1,
        unsettledCount: 0
      });
      expect(body.rows[0]).toMatchObject({
        status: "settled",
        receiptId: payment.receipt?.receipt.id,
        paymentId: "api-settled-payment"
      });
      expect(overview.settlementReconciliation).toMatchObject({
        settledCount: 1,
        indexedReceiptEventCount: 1
      });
      expect(overview.settlementCaveats).toEqual(expect.arrayContaining([expect.stringContaining("refund guarantees")]));
    } finally {
      server.close();
    }
  });

  it("publishes signed receipt bundle exports to Walrus", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const stores = createConsoleStores(baseConfig, false);
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z",
      metadata: { merchantId: "merchant-api" }
    });
    const receipt = signSpendReceipt({
      receipt: createSpendReceipt(
        {
          network: "sui:testnet",
          sessionId: `0x${"e".repeat(64)}`,
          payer: `0x${"b".repeat(64)}`,
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          amount: "1000",
          resource: "api:*",
          sequence: "1",
          issuedAt: "2026-05-19T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z"
        },
        "nonce-with-enough-entropy"
      ),
      signer: MERCHANT,
      privateKey
    });
    await stores.payments.record({
      id: "payment-with-receipt",
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: receipt.receipt.sessionId,
        network: "sui:testnet",
        txDigest: "digest-with-receipt",
        spentAt: "2026-05-19T00:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest-with-receipt",
        sessionId: receipt.receipt.sessionId,
        recipient: MERCHANT,
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      receipt,
      resource: "api:*",
      createdAt: "2026-05-19T00:00:00.000Z"
    });

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ newlyCreated: { blobObject: { id: "0xreceipt", blobId: "receipt-blob" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const app = createConsoleApp(
      {
        ...baseConfig,
        SUI402_WALRUS_PUBLISHER_URL: "https://publisher.example"
      },
      { stores, fetch: mockFetch, seed: false }
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/v1/exports/receipts/walrus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId: "merchant-api" })
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.export.kind).toBe("receipt-bundle");
      expect(body.export.blobId).toBe("receipt-blob");
      expect(body.artifact.kind).toBe("receipt-bundle");
    } finally {
      server.close();
    }
  });

  it("serves export detail and downloadable settlement reconciliation CSV", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const stores = createConsoleStores(baseConfig, false);
    await stores.payments.record(
      paymentRecordWithReceipt({
        privateKey,
        id: "downloadable-payment",
        amount: "1000",
        sequence: "1",
        merchantId: "merchant-api"
      })
    );
    await stores.exports.record({
      id: "export-detail-id",
      kind: "payment-ledger",
      artifactId: "c".repeat(64),
      artifactKind: "audit-log",
      blobId: "blob-export-detail",
      paymentCount: 1,
      createdAt: "2026-05-19T00:00:00.000Z"
    });

    const app = createConsoleApp(baseConfig, { stores, seed: false });
    const server = app.listen(0);

    try {
      const base = serverBaseUrl(server);
      const exportDetail = await fetch(`${base}/v1/exports/export-detail-id`);
      const reconciliationCsv = await fetch(`${base}/v1/settlement-reconciliation.csv?merchantId=merchant-api`);

      expect(exportDetail.status).toBe(200);
      expect(await exportDetail.json()).toMatchObject({
        export: { id: "export-detail-id", blobId: "blob-export-detail" }
      });
      expect(reconciliationCsv.status).toBe(200);
      expect(reconciliationCsv.headers.get("content-type")).toContain("text/csv");
      expect(await reconciliationCsv.text()).toContain("downloadable-payment");
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

async function runPayCli(args: string[], marketplaceUrl: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [payCliPath, ...args], {
    env: {
      ...process.env,
      SUI402_MARKETPLACE_URL: marketplaceUrl,
      SUI402_CONSOLE_API_URL: marketplaceUrl,
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: "",
      SUI_CLIENT_CONFIG: join(tmpdir(), "sui402-console-test-missing-client.yaml"),
      SUI_KEYSTORE_PATH: join(tmpdir(), "sui402-console-test-missing.keystore")
    }
  });
}

function paymentRecordWithReceipt(input: {
  privateKey: KeyObject;
  id: string;
  amount: string;
  sequence: string;
  merchantId?: string;
  resource?: string;
  network?: PaymentRecord["proof"]["network"];
  recipient?: string;
  coinType?: string;
}): PaymentRecord {
  const network = input.network ?? "sui:testnet";
  const recipient = input.recipient ?? MERCHANT;
  const coinType = input.coinType ?? "0x2::sui::SUI";
  const resource = input.resource ?? "api:*";
  const challenge = createChallenge({
    network,
    recipient,
    coinType,
    amount: input.amount,
    resource,
    expiresAt: "2099-01-01T00:00:00.000Z",
    metadata: { merchantId: input.merchantId ?? "merchant-api" }
  });
  const receipt = signSpendReceipt({
    receipt: createSpendReceipt(
      {
        network,
        sessionId: `0x${"e".repeat(64)}`,
        payer: `0x${"b".repeat(64)}`,
        merchant: recipient,
        coinType,
        amount: input.amount,
        resource,
        sequence: input.sequence,
        issuedAt: "2026-05-19T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      `nonce-${input.id}-with-enough-entropy`
    ),
    signer: MERCHANT,
    privateKey: input.privateKey
  });

  return {
    id: input.id,
    challenge,
    proof: {
      version: "sui402-0.1",
      kind: "session",
      challengeId: challenge.id,
      sessionId: receipt.receipt.sessionId,
      network,
      txDigest: `${input.id}-digest`,
      spentAt: "2026-05-19T00:00:00.000Z"
    },
    verification: {
      ok: true,
      digest: `${input.id}-digest`,
      sessionId: receipt.receipt.sessionId,
      recipient,
      amount: input.amount,
      coinType
    },
    receipt,
    resource,
    createdAt: "2026-05-19T00:00:00.000Z"
  };
}

function publisherWalletProofMessage(input: {
  applicationId: string;
  merchantId: string;
  payoutWallet: string;
  network: string;
  coinType: string;
  price: string;
  resourceScope: string;
  upstreamUrl?: string;
}): string {
  return [
    "Sui402 publisher payout wallet proof",
    `applicationId=${input.applicationId}`,
    `merchantId=${input.merchantId}`,
    `payoutWallet=${input.payoutWallet}`,
    `network=${input.network}`,
    `coinType=${input.coinType}`,
    `price=${input.price}`,
    `resourceScope=${input.resourceScope}`,
    `upstreamUrl=${input.upstreamUrl ?? "none"}`
  ].join("\n");
}

function scanPaymentRecord(input: {
  id: string;
  txDigest: string;
  createdAt: string;
  network?: PaymentRecord["proof"]["network"];
}): PaymentRecord {
  const network = input.network ?? "sui:testnet";
  const challenge = createChallenge({
    network,
    recipient: MERCHANT,
    coinType: "0x2::sui::SUI",
    amount: "1000",
    resource: "api:*",
    expiresAt: "2099-01-01T00:00:00.000Z",
    metadata: { merchantId: "scan-api" }
  });

  return {
    id: input.id,
    challenge,
    proof: {
      version: "sui402-0.1",
      kind: "one-shot",
      challengeId: challenge.id,
      network,
      txDigest: input.txDigest,
      paidAt: input.createdAt
    },
    verification: {
      ok: true,
      digest: input.txDigest,
      recipient: MERCHANT,
      amount: "1000",
      coinType: "0x2::sui::SUI"
    },
    resource: "api:*",
    createdAt: input.createdAt
  };
}

function settlementRecordFromPayment(
  payment: PaymentRecord,
  overrides: Partial<SettlementRecord> = {}
): SettlementRecord {
  const receipt = payment.receipt?.receipt;
  if (!receipt) {
    throw new Error("Expected test payment receipt");
  }

  return settlementRecord({
    id: `${overrides.txDigest ?? `${payment.id}-settlement-digest`}:0`,
    txDigest: overrides.txDigest ?? `${payment.id}-settlement-digest`,
    receiptId: receipt.id,
    payer: receipt.payer,
    merchant: receipt.merchant,
    signer: payment.receipt?.signer,
    amount: receipt.amount,
    sequence: receipt.sequence,
    resourceScopeHash: receipt.resourceScopeHash,
    ...overrides
  });
}

function signJwt(input: {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  privateKey: KeyObject;
}): string {
  const encodedHeader = base64UrlEncode(JSON.stringify(input.header));
  const encodedClaims = base64UrlEncode(JSON.stringify(input.claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function assertPublicSurfacePolicy(surface: string, value: unknown): void {
  expect(collectPublicSurfacePolicyViolations(value), `${surface} violated the public field policy`).toEqual([]);
}

function collectPublicSurfacePolicyViolations(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectPublicSurfacePolicyViolations(item, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const violations: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = `${path}.${key}`;
    const normalized = key.toLowerCase();
    const isIdentityRedactionLabel = path.endsWith(".identityRedaction");
    if (PUBLIC_SURFACE_FORBIDDEN_KEYS_NORMALIZED.has(normalized)) {
      violations.push(`forbidden:${fieldPath}`);
      continue;
    }
    if (PUBLIC_SURFACE_FORBIDDEN_RAW_IDENTITY_KEYS.has(normalized) && !isIdentityRedactionLabel) {
      violations.push(`forbidden:${fieldPath}`);
      continue;
    }
    if (isPublicSurfaceLeaf(child) && !isAllowedPublicSurfaceLeafPath(fieldPath)) {
      violations.push(`unknown:${fieldPath}`);
      continue;
    }
    violations.push(...collectPublicSurfacePolicyViolations(child, fieldPath));
  }

  return violations;
}

function isPublicSurfaceLeaf(value: unknown): boolean {
  return !Array.isArray(value) && (!value || typeof value !== "object");
}

function isAllowedPublicSurfaceLeafPath(path: string): boolean {
  const normalizedPath = path.replace(/\[\d+\]/g, "[]");
  return PUBLIC_SURFACE_ALLOWED_LEAF_PATHS.some((pattern) => pattern.test(normalizedPath));
}

function sessionSpendRecord(overrides: Partial<SessionSpendRecord> = {}): SessionSpendRecord {
  return {
    id: "digest-1:0",
    network: "sui:testnet",
    packageId: `0x${"1".repeat(64)}`,
    coinType: "0x2::sui::SUI",
    txDigest: "digest-1",
    eventSeq: "0",
    sessionId: `0x${"e".repeat(64)}`,
    payer: `0x${"b".repeat(64)}`,
    merchant: MERCHANT,
    amount: "1000",
    spentTotal: "1000",
    challengeId: "challenge-id",
    resourceScopeHash: "resource-scope-hash",
    sender: `0x${"b".repeat(64)}`,
    timestampMs: "1780000000000",
    indexedAt: "2026-05-19T00:00:00.000Z",
    ...overrides
  };
}

function settlementRecord(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: "settlement-digest-1:0",
    network: "sui:testnet",
    packageId: `0x${"1".repeat(64)}`,
    coinType: "0x2::sui::SUI",
    txDigest: "settlement-digest-1",
    eventSeq: "0",
    kind: "receipt",
    ledgerId: `0x${"9".repeat(64)}`,
    receiptId: "33".repeat(32),
    payer: `0x${"b".repeat(64)}`,
    merchant: MERCHANT,
    signer: `0x${"c".repeat(64)}`,
    amount: "1000",
    sequence: "1",
    resourceScopeHash: "22".repeat(32),
    submitter: `0x${"b".repeat(64)}`,
    sender: `0x${"b".repeat(64)}`,
    timestampMs: "1780000000000",
    indexedAt: "2026-05-19T00:00:00.000Z",
    ...overrides
  };
}
