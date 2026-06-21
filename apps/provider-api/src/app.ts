import { createPrivateKey } from "node:crypto";
import express from "express";
import { SUI402_VERSION, resourceScopeHash, type Sui402ProviderManifest } from "@sui402/protocol";
import { createSessionSpendReceiptIssuer, type ReceiptSequenceStore, type SpendReceiptSigner } from "@sui402/receipts";
import {
  createHttpMetrics,
  createSui402SessionRouter,
  requireSuiPayment,
  type ChallengeStore,
  type PaymentRecordStore
} from "@sui402/server";
import { Sui402Verifier } from "@sui402/sui";
import type { ProviderConfig } from "./config.js";
import { createAdminRouter } from "./admin.js";
import { createJsonLogger, requestContext, securityHeaders, type Logger } from "./observability.js";
import { rateLimit, type RateLimiter } from "./rate-limit.js";

export type ProviderAppOptions = {
  challengeStore?: ChallengeStore;
  paymentRecords?: PaymentRecordStore;
  receiptSequenceStore?: ReceiptSequenceStore;
  receiptSigner?: SpendReceiptSigner;
  rateLimiter?: RateLimiter;
  logger?: Logger;
  readinessChecks?: Record<string, () => Promise<void> | void>;
};

export function createProviderApp(config: ProviderConfig, options: ProviderAppOptions = {}): express.Express {
  const app = express();
  const verifier = new Sui402Verifier({
    network: config.SUI402_NETWORK,
    grpcUrl: config.SUI402_GRPC_URL,
    sessionPackageId: config.SUI402_SESSION_PACKAGE_ID
  });
  const scopeHash = resourceScopeHash(config.SUI402_RESOURCE_SCOPE);
  const logger = options.logger ?? createJsonLogger(config.SUI402_SERVICE_NAME);
  const receiptIssuer = createProviderReceiptIssuer(config, options.receiptSequenceStore, options.receiptSigner);
  const metrics = createHttpMetrics(config.SUI402_SERVICE_NAME);

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(securityHeaders());
  app.use(requestContext(logger));
  app.use(metrics.middleware);
  app.use(
    rateLimit({
      windowMs: config.SUI402_RATE_LIMIT_WINDOW_MS,
      maxRequests: config.SUI402_RATE_LIMIT_MAX_REQUESTS,
      limiter: options.rateLimiter
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health/live", (_req, res) => {
    res.json({
      ok: true,
      service: config.SUI402_SERVICE_NAME
    });
  });

  app.get("/health/ready", async (_req, res) => {
    const dependencies = await runReadinessChecks(options.readinessChecks);
    const ok = Object.values(dependencies).every((dependency) => dependency.ok);
    res.status(ok ? 200 : 503).json({
      ok,
      network: config.SUI402_NETWORK,
      merchant: config.SUI402_MERCHANT_ADDRESS,
      coinType: config.SUI402_COIN_TYPE,
      sessionsEnabled: Boolean(config.SUI402_SESSION_PACKAGE_ID),
      adminEnabled: Boolean(config.SUI402_ADMIN_API_KEY),
      receiptsEnabled: Boolean(receiptIssuer),
      receiptSignerProvider: receiptIssuer ? config.SUI402_RECEIPT_SIGNER_PROVIDER : undefined,
      durableChallenges: Boolean(options.challengeStore),
      durablePaymentRecords: Boolean(options.paymentRecords),
      durableReceiptSequences: Boolean(options.receiptSequenceStore),
      distributedRateLimit: Boolean(options.rateLimiter),
      dependencies
    });
  });

  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render());
  });

  app.get("/.well-known/sui402", (_req, res) => {
    const sessionsEnabled = Boolean(config.SUI402_SESSION_PACKAGE_ID);
    const manifest: Sui402ProviderManifest = {
      version: SUI402_VERSION,
      service: config.SUI402_SERVICE_NAME,
      network: config.SUI402_NETWORK,
      merchant: config.SUI402_MERCHANT_ADDRESS,
      coinType: config.SUI402_COIN_TYPE,
      price: config.SUI402_PRICE,
      resourceScope: config.SUI402_RESOURCE_SCOPE,
      resourceScopeHash: scopeHash,
      payments: {
        kinds: sessionsEnabled ? ["one-shot", "session"] : ["one-shot"],
        challengeTtlSeconds: config.SUI402_CHALLENGE_TTL_SECONDS
      },
      sessions: {
        enabled: sessionsEnabled,
        packageId: config.SUI402_SESSION_PACKAGE_ID,
        managerPath: sessionsEnabled ? "/sui402" : undefined
      },
      endpoints: {
        wellKnown: "/.well-known/sui402",
        protectedResource: "/v1/entitlements/current",
        sessionManager: sessionsEnabled ? "/sui402" : undefined
      }
    };

    res.json(manifest);
  });

  if (config.SUI402_SESSION_PACKAGE_ID) {
    app.use(
      "/sui402",
      createSui402SessionRouter({
        network: config.SUI402_NETWORK,
        packageId: config.SUI402_SESSION_PACKAGE_ID,
        merchant: config.SUI402_MERCHANT_ADDRESS,
        coinType: config.SUI402_COIN_TYPE,
        resourceScopeHash: scopeHash
      })
    );
  }

  if (config.SUI402_ADMIN_API_KEY) {
    app.use(
      "/admin",
      createAdminRouter({
        apiKey: config.SUI402_ADMIN_API_KEY,
        paymentRecords: options.paymentRecords,
        maxPayments: config.SUI402_ADMIN_MAX_PAYMENTS
      })
    );
  }

  app.get(
    "/v1/entitlements/current",
    requireSuiPayment({
      network: config.SUI402_NETWORK,
      recipient: config.SUI402_MERCHANT_ADDRESS,
      coinType: config.SUI402_COIN_TYPE,
      amount: config.SUI402_PRICE,
      description: "Sui402 protected entitlement",
      ttlSeconds: config.SUI402_CHALLENGE_TTL_SECONDS,
      store: options.challengeStore,
      records: options.paymentRecords,
      receiptIssuer,
      verifier,
      resource: () => config.SUI402_RESOURCE_SCOPE
    }),
    (_req, res) => {
      res.json({
        entitled: true,
        resourceScope: config.SUI402_RESOURCE_SCOPE,
        verifiedAt: new Date().toISOString(),
        payment: res.locals.sui402?.verification
      });
    }
  );

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    logger.log("error", "unhandled_error", {
      requestId: res.locals.requestId,
      message,
      stack: err instanceof Error ? err.stack : undefined
    });
    res.status(500).json({
      error: "internal_server_error",
      message,
      requestId: res.locals.requestId
    });
  });

  return app;
}

async function runReadinessChecks(
  checks: Record<string, () => Promise<void> | void> = {}
): Promise<Record<string, { ok: boolean; error?: string }>> {
  const results = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        await check();
        return [name, { ok: true }] as const;
      } catch (error) {
        return [name, { ok: false, error: error instanceof Error ? error.message : "Dependency check failed" }] as const;
      }
    })
  );
  return Object.fromEntries(results);
}

function createProviderReceiptIssuer(
  config: ProviderConfig,
  sequenceStore?: ReceiptSequenceStore,
  receiptSigner?: SpendReceiptSigner
) {
  if (!config.SUI402_RECEIPT_SIGNER_ID) {
    return undefined;
  }

  if (config.SUI402_RECEIPT_SIGNER_PROVIDER === "external") {
    if (!receiptSigner) {
      throw new Error("External receipt signing requires ProviderAppOptions.receiptSigner");
    }

    return createSessionSpendReceiptIssuer({
      signer: config.SUI402_RECEIPT_SIGNER_ID,
      receiptSigner,
      sequenceStore,
      ttlSeconds: config.SUI402_RECEIPT_TTL_SECONDS,
      metadata: ({ challenge, proof }) => ({
        challengeId: challenge.id,
        txDigest: proof.txDigest,
        service: config.SUI402_SERVICE_NAME
      })
    });
  }

  const privateKeyPem = config.SUI402_RECEIPT_PRIVATE_KEY_PEM ?? decodePemBase64(config.SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64);
  if (!privateKeyPem) {
    return undefined;
  }

  const privateKey = createPrivateKey(privateKeyPem);
  return createSessionSpendReceiptIssuer({
    signer: config.SUI402_RECEIPT_SIGNER_ID,
    privateKey,
    sequenceStore,
    ttlSeconds: config.SUI402_RECEIPT_TTL_SECONDS,
    metadata: ({ challenge, proof }) => ({
      challengeId: challenge.id,
      txDigest: proof.txDigest,
      service: config.SUI402_SERVICE_NAME
    })
  });
}

function decodePemBase64(value: string | undefined): string | undefined {
  return value ? Buffer.from(value, "base64").toString("utf8") : undefined;
}
