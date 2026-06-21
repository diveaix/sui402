import { createHash, createHmac, createPrivateKey, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import express from "express";
import { Pool } from "pg";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { z } from "zod";
import {
  MemoryMerchantStore,
  assertSafeUpstreamUrl,
  createGatewayManifest,
  createGatewayMerchantConfig,
  createGatewayRouter,
  type GatewayMerchantConfig,
  type MerchantStore
} from "@sui402/gateway";
import {
  type ListingStore,
  MemoryListingStore,
  createListingFromManifest,
  createRegistryRouter,
  type Sui402ServiceListing
} from "@sui402/registry";
import {
  MemoryChallengeStore,
  MemoryPaymentRecordStore,
  createHttpMetrics,
  type ChallengeStore,
  type PaymentRecord,
  type PaymentReceiptIssuer,
  type PaymentRecordStore
} from "@sui402/server";
import { Sui402SpendingPolicySchema } from "@sui402/policy";
import {
  MemoryReceiptSequenceStore,
  createSessionSpendReceiptIssuer,
  type ReceiptSequenceStore,
  type SpendReceiptSigner
} from "@sui402/receipts";
import {
  MemorySessionSpendIndexStore,
  MemorySettlementIndexStore,
  MemoryIndexerCursorStore,
  aggregateSessionSpends,
  type IndexerCursorStore,
  type SessionSpendIndexStore,
  type SessionSpendRecord,
  type SettlementIndexStore,
  type SettlementRecord
} from "@sui402/indexer";
import { createReceiptBundleArtifact, createWalrusArtifact, publishWalrusArtifact } from "@sui402/walrus";
import { Sui402Verifier } from "@sui402/sui";
import { Sui402NetworkSchema, createChallenge, resourceScopeHash, type Sui402Network } from "@sui402/protocol";
import {
  ConsoleAuditEventQuerySchema,
  MemoryConsoleAuditLogStore,
  createChainedConsoleAuditEvent,
  createConsoleAuditEvent,
  verifyAuditHashChain,
  type ConsoleAuditAction,
  type ConsoleAuditEvent,
  type ConsoleAuditLogStore
} from "./audit.js";
import type { ConsoleConfig } from "./config.js";
import { requireConsoleRole, requireSellerRole, type ConsoleRole, type ConsoleSellerRole } from "./auth.js";
import { MemoryArtifactExportStore, type ArtifactExportStore } from "./exports.js";
import { createJsonFileConsoleStoreBundle } from "./file-store.js";
import {
  MemoryMerchantApplicationStore,
  MerchantApplicationReviewSchema,
  MerchantApplicationSubmitSchema,
  MerchantApplicationVerificationSchema,
  PublisherApiDraftSchema,
  PublisherOpenApiEndpointSchema,
  PublisherOpenApiPreviewSchema,
  buildPublisherOpenApiPreview,
  canonicalUrl,
  createMerchantApplication,
  hasPublisherOpenApiSelection,
  merchantApplicationNextSteps,
  publisherApiDraftPreview,
  publisherApiDraftToMerchantApplicationSubmit,
  reviewMerchantApplication,
  rotateMerchantApplicationPublisherAccessToken,
  selectPublisherOpenApiEndpoint,
  type MerchantApplication,
  type MerchantApplicationVerification,
  type MerchantApplicationStore,
  type PublisherApiDraft,
  type PublisherOpenApiEndpoint,
  type PublisherOpenApiPreview,
  type PublisherReviewConfigDraft
} from "./onboarding.js";
import {
  MemoryMerchantChangeRequestStore,
  MerchantChangeRequestReviewSchema,
  MerchantChangeRequestSubmitSchema,
  createMerchantChangeRequest,
  reviewMerchantChangeRequest,
  type MerchantChangeRequest,
  type MerchantChangeRequestStore
} from "./merchant-change-requests.js";
import { createPostgresConsoleStoreBundle } from "./postgres-store.js";
import { seedListings, seedMerchants, seedPayments } from "./seed.js";
import {
  SETTLEMENT_OPERATIONAL_CAVEATS,
  SettlementQuerySchema,
  buildSettlementReconciliationReport,
  buildSettlementReport,
  settlementReconciliationToCsv,
  settlementReportToCsv,
  type SettlementReconciliationSummary,
  type SettlementSummary
} from "./settlements.js";
import { MemoryWindowRateLimitStore, type WindowRateLimitStore } from "./rate-limit.js";

export type ConsoleStores = {
  merchants: MerchantStore & { list(): Promise<GatewayMerchantConfig[]> | GatewayMerchantConfig[] };
  listings: ListingStore;
  payments: PaymentRecordStore & { listRecent(limit?: number): Promise<PaymentRecord[]> | PaymentRecord[] };
  challenges: ChallengeStore;
  sessionSpends: SessionSpendIndexStore;
  settlementEvents: SettlementIndexStore;
  indexerCursors: IndexerCursorStore;
  exports: ArtifactExportStore;
  merchantApplications: MerchantApplicationStore;
  merchantChangeRequests: MerchantChangeRequestStore;
  audit: ConsoleAuditLogStore;
  publicIntakeRateLimits?: WindowRateLimitStore;
  checkReady?: () => Promise<void>;
  close?: () => Promise<void>;
};

type ScanPaymentRecordStore = PaymentRecordStore & {
  getByTxDigest?: (txDigest: string, network?: Sui402Network) => Promise<PaymentRecord | undefined> | PaymentRecord | undefined;
};

type ScanSettlementIndexStore = SettlementIndexStore & {
  getByIdentifier?: (identifier: string) => Promise<SettlementRecord | undefined> | SettlementRecord | undefined;
};

export type ConsoleOverview = {
  mode: "seeded" | "live";
  kpis: {
    verifiedPayments: number;
    activeMerchants: number;
    sessionVolume: number;
    indexedSessionSpends: number;
    indexedSessions: number;
    indexedSettlementEvents: number;
  };
  payments: Array<{
    merchant: string;
    resource: string;
    network: string;
    amount: string;
    status: "verified" | "session" | "review";
    digest: string;
  }>;
  readiness: Array<{
    label: string;
    value: string;
    status: "ready" | "warn" | "active";
  }>;
  merchants: GatewayMerchantConfig[];
  listings: Sui402ServiceListing[];
  exports: Awaited<ReturnType<ArtifactExportStore["list"]>>;
  merchantApplications: Array<ReturnType<typeof merchantApplicationView>>;
  merchantChangeRequests: MerchantChangeRequest[];
  settlements: SettlementSummary[];
  settlementCaveats: string[];
  settlementReconciliation: SettlementReconciliationSummary;
  auditEvents: ConsoleAuditEvent[];
};

export type ConsoleAppOptions = {
  stores?: ConsoleStores;
  seed?: boolean;
  fetch?: typeof fetch;
  resolveTxt?: (hostname: string) => Promise<string[][]>;
  receiptSequenceStore?: ReceiptSequenceStore;
  receiptSigner?: SpendReceiptSigner;
};

const MerchantCreateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  service: z.string().min(1),
  merchant: z.string().min(1),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).default("sui:testnet"),
  coinType: z.string().min(1),
  price: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  upstreamUrl: z.string().url().optional(),
  upstreamTimeoutMs: z.number().int().positive().max(120_000).default(15_000),
  sessionPackageId: z.string().min(1).optional(),
  paymentPolicy: Sui402SpendingPolicySchema.optional(),
  transport: z.enum(["http", "mcp"]).default("http")
});

const SellerMerchantUpdateSchema = z
  .object({
    service: z.string().min(1).optional(),
    price: z.string().regex(/^\d+$/).optional(),
    resourceScope: z.string().min(1).optional(),
    upstreamUrl: z.string().url().nullable().optional(),
    upstreamTimeoutMs: z.number().int().positive().max(120_000).optional(),
    sessionPackageId: z.string().min(1).nullable().optional(),
    status: z.enum(["active", "paused"]).optional()
  })
  .strict();

const MerchantApplicationQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const MerchantChangeRequestQuerySchema = z.object({
  merchantId: z.string().min(1).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const PublisherVerificationDocumentSchema = z.object({
  sui402: z.literal("publisher-verification-v1"),
  applicationId: z.string().min(1),
  merchantId: z.string().min(1),
  upstreamUrl: z.string().url(),
  token: z.string().min(16).optional(),
  verificationToken: z.string().min(16).optional()
});

const PublisherWalletProofSubmitSchema = z
  .object({
    message: z.string().min(1).max(4000),
    signature: z.string().min(1).max(2000)
  })
  .strict();

const PublisherWalletProofEvidenceSchema = z
  .object({
    schemaVersion: z.literal("sui402.publisher-wallet-proof.v1"),
    status: z.literal("verified"),
    method: z.literal("sui-personal-message"),
    address: z.string().min(1),
    messageHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    signatureHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    applicationId: z.string().min(1),
    merchantId: z.string().min(1),
    network: z.string().min(1),
    coinType: z.string().min(1),
    price: z.string().min(1),
    resourceScope: z.string().min(1),
    upstreamUrl: z.string().url().optional(),
    verifiedAt: z.string().datetime()
  })
  .strict();

const PublisherSessionCreateSchema = z
  .object({
    ttlSeconds: z.coerce.number().int().positive().max(3600).default(900)
  })
  .strict();

const PublicMarketplaceQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).optional(),
  transport: z.enum(["http", "mcp"]).optional(),
  tag: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

const AuditVerificationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const PaymentLedgerExportSchema = z.object({
  publisherUrl: z.string().url().optional(),
  epochs: z.number().int().positive().optional(),
  merchantId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).default(100)
});

const ReceiptBundleExportSchema = PaymentLedgerExportSchema;
const AuditHeadExportSchema = z.object({
  publisherUrl: z.string().url().optional(),
  epochs: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).default(500)
});

const SessionSpendQuerySchema = z.object({
  sessionId: z.string().min(1).optional(),
  payer: z.string().min(1).optional(),
  merchant: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const SessionSpendRecordSchema = z.object({
  id: z.string().min(1),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]),
  packageId: z.string().min(1),
  coinType: z.string().min(1),
  txDigest: z.string().min(1),
  eventSeq: z.string().optional(),
  sessionId: z.string().min(1),
  payer: z.string().min(1).optional(),
  merchant: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  spentTotal: z.string().regex(/^\d+$/).optional(),
  challengeId: z.string().min(1),
  resourceScopeHash: z.string().min(1),
  sender: z.string().min(1).optional(),
  timestampMs: z.string().regex(/^\d+$/).optional(),
  indexedAt: z.string().datetime()
}) satisfies z.ZodType<SessionSpendRecord>;

const SettlementEventQuerySchema = z.object({
  kind: z.enum(["receipt", "batch"]).optional(),
  ledgerId: z.string().min(1).optional(),
  merchant: z.string().min(1).optional(),
  submitter: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const SettlementRecordSchema = z.object({
  id: z.string().min(1),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]),
  packageId: z.string().min(1),
  coinType: z.string().min(1),
  txDigest: z.string().min(1),
  eventSeq: z.string().optional(),
  kind: z.enum(["receipt", "batch"]),
  ledgerId: z.string().min(1),
  receiptId: z.string().min(1).optional(),
  payer: z.string().min(1).optional(),
  merchant: z.string().min(1),
  signer: z.string().min(1).optional(),
  amount: z.string().regex(/^\d+$/).optional(),
  sequence: z.string().regex(/^\d+$/).optional(),
  resourceScopeHash: z.string().min(1).optional(),
  submitter: z.string().min(1),
  receiptCount: z.string().regex(/^\d+$/).optional(),
  totalAmount: z.string().regex(/^\d+$/).optional(),
  sender: z.string().min(1).optional(),
  timestampMs: z.string().regex(/^\d+$/).optional(),
  indexedAt: z.string().datetime()
}) satisfies z.ZodType<SettlementRecord>;

const SettlementEventIngestSchema = z
  .object({
    record: SettlementRecordSchema.optional(),
    records: z.array(SettlementRecordSchema).max(1000).optional()
  })
  .refine((value) => value.record || (value.records && value.records.length > 0), {
    message: "Provide record or records"
  });

const SessionSpendIngestSchema = z
  .object({
    record: SessionSpendRecordSchema.optional(),
    records: z.array(SessionSpendRecordSchema).max(1000).optional()
  })
  .refine((value) => value.record || (value.records && value.records.length > 0), {
    message: "Provide record or records"
  });

const IndexerCursorUpdateSchema = z.object({
  cursor: z.string().optional()
});

export function createConsoleStores(config: ConsoleConfig, seed = true): ConsoleStores {
  if (config.SUI402_CONSOLE_STORAGE_DRIVER === "postgres") {
    if (!config.SUI402_CONSOLE_POSTGRES_URL) {
      throw new Error("Postgres console storage requires SUI402_CONSOLE_POSTGRES_URL");
    }

    const pool = new Pool({ connectionString: config.SUI402_CONSOLE_POSTGRES_URL });
    const bundle = createPostgresConsoleStoreBundle({
      client: pool,
      merchantTableName: config.SUI402_CONSOLE_MERCHANT_TABLE,
      listingTableName: config.SUI402_CONSOLE_LISTING_TABLE,
      challengeTableName: config.SUI402_CONSOLE_CHALLENGE_TABLE,
      consumedChallengeTableName: config.SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE,
      paymentRecordTableName: config.SUI402_CONSOLE_PAYMENT_RECORD_TABLE,
      sessionSpendTableName: config.SUI402_CONSOLE_SESSION_SPEND_TABLE,
      settlementEventTableName: config.SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE,
      indexerCursorTableName: config.SUI402_CONSOLE_INDEXER_CURSOR_TABLE,
      exportTableName: config.SUI402_CONSOLE_EXPORT_TABLE,
      merchantApplicationTableName: config.SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE,
      merchantChangeRequestTableName: config.SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE,
      auditTableName: config.SUI402_CONSOLE_AUDIT_TABLE,
      rateLimitTableName: config.SUI402_CONSOLE_RATE_LIMIT_TABLE
    });
    return {
      merchants: bundle.merchants,
      listings: bundle.listings,
      payments: bundle.payments,
      challenges: bundle.challenges,
      sessionSpends: bundle.sessionSpends,
      settlementEvents: bundle.settlementEvents,
      indexerCursors: bundle.indexerCursors,
      exports: bundle.exports,
      merchantApplications: bundle.merchantApplications,
      merchantChangeRequests: bundle.merchantChangeRequests,
      audit: bundle.audit,
      publicIntakeRateLimits: bundle.rateLimits,
      checkReady: async () => {
        await pool.query("select 1");
      },
      close: async () => {
        await pool.end();
      }
    };
  }

  const fileBundle =
    config.SUI402_CONSOLE_STORAGE_DRIVER === "file"
      ? createJsonFileConsoleStoreBundle(config.SUI402_CONSOLE_FILE_STORE_PATH)
      : undefined;
  const stores: ConsoleStores = fileBundle
    ? {
        merchants: fileBundle.merchants,
        listings: fileBundle.listings,
        payments: fileBundle.payments,
        challenges: fileBundle.challenges,
        sessionSpends: fileBundle.sessionSpends,
        settlementEvents: fileBundle.settlementEvents,
        indexerCursors: fileBundle.indexerCursors,
        exports: fileBundle.exports,
        merchantApplications: fileBundle.merchantApplications,
        merchantChangeRequests: fileBundle.merchantChangeRequests,
        audit: fileBundle.audit
      }
    : {
        merchants: new MemoryMerchantStore(),
        listings: new MemoryListingStore(),
        payments: new MemoryPaymentRecordStore(),
        challenges: new MemoryChallengeStore(),
        sessionSpends: new MemorySessionSpendIndexStore(),
        settlementEvents: new MemorySettlementIndexStore(),
        indexerCursors: new MemoryIndexerCursorStore(),
        exports: new MemoryArtifactExportStore(),
        merchantApplications: new MemoryMerchantApplicationStore(),
        merchantChangeRequests: new MemoryMerchantChangeRequestStore(),
        audit: new MemoryConsoleAuditLogStore()
      };

  if (seed && (!fileBundle || fileBundle.state.isEmpty())) {
    const merchants = seedMerchants();
    for (const merchant of merchants) {
      stores.merchants.upsert(merchant);
    }

    for (const listing of seedListings(config.SUI402_CONSOLE_PROVIDER_BASE_URL, merchants)) {
      stores.listings.upsert(listing);
    }

    for (const payment of seedPayments()) {
      stores.payments.record(payment);
    }
  }

  return stores;
}

export async function createConfiguredConsoleStores(config: ConsoleConfig, seed = true): Promise<ConsoleStores> {
  if (config.SUI402_CONSOLE_STORAGE_DRIVER !== "postgres") {
    return createConsoleStores(config, seed);
  }

  if (!config.SUI402_CONSOLE_POSTGRES_URL) {
    throw new Error("Postgres console storage requires SUI402_CONSOLE_POSTGRES_URL");
  }

  const pool = new Pool({ connectionString: config.SUI402_CONSOLE_POSTGRES_URL });
  const bundle = createPostgresConsoleStoreBundle({
    client: pool,
    merchantTableName: config.SUI402_CONSOLE_MERCHANT_TABLE,
    listingTableName: config.SUI402_CONSOLE_LISTING_TABLE,
    challengeTableName: config.SUI402_CONSOLE_CHALLENGE_TABLE,
    consumedChallengeTableName: config.SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE,
    paymentRecordTableName: config.SUI402_CONSOLE_PAYMENT_RECORD_TABLE,
    sessionSpendTableName: config.SUI402_CONSOLE_SESSION_SPEND_TABLE,
    settlementEventTableName: config.SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE,
    indexerCursorTableName: config.SUI402_CONSOLE_INDEXER_CURSOR_TABLE,
    exportTableName: config.SUI402_CONSOLE_EXPORT_TABLE,
    merchantApplicationTableName: config.SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE,
    merchantChangeRequestTableName: config.SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE,
    auditTableName: config.SUI402_CONSOLE_AUDIT_TABLE,
    rateLimitTableName: config.SUI402_CONSOLE_RATE_LIMIT_TABLE
  });
  if (config.SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS) {
    await bundle.setup();
  }

  const stores: ConsoleStores = {
    merchants: bundle.merchants,
    listings: bundle.listings,
    payments: bundle.payments,
    challenges: bundle.challenges,
    sessionSpends: bundle.sessionSpends,
    settlementEvents: bundle.settlementEvents,
    indexerCursors: bundle.indexerCursors,
    exports: bundle.exports,
    merchantApplications: bundle.merchantApplications,
    merchantChangeRequests: bundle.merchantChangeRequests,
    audit: bundle.audit,
    publicIntakeRateLimits: bundle.rateLimits,
    checkReady: async () => {
      await pool.query("select 1");
    },
    close: async () => {
      await pool.end();
    }
  };
  if (seed && (await stores.merchants.list()).length === 0) {
    await seedConsoleStores(stores, config);
  }

  return stores;
}

async function seedConsoleStores(stores: ConsoleStores, config: ConsoleConfig): Promise<void> {
  const merchants = seedMerchants();
  for (const merchant of merchants) {
    await stores.merchants.upsert(merchant);
  }

  for (const listing of seedListings(config.SUI402_CONSOLE_PROVIDER_BASE_URL, merchants)) {
    await stores.listings.upsert(listing);
  }

  for (const payment of seedPayments()) {
    await stores.payments.record(payment);
  }
}

export function createConsoleApp(config: ConsoleConfig, options: ConsoleAppOptions = {}): express.Express {
  const stores = options.stores ?? createConsoleStores(config, options.seed ?? true);
  const fetchImpl = options.fetch ?? fetch;
  const resolveTxtImpl = options.resolveTxt ?? resolveTxt;
  const publicIntakeLimiter = stores.publicIntakeRateLimits ?? new MemoryWindowRateLimitStore();
  const receiptIssuerFactory = createConsoleReceiptIssuerFactory(config, {
    sequenceStore: options.receiptSequenceStore,
    receiptSigner: options.receiptSigner
  });
  const app = express();
  const metrics = createHttpMetrics("sui402-console-api");

  app.disable("x-powered-by");
  app.use(corsForLocalDashboard(config));
  app.use(metrics.middleware);
  app.use(express.json({ limit: "1mb" }));
  app.use("/v1/marketplace", publicReadSurface(config, publicIntakeLimiter, "marketplace"));
  app.use("/v1/scan", publicReadSurface(config, publicIntakeLimiter, "scan"));
  app.use("/marketplace", publicReadSurface(config, publicIntakeLimiter, "marketplace"));
  app.use("/scan", publicReadSurface(config, publicIntakeLimiter, "scan"));
  app.use(privateConsoleSurface());

  app.get("/health/live", (_req, res) => {
    res.json({ ok: true, service: "sui402-console-api" });
  });

  app.get("/health/ready", async (_req, res) => {
    let storageError: string | undefined;
    try {
      await stores.checkReady?.();
    } catch (error) {
      storageError = error instanceof Error ? error.message : "Storage readiness check failed";
    }
    const ok = !storageError;
    res.status(ok ? 200 : 503).json({
      ok,
      service: "sui402-console-api",
      storageDriver: config.SUI402_CONSOLE_STORAGE_DRIVER,
      durableStorage: config.SUI402_CONSOLE_STORAGE_DRIVER !== "memory",
      authConfigured: Boolean(
        config.SUI402_CONSOLE_ADMIN_API_KEY ||
          config.SUI402_CONSOLE_OPERATOR_KEYS_JSON ||
          (config.SUI402_CONSOLE_OIDC_ISSUER &&
            config.SUI402_CONSOLE_OIDC_AUDIENCE &&
            config.SUI402_CONSOLE_OIDC_JWKS_URL)
      ),
      walrusExportsEnabled: Boolean(config.SUI402_WALRUS_PUBLISHER_URL),
      dependencies: {
        storage: {
          ok,
          ...(storageError ? { error: storageError } : {})
        }
      }
    });
  });

  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render());
  });

  app.get("/v1/overview", requireConsoleRole(config, "viewer"), async (_req, res) => {
    const mode = options.seed === false ? "live" : "seeded";
    res.json(await buildOverview(stores, mode, config));
  });

  app.get("/v1/marketplace/apis", async (req, res) => {
    const query = PublicMarketplaceQuerySchema.parse(req.query);
    const [listings, payments, merchants] = await Promise.all([
      stores.listings.list({
        network: query.network,
        transport: query.transport,
        tag: query.tag,
        status: "active",
        limit: 1000
      }),
      stores.payments.listRecent(500),
      stores.merchants.list()
    ]);
    const merchantsById = new Map(merchants.map((merchant) => [merchant.id, merchant]));
    const filtered = query.q ? listings.filter((listing) => listingMatchesSearch(listing, query.q!)) : listings;
    const visible = filtered.slice(0, query.limit);

    res.json({
      schemaVersion: "sui402.marketplace.v1",
      generatedAt: new Date().toISOString(),
      dataSource: "console-api",
      count: filtered.length,
      limit: query.limit,
      hasMore: filtered.length > visible.length,
      apis: visible.map((listing) =>
        marketplaceListingToApi(listing, payments, merchantsById.get(listing.id), publicLinkOptions(config))
      )
    });
  });

  app.get("/v1/marketplace/apis/:apiId", async (req, res) => {
    const apiId = req.params.apiId;
    if (!apiId) {
      res.status(400).json({ error: "invalid_api", message: "Marketplace API id is required" });
      return;
    }

    const [listing, merchant, payments] = await Promise.all([
      stores.listings.get(apiId),
      stores.merchants.get(apiId),
      stores.payments.listRecent(1000)
    ]);

    if (!listing || listing.status !== "active") {
      res.status(404).json({
        error: "marketplace_api_not_found",
        message: "Marketplace API not found in the active public registry",
        dataSource: "console-api",
        notIndexedYet: true
      });
      return;
    }

    const matchedPayments = payments.filter((payment) => paymentBelongsToListing(payment, listing));

    res.json(marketplaceListingToDetail({ listing, merchant, payments: matchedPayments, links: publicLinkOptions(config) }));
  });

  app.get("/v1/scan/stats", async (_req, res) => {
    const [listings, payments, sessionSpends] = await Promise.all([
      stores.listings.list({ limit: 500 }),
      stores.payments.listRecent(500),
      stores.sessionSpends.list({ limit: 500 })
    ]);

    res.json({
      schemaVersion: "sui402.scan.v1",
      generatedAt: new Date().toISOString(),
      dataSource: "console-api",
      ...buildPublicScanStats({ listings, payments, sessionSpendCount: sessionSpends.length, links: publicLinkOptions(config) })
    });
  });

  app.get("/v1/scan/payments/:digest", async (req, res) => {
    const digest = req.params.digest;
    if (!digest) {
      res.status(400).json({ error: "invalid_digest", message: "Payment digest is required" });
      return;
    }

    const network = readOptionalSuiNetwork(req.query.network);
    if (network instanceof Error) {
      res.status(400).json({ error: "invalid_network", message: network.message });
      return;
    }

    const payment = await findScanPayment(stores.payments, digest, network);
    if (!payment) {
      res.status(404).json({
        error: "payment_not_found",
        message: "Payment not found in the indexed payment store",
        dataSource: "console-api",
        notIndexedYet: true
      });
      return;
    }

    res.json(paymentToPublicScanRecord(payment, publicLinkOptions(config)));
  });

  app.get("/v1/scan/merchants/:merchantId", async (req, res) => {
    const merchantId = req.params.merchantId;
    if (!merchantId) {
      res.status(400).json({ error: "invalid_merchant", message: "Merchant id is required" });
      return;
    }

    const [merchant, listing, payments] = await Promise.all([
      stores.merchants.get(merchantId),
      stores.listings.get(merchantId),
      stores.payments.listRecent(1000)
    ]);

    if (!merchant && !listing) {
      res.status(404).json({
        error: "merchant_not_found",
        message: "Merchant not found in the indexed merchant/listing store",
        dataSource: "console-api",
        notIndexedYet: true
      });
      return;
    }

    const matchedPayments = payments.filter((payment) =>
      listing
        ? paymentBelongsToListing(payment, listing)
        : payment.challenge.metadata?.merchantId === merchantId ||
          Boolean(merchant && payment.challenge.recipient.toLowerCase() === merchant.merchant.toLowerCase())
    );

    res.json({
      merchant: merchant
        ? {
            id: merchant.id,
            service: merchant.service,
            network: merchant.network,
            merchant: merchant.merchant,
            coinType: merchant.coinType,
            price: merchant.price,
            resourceScope: merchant.resourceScope,
            status: merchant.status,
            sessionsEnabled: Boolean(merchant.sessionPackageId)
          }
        : undefined,
      listing: listing ? marketplaceListingToApi(listing, matchedPayments, merchant, publicLinkOptions(config)) : undefined,
      stats: {
        verifiedPayments: matchedPayments.length,
        sessionPayments: matchedPayments.filter((payment) => payment.proof.kind === "session").length,
        volume: sumPaymentAmounts(matchedPayments).toString()
      },
      links: scanMerchantLinks(merchantId, publicLinkOptions(config)),
      recentPayments: matchedPayments.slice(0, 10).map((payment) => paymentToPublicScanRecord(payment, publicLinkOptions(config)))
    });
  });

  app.get("/v1/scan/sessions/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: "invalid_session", message: "Session id is required" });
      return;
    }

    const records = await stores.sessionSpends.list({ sessionId, limit: 500 });
    if (records.length === 0) {
      res.status(404).json({
        error: "session_not_found",
        message: "Session not found in the indexed session spend store",
        dataSource: "console-api",
        notIndexedYet: true
      });
      return;
    }

    const indexerProgress = await sessionIndexerProgress(stores.indexerCursors, records[0]);
    res.json(sessionSpendsToPublicScanSession(sessionId, records, publicLinkOptions(config), indexerProgress));
  });

  app.get("/v1/scan/settlements/:settlementId", async (req, res) => {
    const settlementId = req.params.settlementId;
    if (!settlementId) {
      res.status(400).json({ error: "invalid_settlement", message: "Settlement id is required" });
      return;
    }

    const record = await findScanSettlement(stores.settlementEvents, settlementId);
    if (!record) {
      res.status(404).json({
        error: "settlement_not_found",
        message: "Settlement not found in the indexed settlement event store",
        dataSource: "console-api",
        notIndexedYet: true
      });
      return;
    }

    const indexerProgress = await settlementIndexerProgress(stores.indexerCursors, record);
    res.json(settlementToPublicScanRecord(record, publicLinkOptions(config), indexerProgress));
  });

  app.get("/marketplace/:apiId", async (req, res) => {
    const apiId = req.params.apiId;
    if (!apiId) {
      res.status(400).type("html").send(renderPublicNotFoundPage(req, "Marketplace API", "Marketplace API id is required"));
      return;
    }

    const [listing, merchant, payments] = await Promise.all([
      stores.listings.get(apiId),
      stores.merchants.get(apiId),
      stores.payments.listRecent(1000)
    ]);

    if (!listing || listing.status !== "active") {
      res
        .status(404)
        .type("html")
        .send(
          renderPublicNotFoundPage(req, "Marketplace API not found", "This API is not in the active public Sui402 registry yet.", {
            recordLabel: "API id",
            recordId: apiId,
            alternateJsonPath: `/v1/marketplace/apis/${encodeURIComponent(apiId)}`,
            links: [
              ["JSON detail", `/v1/marketplace/apis/${encodeURIComponent(apiId)}`],
              ["Marketplace search", "/v1/marketplace/apis"]
            ]
          })
        );
      return;
    }

    const matchedPayments = payments.filter((payment) => paymentBelongsToListing(payment, listing));
    res.type("html").send(renderMarketplacePublicPage(req, listing, merchant, matchedPayments));
  });

  app.get("/scan/payment/:digest", async (req, res) => {
    const digest = req.params.digest;
    if (!digest) {
      res.status(400).type("html").send(renderPublicNotFoundPage(req, "Payment", "Payment digest is required"));
      return;
    }

    const payment = await findScanPayment(stores.payments, digest);
    if (!payment) {
      res
        .status(404)
        .type("html")
        .send(
          renderPublicNotFoundPage(req, "Payment not found", "This payment has not been indexed by Sui402 scan yet.", {
            recordLabel: "Payment digest",
            recordId: digest,
            alternateJsonPath: `/v1/scan/payments/${encodeURIComponent(digest)}`,
            links: [
              ["JSON detail", `/v1/scan/payments/${encodeURIComponent(digest)}`],
              ["Scan stats", "/v1/scan/stats"]
            ]
          })
        );
      return;
    }

    res.type("html").send(renderScanPaymentPublicPage(req, payment));
  });

  app.get("/scan/merchant/:merchantId", async (req, res) => {
    const merchantId = req.params.merchantId;
    if (!merchantId) {
      res.status(400).type("html").send(renderPublicNotFoundPage(req, "Merchant", "Merchant id is required"));
      return;
    }

    const [merchant, listing, payments] = await Promise.all([
      stores.merchants.get(merchantId),
      stores.listings.get(merchantId),
      stores.payments.listRecent(1000)
    ]);
    if (!merchant && !listing) {
      res
        .status(404)
        .type("html")
        .send(
          renderPublicNotFoundPage(req, "Merchant not found", "This merchant has not been indexed by Sui402 scan yet.", {
            recordLabel: "Merchant id",
            recordId: merchantId,
            alternateJsonPath: `/v1/scan/merchants/${encodeURIComponent(merchantId)}`,
            links: [
              ["JSON detail", `/v1/scan/merchants/${encodeURIComponent(merchantId)}`],
              ["Marketplace candidate", `/marketplace/${encodeURIComponent(merchantId)}`],
              ["Scan stats", "/v1/scan/stats"]
            ]
          })
        );
      return;
    }

    const matchedPayments = payments.filter((payment) =>
      listing
        ? paymentBelongsToListing(payment, listing)
        : payment.challenge.metadata?.merchantId === merchantId ||
          Boolean(merchant && payment.challenge.recipient.toLowerCase() === merchant.merchant.toLowerCase())
    );
    res.type("html").send(renderScanMerchantPublicPage(req, merchantId, merchant, listing, matchedPayments));
  });

  app.get("/scan/session/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).type("html").send(renderPublicNotFoundPage(req, "Session", "Session id is required"));
      return;
    }

    const records = await stores.sessionSpends.list({ sessionId, limit: 500 });
    if (records.length === 0) {
      res
        .status(404)
        .type("html")
        .send(
          renderPublicNotFoundPage(req, "Session not found", "This session has not been indexed by Sui402 scan yet.", {
            recordLabel: "Session id",
            recordId: sessionId,
            alternateJsonPath: `/v1/scan/sessions/${encodeURIComponent(sessionId)}`,
            links: [
              ["JSON detail", `/v1/scan/sessions/${encodeURIComponent(sessionId)}`],
              ["Scan stats", "/v1/scan/stats"]
            ]
          })
        );
      return;
    }

    const indexerProgress = await sessionIndexerProgress(stores.indexerCursors, records[0]);
    res.type("html").send(renderScanSessionPublicPage(req, sessionId, records, indexerProgress));
  });

  app.get("/scan/settlement/:settlementId", async (req, res) => {
    const settlementId = req.params.settlementId;
    if (!settlementId) {
      res.status(400).type("html").send(renderPublicNotFoundPage(req, "Settlement", "Settlement id is required"));
      return;
    }

    const record = await findScanSettlement(stores.settlementEvents, settlementId);
    if (!record) {
      res
        .status(404)
        .type("html")
        .send(
          renderPublicNotFoundPage(req, "Settlement not found", "This settlement has not been indexed by Sui402 scan yet.", {
            recordLabel: "Settlement id",
            recordId: settlementId,
            alternateJsonPath: `/v1/scan/settlements/${encodeURIComponent(settlementId)}`,
            links: [
              ["JSON detail", `/v1/scan/settlements/${encodeURIComponent(settlementId)}`],
              ["Scan stats", "/v1/scan/stats"]
            ]
          })
        );
      return;
    }

    const indexerProgress = await settlementIndexerProgress(stores.indexerCursors, record);
    res.type("html").send(renderScanSettlementPublicPage(req, record, indexerProgress));
  });

  app.get(
    "/v1/seller/merchants/:merchantId",
    requireSellerRole(config, "seller_viewer", (req) => readRouteParam(req.params.merchantId)),
    async (req, res) => {
      const merchantId = readRouteParam(req.params.merchantId);
      const [merchant, listing, payments] = await Promise.all([
        stores.merchants.get(merchantId),
        stores.listings.get(merchantId),
        stores.payments.listRecent(1000)
      ]);

      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      const matchedPayments = listing ? payments.filter((payment) => paymentBelongsToListing(payment, listing)) : [];
      res.json({
        merchant: sellerMerchantView(merchant),
        listing: listing ? marketplaceListingToApi(listing, matchedPayments, merchant, publicLinkOptions(config)) : undefined,
        stats: {
          verifiedPayments: matchedPayments.length,
          sessionPayments: matchedPayments.filter((payment) => payment.proof.kind === "session").length,
          volume: sumPaymentAmounts(matchedPayments).toString()
        },
        recentPayments: matchedPayments.slice(0, 10).map((payment) => paymentToPublicScanRecord(payment, publicLinkOptions(config)))
      });
    }
  );

  app.patch(
    "/v1/seller/merchants/:merchantId",
    requireSellerRole(config, "seller_admin", (req) => readRouteParam(req.params.merchantId)),
    async (req, res) => {
      const merchantId = readRouteParam(req.params.merchantId);
      const merchant = await stores.merchants.get(merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      const parsed = SellerMerchantUpdateSchema.parse(req.body ?? {});
      if (Object.prototype.hasOwnProperty.call(parsed, "upstreamUrl")) {
        const requestedUpstreamUrl = parsed.upstreamUrl === null ? undefined : parsed.upstreamUrl;
        const currentUpstreamUrl = merchant.upstreamUrl;
        const upstreamChanged =
          requestedUpstreamUrl === undefined
            ? currentUpstreamUrl !== undefined
            : currentUpstreamUrl === undefined || canonicalUrl(requestedUpstreamUrl) !== canonicalUrl(currentUpstreamUrl);

        if (upstreamChanged) {
          res.status(409).json({
            error: "upstream_verification_required",
            message:
              "Changing a publisher upstream URL requires a fresh ownership proof and operator review before the live merchant is updated.",
            currentUpstreamUrl,
            requestedUpstreamUrl
          });
          return;
        }
      }
      const updated = createGatewayMerchantConfig({
        ...merchant,
        service: parsed.service ?? merchant.service,
        price: parsed.price ?? merchant.price,
        resourceScope: parsed.resourceScope ?? merchant.resourceScope,
        upstreamUrl: parsed.upstreamUrl === null ? undefined : parsed.upstreamUrl ?? merchant.upstreamUrl,
        upstreamTimeoutMs: parsed.upstreamTimeoutMs ?? merchant.upstreamTimeoutMs,
        sessionPackageId: parsed.sessionPackageId === null ? undefined : parsed.sessionPackageId ?? merchant.sessionPackageId,
        status: parsed.status ?? merchant.status
      });
      const existingListing = await stores.listings.get(merchantId);
      const manifest = createGatewayManifest(updated);
      const listing: Sui402ServiceListing = {
        ...createListingFromManifest({
          id: updated.id,
          name: updated.service,
          description: existingListing?.description,
          providerBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL,
          transport: existingListing?.transport ?? (updated.resourceScope.startsWith("mcp:") ? "mcp" : "http"),
          manifest,
          tags: existingListing?.tags ?? (updated.resourceScope.startsWith("mcp:") ? ["mcp", "tools"] : ["api"]),
          metadata: existingListing?.metadata
        }),
        status: updated.status
      };

      await stores.merchants.upsert(updated);
      await stores.listings.upsert(listing);
      await recordAuditEvent(stores, req, res, {
        action: "seller.merchant.update",
        targetType: "merchant",
        targetId: merchantId,
        metadata: {
          changedFields: Object.keys(parsed),
          immutableFields: ["merchant", "network", "coinType"]
        }
      });

      res.json({ merchant: sellerMerchantView(updated), listing, manifest });
    }
  );

  app.get(
    "/v1/seller/merchants/:merchantId/change-requests",
    requireSellerRole(config, "seller_viewer", (req) => readRouteParam(req.params.merchantId)),
    async (req, res) => {
      const merchantId = readRouteParam(req.params.merchantId);
      if (!(await stores.merchants.get(merchantId))) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      const query = MerchantChangeRequestQuerySchema.parse({ ...req.query, merchantId });
      res.json({ requests: await stores.merchantChangeRequests.list(query) });
    }
  );

  app.post(
    "/v1/seller/merchants/:merchantId/change-requests",
    requireSellerRole(config, "seller_admin", (req) => readRouteParam(req.params.merchantId)),
    async (req, res) => {
      const merchantId = readRouteParam(req.params.merchantId);
      const merchant = await stores.merchants.get(merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      const parsed = MerchantChangeRequestSubmitSchema.parse(req.body ?? {});
      const changedFields = merchantChangeFields(merchant, parsed.changes);
      if (changedFields.length === 0) {
        res.status(400).json({
          error: "no_effective_change",
          message: "Requested payout, network, or coin values already match the merchant"
        });
        return;
      }
      const pendingRequests = await stores.merchantChangeRequests.list({
        merchantId,
        status: "pending",
        limit: 100
      });
      const overlapping = pendingRequests.find((pending) =>
        merchantChangeFields(merchant, pending.changes).some((field) => changedFields.includes(field))
      );
      if (overlapping) {
        res.status(409).json({
          error: "merchant_change_request_conflict",
          message: "A pending merchant change request already covers one or more requested fields",
          requestId: overlapping.id,
          changedFields
        });
        return;
      }

      const seller = res.locals.sui402Seller as { id: string; roles: ConsoleSellerRole[] } | undefined;
      const request = createMerchantChangeRequest(
        {
          ...parsed,
          merchantId,
          requestedBy: seller?.id,
          requestedByRoles: seller?.roles
        },
        {
          reviewSlaHours: config.SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS
        }
      );
      if (await stores.merchantChangeRequests.get(request.id)) {
        res.status(409).json({
          error: "merchant_change_request_exists",
          message: "A merchant change request with this id already exists"
        });
        return;
      }

      await stores.merchantChangeRequests.submit(request);
      await recordAuditEvent(stores, req, res, {
        action: "seller.merchant_change.request",
        targetType: "merchant_change_request",
        targetId: request.id,
        metadata: {
          merchantId,
          changedFields,
          previous: merchantChangePreviousValues(merchant, changedFields),
          requested: request.changes,
          reason: request.reason
        }
      });

      res.status(202).json({ request });
    }
  );

  app.get(
    "/v1/merchant-change-requests",
    requireConsoleRole(config, "merchant_admin"),
    async (req, res) => {
      const query = MerchantChangeRequestQuerySchema.parse(req.query);
      res.json({ requests: await stores.merchantChangeRequests.list(query) });
    }
  );

  app.post(
    "/v1/merchant-change-requests/:requestId/review",
    requireConsoleRole(config, "merchant_admin"),
    async (req, res) => {
      const parsed = MerchantChangeRequestReviewSchema.parse(req.body ?? {});
      const operator = res.locals.sui402Operator as { id: string; roles: ConsoleRole[] } | undefined;
      const review = {
        ...parsed,
        reviewer: parsed.reviewer ?? operator?.id
      };
      const requestId = readRouteParam(req.params.requestId);
      const request = await stores.merchantChangeRequests.get(requestId);
      if (!request) {
        res.status(404).json({
          error: "merchant_change_request_not_found",
          message: "Merchant change request not found"
        });
        return;
      }

      if (request.status !== "pending") {
        res.status(409).json({
          error: "merchant_change_request_already_reviewed",
          message: `Merchant change request has already been ${request.status}`
        });
        return;
      }

      if (review.action === "reject") {
        const reviewed = reviewMerchantChangeRequest(request, review);
        await stores.merchantChangeRequests.update(reviewed);
        await recordAuditEvent(stores, req, res, {
          action: "merchant_change.reject",
          targetType: "merchant_change_request",
          targetId: reviewed.id,
          metadata: {
            merchantId: reviewed.merchantId,
            reviewer: reviewed.reviewer,
            reason: reviewed.reviewReason
          }
        });
        res.json({ request: reviewed });
        return;
      }

      const merchant = await stores.merchants.get(request.merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      const changedFields = merchantChangeFields(merchant, request.changes);
      if (changedFields.length === 0) {
        res.status(409).json({
          error: "no_effective_change",
          message: "Requested payout, network, or coin values already match the merchant"
        });
        return;
      }
      if (changedFields.includes("network") && merchant.sessionPackageId) {
        res.status(409).json({
          error: "session_package_revalidation_required",
          message: "Network changes for session-enabled merchants require a separately reviewed session package id update"
        });
        return;
      }

      const applied = await applyMerchantChangeRequest(stores, config, merchant, request);
      const reviewed = reviewMerchantChangeRequest(request, review, applied.merchant.id);
      await stores.merchantChangeRequests.update(reviewed);
      await recordAuditEvent(stores, req, res, {
        action: "merchant_change.approve",
        targetType: "merchant_change_request",
        targetId: reviewed.id,
        metadata: {
          merchantId: reviewed.merchantId,
          reviewer: reviewed.reviewer,
          changedFields,
          previous: merchantChangePreviousValues(merchant, changedFields),
          requested: reviewed.changes,
          listingId: applied.listing.id
        }
      });

      res.json({ request: reviewed, merchant: applied.merchant, listing: applied.listing, manifest: applied.manifest });
    }
  );

  app.get(
    "/v1/indexer/session-spends",
    requireConsoleRole(config, "viewer"),
    async (req, res) => {
      const query = SessionSpendQuerySchema.parse(req.query);
      const records = await stores.sessionSpends.list(query);
      res.json({ records });
    }
  );

  app.get(
    "/v1/indexer/sessions",
    requireConsoleRole(config, "viewer"),
    async (req, res) => {
      const query = SessionSpendQuerySchema.parse(req.query);
      const records = await stores.sessionSpends.list(query);
      res.json({ sessions: aggregateSessionSpends(records) });
    }
  );

  app.post(
    "/v1/indexer/session-spends",
    requireConsoleRole(config, "indexer"),
    async (req, res) => {
      const parsed = SessionSpendIngestSchema.parse(req.body ?? {});
      const records = parsed.records ?? (parsed.record ? [parsed.record] : []);
      for (const record of records) {
        await stores.sessionSpends.upsert(record);
      }

      await recordAuditEvent(stores, req, res, {
        action: "indexer.session_spends.ingest",
        targetType: "session_spend",
        metadata: {
          upserted: records.length,
          recordIds: records.slice(0, 20).map((record) => record.id)
        }
      });
      res.status(201).json({ upserted: records.length });
    }
  );

  app.get(
    "/v1/indexer/settlement-events",
    requireConsoleRole(config, "viewer"),
    async (req, res) => {
      const query = SettlementEventQuerySchema.parse(req.query);
      const records = await stores.settlementEvents.list(query);
      res.json({ records });
    }
  );

  app.post(
    "/v1/indexer/settlement-events",
    requireConsoleRole(config, "indexer"),
    async (req, res) => {
      const parsed = SettlementEventIngestSchema.parse(req.body ?? {});
      const records = parsed.records ?? (parsed.record ? [parsed.record] : []);
      for (const record of records) {
        await stores.settlementEvents.upsert(record);
      }

      await recordAuditEvent(stores, req, res, {
        action: "indexer.settlement_events.ingest",
        targetType: "settlement_event",
        metadata: {
          upserted: records.length,
          recordIds: records.slice(0, 20).map((record) => record.id)
        }
      });
      res.status(201).json({ upserted: records.length });
    }
  );

  app.get(
    "/v1/indexer/cursors/:cursorKey",
    requireConsoleRole(config, "indexer"),
    async (req, res) => {
      const key = z.string().min(1).parse(req.params.cursorKey);
      const state = await stores.indexerCursors.getCursor(key);
      if (!state) {
        res.status(404).json({ error: "indexer_cursor_not_found", key });
        return;
      }

      res.json({ state });
    }
  );

  app.put(
    "/v1/indexer/cursors/:cursorKey",
    requireConsoleRole(config, "indexer"),
    async (req, res) => {
      const key = z.string().min(1).parse(req.params.cursorKey);
      const parsed = IndexerCursorUpdateSchema.parse(req.body ?? {});
      await stores.indexerCursors.setCursor(key, parsed.cursor);
      const state = await stores.indexerCursors.getCursor(key);

      await recordAuditEvent(stores, req, res, {
        action: "indexer.cursor.update",
        targetType: "indexer_cursor",
        targetId: key,
        metadata: {
          cursor: parsed.cursor
        }
      });
      res.json({ state });
    }
  );

  app.post("/v1/merchants", requireConsoleRole(config, "merchant_admin"), async (req, res) => {
    const parsed = MerchantCreateSchema.parse(req.body);
    const { merchant, listing, manifest } = await publishMerchant(stores, config, parsed);

    await recordAuditEvent(stores, req, res, {
      action: "merchant.create",
      targetType: "merchant",
      targetId: merchant.id,
      metadata: {
        listingId: listing.id,
        network: merchant.network,
        transport: parsed.transport
      }
    });
    res.status(201).json({ merchant, listing, manifest });
  });

  app.post("/v1/merchant-applications", async (req, res) => {
    const limit = await publicIntakeLimiter.consume(publicIntakeKey(req), {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many merchant application submissions. Try again later.",
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    const parsed = MerchantApplicationSubmitSchema.parse(req.body);
    if (parsed.request.upstreamUrl) {
      try {
        assertSafeUpstreamUrl(parsed.request.upstreamUrl);
      } catch (error) {
        res.status(400).json({
          error: "unsafe_upstream_url",
          message: error instanceof Error ? error.message : "Unsafe upstream URL"
        });
        return;
      }
      const intakePolicy = evaluatePublicIntakeHostPolicy([parsed.request.upstreamUrl], config);
      if (!intakePolicy.allowed) {
        res.status(403).json(intakePolicyErrorResponse(intakePolicy));
        return;
      }
    }
    const application = createMerchantApplication(parsed, {
      reviewSlaHours: config.SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS
    });
    if (await stores.merchantApplications.get(application.id)) {
      res.status(409).json({
        error: "merchant_application_exists",
        message: "A merchant application with this id already exists"
      });
      return;
    }

    await stores.merchantApplications.submit(application);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.submit",
      targetType: "merchant_application",
      targetId: application.id,
      metadata: {
        merchantId: application.request.id,
        applicantEmail: application.applicant?.email
      }
    });
    res.status(202).json({
      application,
      abuseControls: merchantApplicationAbuseControlsView(application, config),
      nextSteps: merchantApplicationNextSteps(application, nextStepOptions(config))
    });
  });

  app.post("/v1/publisher/apis/draft", async (req, res) => {
    const limit = await publicIntakeLimiter.consume(`${publicIntakeKey(req)}:publisher-draft`, {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many publisher API draft submissions. Try again later.",
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    const draft = PublisherApiDraftSchema.parse(req.body ?? {});
    if (hasPublisherOpenApiSelection(draft) && !draft.openApiUrl) {
      res.status(400).json({
        error: "openapi_selection_requires_import",
        message: "Select an OpenAPI operation only when openApiUrl is provided"
      });
      return;
    }
    if ((draft.openApiMethod && !draft.openApiPath) || (!draft.openApiMethod && draft.openApiPath)) {
      res.status(400).json({
        error: "openapi_selection_incomplete",
        message: "Select an OpenAPI operation with openApiOperationId or both openApiMethod and openApiPath"
      });
      return;
    }
    try {
      assertSafeUpstreamUrl(draft.apiUrl);
      if (draft.openApiUrl) {
        assertSafeUpstreamUrl(draft.openApiUrl);
      }
    } catch (error) {
      res.status(400).json({
        error: "unsafe_upstream_url",
        message: error instanceof Error ? error.message : "Unsafe upstream URL"
      });
      return;
    }
    const intakePolicy = evaluatePublicIntakeHostPolicy([draft.apiUrl, draft.openApiUrl], config);
    if (!intakePolicy.allowed) {
      res.status(403).json(intakePolicyErrorResponse(intakePolicy));
      return;
    }

    let previewResult: Awaited<ReturnType<typeof buildPublisherApiDraftPreviewResult>>;
    try {
      previewResult = await buildPublisherApiDraftPreviewResult(draft, config, fetchImpl);
    } catch (error) {
      if (error instanceof PublisherOpenApiOperationNotFoundError) {
        res.status(400).json({
          error: "openapi_operation_not_found",
          message: "The selected OpenAPI operation was not found in the imported preview"
        });
        return;
      }
      res.status(400).json({
        error: "openapi_import_failed",
        message: error instanceof Error ? error.message : "Could not import OpenAPI document"
      });
      return;
    }
    const { openApi, selectedOpenApiEndpoint } = previewResult;
    const application = previewResult.application;
    if (await stores.merchantApplications.get(application.id)) {
      res.status(409).json({
        error: "merchant_application_exists",
        message: "A merchant application with this id already exists"
      });
      return;
    }
    if ((await stores.merchants.get(application.request.id)) || (await stores.listings.get(application.request.id))) {
      res.status(409).json({
        error: "merchant_already_exists",
        message: "A merchant or listing with this derived id already exists; pass a unique id"
      });
      return;
    }

    await stores.merchantApplications.submit(application);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.submit",
      targetType: "merchant_application",
      targetId: application.id,
      metadata: {
        merchantId: application.request.id,
        applicantEmail: application.applicant?.email,
        intake: "publisher-api-draft",
        openApiEndpointCount: openApi?.endpointCount,
        selectedOpenApiEndpoint: selectedOpenApiEndpoint
          ? {
              method: selectedOpenApiEndpoint.method,
              path: selectedOpenApiEndpoint.path,
              operationId: selectedOpenApiEndpoint.operationId,
              suggestedResourceScope: selectedOpenApiEndpoint.suggestedResourceScope
            }
          : undefined
      }
    });

    res.status(202).json({
      application,
      abuseControls: merchantApplicationAbuseControlsView(application, config),
      preview: publisherApiDraftPreview(
        application,
        config.SUI402_CONSOLE_PROVIDER_BASE_URL,
        openApi,
        selectedOpenApiEndpoint,
        buildPublisherReviewConfigDraft(application, config.SUI402_CONSOLE_PROVIDER_BASE_URL)
      ),
      nextSteps: merchantApplicationNextSteps(application, nextStepOptions(config))
    });
  });

  app.post("/v1/publisher/apis/preview", async (req, res) => {
    const limit = await publicIntakeLimiter.consume(`${publicIntakeKey(req)}:publisher-preview`, {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many publisher API previews. Try again later.",
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    const draft = PublisherApiDraftSchema.parse(req.body ?? {});
    if (hasPublisherOpenApiSelection(draft) && !draft.openApiUrl) {
      res.status(400).json({
        error: "openapi_selection_requires_import",
        message: "Select an OpenAPI operation only when openApiUrl is provided"
      });
      return;
    }
    if ((draft.openApiMethod && !draft.openApiPath) || (!draft.openApiMethod && draft.openApiPath)) {
      res.status(400).json({
        error: "openapi_selection_incomplete",
        message: "Select an OpenAPI operation with openApiOperationId or both openApiMethod and openApiPath"
      });
      return;
    }
    try {
      assertSafeUpstreamUrl(draft.apiUrl);
      if (draft.openApiUrl) {
        assertSafeUpstreamUrl(draft.openApiUrl);
      }
    } catch (error) {
      res.status(400).json({
        error: "unsafe_upstream_url",
        message: error instanceof Error ? error.message : "Unsafe upstream URL"
      });
      return;
    }
    const intakePolicy = evaluatePublicIntakeHostPolicy([draft.apiUrl, draft.openApiUrl], config);
    if (!intakePolicy.allowed) {
      res.status(403).json(intakePolicyErrorResponse(intakePolicy));
      return;
    }

    try {
      const { application, openApi, selectedOpenApiEndpoint } = await buildPublisherApiDraftPreviewResult(
        draft,
        config,
        fetchImpl
      );
      const merchantApplicationExists = Boolean(await stores.merchantApplications.get(application.id));
      const merchantOrListingExists = Boolean(
        (await stores.merchants.get(application.request.id)) || (await stores.listings.get(application.request.id))
      );
      res.status(200).json({
        schemaVersion: "sui402.publisher-api-preview.v1",
        preview: publisherApiDraftPreview(
          application,
          config.SUI402_CONSOLE_PROVIDER_BASE_URL,
          openApi,
          selectedOpenApiEndpoint,
          buildPublisherReviewConfigDraft(application, config.SUI402_CONSOLE_PROVIDER_BASE_URL)
        ),
        conflicts: {
          merchantApplicationExists,
          merchantOrListingExists
        },
        note: "Preview only. No merchant application, gateway route, listing, or token was created."
      });
    } catch (error) {
      if (error instanceof PublisherOpenApiOperationNotFoundError) {
        res.status(400).json({
          error: "openapi_operation_not_found",
          message: "The selected OpenAPI operation was not found in the imported preview"
        });
        return;
      }
      res.status(400).json({
        error: "openapi_import_failed",
        message: error instanceof Error ? error.message : "Could not import OpenAPI document"
      });
    }
  });

  app.post("/v1/publisher/apis/:applicationId/session", async (req, res) => {
    const applicationId = readRouteParam(req.params.applicationId);
    const application = await stores.merchantApplications.get(applicationId);
    if (!application) {
      res.status(404).json({
        error: "merchant_application_not_found",
        message: "Merchant application not found"
      });
      return;
    }

    const token = req.header("x-sui402-publisher-token");
    if (!application.verification?.accessToken || token !== application.verification.accessToken) {
      if (await rejectPublisherAuthFailure({ req, res, limiter: publicIntakeLimiter, config, applicationId: application.id })) {
        return;
      }
      res.status(403).json({
        error: "publisher_access_token_required",
        message: "Exchange the private publisher access token in x-sui402-publisher-token for a short-lived publisher session"
      });
      return;
    }

    const parsed = PublisherSessionCreateSchema.parse(req.body ?? {});
    const session = createPublisherSessionToken(application, parsed.ttlSeconds);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.publisher_session.issue",
      targetType: "merchant_application",
      targetId: application.id,
      metadata: {
        merchantId: application.request.id,
        sessionId: session.claims.sid,
        expiresAt: session.expiresAt,
        ttlSeconds: parsed.ttlSeconds,
        accessTokenHash: privateTokenHash(application.verification.accessToken)
      }
    });

    res.status(201).json({
      schemaVersion: "sui402.publisher-session.v1",
      applicationId: application.id,
      merchantId: application.request.id,
      tokenType: "Bearer",
      publisherSessionToken: session.token,
      expiresAt: session.expiresAt,
      ttlSeconds: parsed.ttlSeconds,
      commands: {
        status: `curl -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" "${absoluteConsoleRoute(config.SUI402_CONSOLE_PROVIDER_BASE_URL, `/v1/publisher/apis/${application.id}/status`)}"`,
        probe: `curl -X POST -H "Authorization: Bearer $SUI402_PUBLISHER_SESSION" "${absoluteConsoleRoute(config.SUI402_CONSOLE_PROVIDER_BASE_URL, `/v1/publisher/apis/${application.id}/probe`)}"`
      },
      note: "Use publisherSessionToken for portal/status/probe calls. It is short-lived and rotating the publisher access token invalidates outstanding sessions."
    });
  });

  app.get("/v1/publisher/apis/:applicationId/status", async (req, res) => {
    const applicationId = readRouteParam(req.params.applicationId);
    const application = await stores.merchantApplications.get(applicationId);
    if (!application) {
      res.status(404).json({
        error: "merchant_application_not_found",
        message: "Merchant application not found"
      });
      return;
    }

    const publisherAuth = authenticatePublisherRequest(application, req);
    if (!publisherAuth) {
      if (await rejectPublisherAuthFailure({ req, res, limiter: publicIntakeLimiter, config, applicationId: application.id })) {
        return;
      }
      res.status(403).json({
        error: "publisher_status_auth_required",
        message: "Pass a short-lived publisher session as Authorization: Bearer <token>, or the private publisher access token in x-sui402-publisher-token"
      });
      return;
    }

    res.json({
      application: merchantApplicationView(application, config),
      preview: publisherApiDraftPreview(
        application,
        config.SUI402_CONSOLE_PROVIDER_BASE_URL,
        publisherOpenApiPreviewFromMetadata(application),
        publisherOpenApiSelectionFromMetadata(application),
        buildPublisherReviewConfigDraft(application, config.SUI402_CONSOLE_PROVIDER_BASE_URL)
      ),
      nextSteps: merchantApplicationNextSteps(application, nextStepOptions(config)),
      publisherAuth: publisherAuthView(publisherAuth)
    });
  });

  app.post("/v1/publisher/apis/:applicationId/probe", async (req, res) => {
    const applicationId = readRouteParam(req.params.applicationId);
    const application = await stores.merchantApplications.get(applicationId);
    if (!application) {
      res.status(404).json({
        error: "merchant_application_not_found",
        message: "Merchant application not found"
      });
      return;
    }

    const publisherAuth = authenticatePublisherRequest(application, req);
    if (!publisherAuth) {
      if (await rejectPublisherAuthFailure({ req, res, limiter: publicIntakeLimiter, config, applicationId: application.id })) {
        return;
      }
      res.status(403).json({
        error: "publisher_probe_auth_required",
        message: "Pass a short-lived publisher session as Authorization: Bearer <token>, or the private publisher access token in x-sui402-publisher-token"
      });
      return;
    }

    const [merchant, listing, payments] = await Promise.all([
      stores.merchants.get(application.request.id),
      stores.listings.get(application.request.id),
      stores.payments.listRecent(500)
    ]);
    const probe = buildPublisherApiProbe(application, merchant, listing, payments, config);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.probe",
      targetType: "merchant_application",
      targetId: application.id,
      metadata: {
        merchantId: application.request.id,
        approved: application.status === "approved",
        merchantPublished: Boolean(merchant),
        listingPublished: Boolean(listing)
      }
    });

    res.status(probe.ready ? 200 : 409).json({ ...probe, publisherAuth: publisherAuthView(publisherAuth) });
  });

  app.post("/v1/merchant-applications/:applicationId/verify", async (req, res) => {
    const limit = await publicIntakeLimiter.consume(`${publicIntakeKey(req)}:verify`, {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many merchant application verification attempts. Try again later.",
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    const applicationId = readRouteParam(req.params.applicationId);
    const application = await stores.merchantApplications.get(applicationId);
    if (!application) {
      res.status(404).json({
        error: "merchant_application_not_found",
        message: "Merchant application not found"
      });
      return;
    }

    const verified = await verifyMerchantApplication(application, fetchImpl, resolveTxtImpl);
    await stores.merchantApplications.update(verified);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.verify",
      targetType: "merchant_application",
      targetId: verified.id,
      metadata: {
        merchantId: verified.request.id,
        status: verified.verification?.status,
        verificationUrl: verified.verification?.verificationUrl
      }
    });

    res.status(verified.verification?.status === "verified" ? 200 : 409).json({
      application: merchantApplicationView(verified, config),
      verification: merchantApplicationVerificationView(verified.verification),
      nextSteps: merchantApplicationNextSteps(verified, nextStepOptions(config))
    });
  });

  app.post("/v1/merchant-applications/:applicationId/wallet-proof", async (req, res) => {
    const limit = await publicIntakeLimiter.consume(`${publicIntakeKey(req)}:wallet-proof`, {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many merchant application wallet proof attempts. Try again later.",
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    const applicationId = readRouteParam(req.params.applicationId);
    const application = await stores.merchantApplications.get(applicationId);
    if (!application) {
      res.status(404).json({
        error: "merchant_application_not_found",
        message: "Merchant application not found"
      });
      return;
    }
    if (application.status !== "pending") {
      res.status(409).json({
        error: "merchant_application_not_pending",
        message: "Wallet proof can only be attached while the merchant application is pending"
      });
      return;
    }

    const proof = PublisherWalletProofSubmitSchema.parse(req.body ?? {});
    const expectedMessage = buildPublisherWalletProofMessage(application);
    if (proof.message !== expectedMessage) {
      res.status(400).json({
        error: "wallet_proof_message_mismatch",
        message: "Signed message does not match the current merchant application terms",
        expectedMessage
      });
      return;
    }

    const verified = await verifyPublisherWalletProof(application, proof);
    if (!verified.ok) {
      res.status(400).json({
        error: "wallet_proof_invalid",
        message: verified.error,
        expectedAddress: application.request.merchant,
        expectedMessage
      });
      return;
    }

    const walletProof = PublisherWalletProofEvidenceSchema.parse({
      schemaVersion: "sui402.publisher-wallet-proof.v1",
      status: "verified",
      method: "sui-personal-message",
      address: application.request.merchant,
      messageHash: sha256Hash(proof.message),
      signatureHash: sha256Hash(proof.signature),
      applicationId: application.id,
      merchantId: application.request.id,
      network: application.request.network,
      coinType: application.request.coinType,
      price: application.request.price,
      resourceScope: application.request.resourceScope,
      upstreamUrl: application.request.upstreamUrl,
      verifiedAt: new Date().toISOString()
    });
    const updatedApplication: MerchantApplication = {
      ...application,
      metadata: {
        ...application.metadata,
        walletProof
      }
    };
    await stores.merchantApplications.update(updatedApplication);
    await recordAuditEvent(stores, req, res, {
      action: "merchant_application.wallet_proof.verify",
      targetType: "merchant_application",
      targetId: application.id,
      metadata: {
        merchantId: application.request.id,
        address: application.request.merchant,
        messageHash: walletProof.messageHash,
        signatureHash: walletProof.signatureHash,
        verifiedAt: walletProof.verifiedAt
      }
    });

    res.status(200).json({
      application: merchantApplicationView(updatedApplication, config),
      walletProof,
      nextSteps: merchantApplicationNextSteps(updatedApplication, nextStepOptions(config)),
      note: "Wallet proof verifies payout wallet control only. Upstream APIs still require well-known or DNS ownership verification before approval."
    });
  });

  app.get(
    "/v1/merchant-applications",
    requireConsoleRole(config, "merchant_admin"),
    async (req, res) => {
      const query = MerchantApplicationQuerySchema.parse(req.query);
      const applications = await stores.merchantApplications.list(query);
      res.json({
        applications: applications.map((application) => merchantApplicationView(application, config))
      });
    }
  );

  app.post(
    "/v1/merchant-applications/:applicationId/publisher-access-token/rotate",
    requireConsoleRole(config, "merchant_admin"),
    async (req, res) => {
      const applicationId = readRouteParam(req.params.applicationId);
      const application = await stores.merchantApplications.get(applicationId);
      if (!application) {
        res.status(404).json({
          error: "merchant_application_not_found",
          message: "Merchant application not found"
        });
        return;
      }

      if (!application.verification) {
        res.status(409).json({
          error: "publisher_access_token_not_applicable",
          message: "Only upstream-backed publisher applications have publisher access tokens"
        });
        return;
      }

      const previousAccessTokenHash = application.verification.accessToken
        ? privateTokenHash(application.verification.accessToken)
        : undefined;
      const rotated = rotateMerchantApplicationPublisherAccessToken(application);
      await stores.merchantApplications.update(rotated.application);
      await recordAuditEvent(stores, req, res, {
        action: "merchant_application.publisher_access_token.rotate",
        targetType: "merchant_application",
        targetId: rotated.application.id,
        metadata: {
          merchantId: rotated.application.request.id,
          previousAccessTokenHash,
          previousAccessTokenWasMissing: !application.verification.accessToken,
          rotatedAt: rotated.rotatedAt
        }
      });

      res.json({
        application: merchantApplicationView(rotated.application, config),
        publisherAccessToken: rotated.accessToken,
        rotatedAt: rotated.rotatedAt,
        note: "Store publisherAccessToken in a secret manager or SUI402_PUBLISHER_TOKEN. It is returned only for this rotation response."
      });
    }
  );

  app.get("/v1/audit-events", requireConsoleRole(config, "admin"), async (req, res) => {
    const query = ConsoleAuditEventQuerySchema.parse(req.query);
    res.json({
      events: await stores.audit.list(query)
    });
  });

  app.get("/v1/audit-events/verify", requireConsoleRole(config, "admin"), async (req, res) => {
    const query = AuditVerificationQuerySchema.parse(req.query);
    const events = await stores.audit.list({ limit: query.limit });
    res.json(verifyAuditHashChain(events, { allowExternalRoot: true }));
  });

  app.post(
    "/v1/merchant-applications/:applicationId/review",
    requireConsoleRole(config, "merchant_admin"),
    async (req, res) => {
      const parsed = MerchantApplicationReviewSchema.parse(req.body);
      const applicationId = readRouteParam(req.params.applicationId);
      const application = await stores.merchantApplications.get(applicationId);
      if (!application) {
        res.status(404).json({
          error: "merchant_application_not_found",
          message: "Merchant application not found"
        });
        return;
      }

      if (parsed.action === "reject") {
        const reviewed = reviewMerchantApplication(application, parsed);
        await stores.merchantApplications.update(reviewed);
        await recordAuditEvent(stores, req, res, {
          action: "merchant_application.reject",
          targetType: "merchant_application",
          targetId: reviewed.id,
          metadata: {
            merchantId: reviewed.request.id,
            reviewer: reviewed.reviewer,
            reason: reviewed.reviewReason
          }
        });
        res.json({ application: merchantApplicationView(reviewed, config) });
        return;
      }

      if (application.request.upstreamUrl && application.verification?.status !== "verified") {
        res.status(409).json({
          error: "publisher_verification_required",
          message: "Verify publisher control of the upstream URL before approving this application",
          verification: merchantApplicationVerificationView(application.verification)
        });
        return;
      }

      if (await stores.merchants.get(application.request.id)) {
        res.status(409).json({
          error: "merchant_already_exists",
          message: "A gateway merchant with this id already exists"
        });
        return;
      }

      const published = await publishMerchant(stores, config, application.request);
      const reviewed = reviewMerchantApplication(application, parsed, published.merchant.id);
      const reviewEvidence = buildMerchantApplicationReviewEvidence(application);
      await stores.merchantApplications.update(reviewed);
      await recordAuditEvent(stores, req, res, {
        action: "merchant_application.approve",
        targetType: "merchant_application",
        targetId: reviewed.id,
        metadata: {
          merchantId: reviewed.request.id,
          publishedMerchantId: reviewed.publishedMerchantId,
          listingId: published.listing.id,
          reviewer: reviewed.reviewer,
          reviewEvidence
        }
      });
      res.json({ application: merchantApplicationView(reviewed, config), ...published, reviewEvidence });
    }
  );

  app.get("/v1/exports", requireConsoleRole(config, "viewer"), async (_req, res) => {
    res.json({
      exports: await stores.exports.list(100)
    });
  });

  app.get("/v1/exports/:exportId", requireConsoleRole(config, "viewer"), async (req, res) => {
    const exportId = readRouteParam(req.params.exportId);
    const exportRecord = await stores.exports.get(exportId);
    if (!exportRecord) {
      res.status(404).json({
        error: "export_not_found",
        message: "Export not found"
      });
      return;
    }

    res.json({ export: exportRecord });
  });

  app.get("/v1/settlements", requireConsoleRole(config, "viewer"), async (req, res) => {
    const query = SettlementQuerySchema.parse(req.query);
    const [payments, exports] = await Promise.all([stores.payments.listRecent(query.limit), stores.exports.list(100)]);
    res.json(buildSettlementReport({ payments, exports, query }));
  });

  app.get("/v1/settlements.csv", requireConsoleRole(config, "viewer"), async (req, res) => {
    const query = SettlementQuerySchema.parse(req.query);
    const [payments, exports] = await Promise.all([stores.payments.listRecent(query.limit), stores.exports.list(100)]);
    const report = buildSettlementReport({ payments, exports, query });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"sui402-settlements.csv\"");
    res.send(settlementReportToCsv(report));
  });

  app.get("/v1/settlement-reconciliation", requireConsoleRole(config, "viewer"), async (req, res) => {
    const query = SettlementQuerySchema.parse(req.query);
    const [payments, settlementEvents] = await Promise.all([
      stores.payments.listRecent(query.limit),
      stores.settlementEvents.list({ limit: 1000 })
    ]);
    res.json(buildSettlementReconciliationReport({ payments, settlementEvents, query }));
  });

  app.get("/v1/settlement-reconciliation.csv", requireConsoleRole(config, "viewer"), async (req, res) => {
    const query = SettlementQuerySchema.parse(req.query);
    const [payments, settlementEvents] = await Promise.all([
      stores.payments.listRecent(query.limit),
      stores.settlementEvents.list({ limit: 1000 })
    ]);
    const report = buildSettlementReconciliationReport({ payments, settlementEvents, query });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"sui402-settlement-reconciliation.csv\"");
    res.send(settlementReconciliationToCsv(report));
  });

  app.post(
    "/v1/exports/payment-ledger/walrus",
    requireConsoleRole(config, "exporter"),
    async (req, res) => {
      const parsed = PaymentLedgerExportSchema.parse(req.body ?? {});
      const publisherUrl = parsed.publisherUrl ?? config.SUI402_WALRUS_PUBLISHER_URL;
      if (!publisherUrl) {
        res.status(400).json({
          error: "walrus_not_configured",
          message: "Set SUI402_WALRUS_PUBLISHER_URL or pass publisherUrl in the request body"
        });
        return;
      }

      const allPayments = await stores.payments.listRecent(parsed.limit);
      const payments = parsed.merchantId
        ? allPayments.filter((payment) => payment.challenge.metadata?.merchantId === parsed.merchantId)
        : allPayments;
      const networks = [...new Set(payments.map((payment) => payment.challenge.network))];
      const artifact = createWalrusArtifact({
        kind: "audit-log",
        owner: parsed.merchantId ?? "sui402-console",
        network: networks.length === 1 ? networks[0] : undefined,
        contentType: "application/json",
        encrypted: false,
        payload: {
          exportedAt: new Date().toISOString(),
          paymentCount: payments.length,
          payments
        },
        metadata: {
          exportKind: "payment-ledger",
          merchantId: parsed.merchantId,
          limit: parsed.limit
        },
        createdAt: new Date().toISOString()
      });
      const stored = await publishWalrusArtifact({
        publisherUrl,
        artifact,
        epochs: parsed.epochs ?? config.SUI402_WALRUS_EPOCHS,
        fetch: options.fetch
      });
      const exportRecord = {
        id: `${artifact.id}:${stored.blobId}`,
        kind: "payment-ledger" as const,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        blobId: stored.blobId,
        objectId: stored.objectId,
        endEpoch: stored.endEpoch,
        paymentCount: payments.length,
        createdAt: new Date().toISOString(),
        metadata: {
          merchantId: parsed.merchantId,
          publisherUrl
        }
      };

      await stores.exports.record(exportRecord);
      await recordAuditEvent(stores, req, res, {
        action: "export.payment_ledger.publish",
        targetType: "walrus_export",
        targetId: exportRecord.id,
        metadata: {
          blobId: exportRecord.blobId,
          merchantId: parsed.merchantId,
          paymentCount: payments.length
        }
      });
      res.status(201).json({
        export: exportRecord,
        artifact
      });
    }
  );

  app.post(
    "/v1/exports/receipts/walrus",
    requireConsoleRole(config, "exporter"),
    async (req, res) => {
      const parsed = ReceiptBundleExportSchema.parse(req.body ?? {});
      const publisherUrl = parsed.publisherUrl ?? config.SUI402_WALRUS_PUBLISHER_URL;
      if (!publisherUrl) {
        res.status(400).json({
          error: "walrus_not_configured",
          message: "Set SUI402_WALRUS_PUBLISHER_URL or pass publisherUrl in the request body"
        });
        return;
      }

      const allPayments = await stores.payments.listRecent(parsed.limit);
      const payments = parsed.merchantId
        ? allPayments.filter((payment) => payment.challenge.metadata?.merchantId === parsed.merchantId)
        : allPayments;
      const receipts = payments.map((payment) => payment.receipt).filter((receipt) => receipt !== undefined);
      if (receipts.length === 0) {
        res.status(400).json({
          error: "no_receipts",
          message: "No signed receipts are available for the selected payment records"
        });
        return;
      }

      const networks = [...new Set(receipts.map((receipt) => receipt.receipt.network))];
      const artifact = createReceiptBundleArtifact({
        owner: parsed.merchantId ?? "sui402-console",
        network: networks.length === 1 ? networks[0] : undefined,
        receipts,
        metadata: {
          exportKind: "receipt-bundle",
          merchantId: parsed.merchantId,
          paymentCount: payments.length
        }
      });
      const stored = await publishWalrusArtifact({
        publisherUrl,
        artifact,
        epochs: parsed.epochs ?? config.SUI402_WALRUS_EPOCHS,
        fetch: options.fetch
      });
      const exportRecord = {
        id: `${artifact.id}:${stored.blobId}`,
        kind: "receipt-bundle" as const,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        blobId: stored.blobId,
        objectId: stored.objectId,
        endEpoch: stored.endEpoch,
        paymentCount: receipts.length,
        createdAt: new Date().toISOString(),
        metadata: {
          merchantId: parsed.merchantId,
          publisherUrl
        }
      };

      await stores.exports.record(exportRecord);
      await recordAuditEvent(stores, req, res, {
        action: "export.receipts.publish",
        targetType: "walrus_export",
        targetId: exportRecord.id,
        metadata: {
          blobId: exportRecord.blobId,
          merchantId: parsed.merchantId,
          receiptCount: receipts.length
        }
      });
      res.status(201).json({
        export: exportRecord,
        artifact
      });
    }
  );

  app.post(
    "/v1/exports/audit-head/walrus",
    requireConsoleRole(config, "exporter"),
    async (req, res) => {
      const parsed = AuditHeadExportSchema.parse(req.body ?? {});
      const publisherUrl = parsed.publisherUrl ?? config.SUI402_WALRUS_PUBLISHER_URL;
      if (!publisherUrl) {
        res.status(400).json({
          error: "walrus_not_configured",
          message: "Set SUI402_WALRUS_PUBLISHER_URL or pass publisherUrl in the request body"
        });
        return;
      }

      const events = await stores.audit.list({ limit: parsed.limit });
      if (events.length === 0) {
        res.status(400).json({
          error: "no_audit_events",
          message: "No audit events are available to anchor"
        });
        return;
      }

      const verification = verifyAuditHashChain(events, { allowExternalRoot: true });
      if (!verification.ok || !verification.headHash) {
        res.status(409).json({
          error: "audit_chain_invalid",
          message: "Audit hash chain verification failed; refusing to publish an invalid head",
          verification
        });
        return;
      }

      const anchoredAt = new Date().toISOString();
      const artifact = createWalrusArtifact({
        kind: "audit-log",
        owner: "sui402-console",
        contentType: "application/json",
        encrypted: false,
        payload: {
          anchoredAt,
          checked: verification.checked,
          firstEventId: verification.firstEventId,
          lastEventId: verification.lastEventId,
          rootPreviousHash: verification.rootPreviousHash,
          headHash: verification.headHash
        },
        metadata: {
          exportKind: "audit-head",
          privacy: "hash-boundary-only"
        },
        createdAt: anchoredAt
      });
      const stored = await publishWalrusArtifact({
        publisherUrl,
        artifact,
        epochs: parsed.epochs ?? config.SUI402_WALRUS_EPOCHS,
        fetch: options.fetch
      });
      const exportRecord = {
        id: `${artifact.id}:${stored.blobId}`,
        kind: "audit-head" as const,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        blobId: stored.blobId,
        objectId: stored.objectId,
        endEpoch: stored.endEpoch,
        paymentCount: verification.checked,
        createdAt: anchoredAt,
        metadata: {
          publisherUrl,
          firstEventId: verification.firstEventId,
          lastEventId: verification.lastEventId,
          rootPreviousHash: verification.rootPreviousHash,
          headHash: verification.headHash
        }
      };

      await stores.exports.record(exportRecord);
      await recordAuditEvent(stores, req, res, {
        action: "export.audit_head.publish",
        targetType: "walrus_export",
        targetId: exportRecord.id,
        metadata: {
          blobId: exportRecord.blobId,
          anchoredEventCount: verification.checked,
          anchoredHeadHash: verification.headHash
        }
      });
      res.status(201).json({
        export: exportRecord,
        artifact,
        verification
      });
    }
  );

  app.use(
    "/gateway",
    createGatewayRouter({
      merchants: stores.merchants,
      challengeStore: stores.challenges,
      paymentRecords: stores.payments,
      verifierFactory: (merchant) =>
        new Sui402Verifier({
          network: merchant.network,
          grpcUrl: consoleGrpcUrl(config, merchant.network),
          sessionPackageId: merchant.sessionPackageId
        }),
      receiptIssuerFactory,
      adminAuth: requireConsoleRole(config, "merchant_admin"),
      adminApiKey: config.SUI402_CONSOLE_ADMIN_API_KEY
    })
  );
  app.use(
    "/registry",
    createRegistryRouter({
      store: stores.listings,
      adminAuth: requireConsoleRole(config, "merchant_admin"),
      adminApiKey: config.SUI402_CONSOLE_ADMIN_API_KEY
    })
  );

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_request", issues: err.issues });
      return;
    }

    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: "internal_server_error", message });
  });

  return app;
}

export function createConsoleReceiptIssuerFactory(
  config: ConsoleConfig,
  options: {
    sequenceStore?: ReceiptSequenceStore;
    receiptSigner?: SpendReceiptSigner;
  } = {}
): ((merchant: GatewayMerchantConfig) => PaymentReceiptIssuer | undefined) | undefined {
  if (!config.SUI402_RECEIPT_SIGNER_ID) {
    return undefined;
  }

  const sequenceStore = options.sequenceStore ?? new MemoryReceiptSequenceStore();

  if (config.SUI402_RECEIPT_SIGNER_PROVIDER === "external") {
    if (!options.receiptSigner) {
      throw new Error("External receipt signing requires ConsoleAppOptions.receiptSigner");
    }

    return (merchant) =>
      createSessionSpendReceiptIssuer({
        signer: config.SUI402_RECEIPT_SIGNER_ID as string,
        receiptSigner: options.receiptSigner,
        sequenceStore,
        ttlSeconds: config.SUI402_RECEIPT_TTL_SECONDS,
        metadata: ({ challenge, proof }) => ({
          challengeId: challenge.id,
          txDigest: proof.txDigest,
          service: merchant.service,
          merchantId: merchant.id
        })
      });
  }

  const privateKeyPem = config.SUI402_RECEIPT_PRIVATE_KEY_PEM ?? decodePemBase64(config.SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64);
  if (!privateKeyPem) {
    return undefined;
  }

  const privateKey = createPrivateKey(privateKeyPem);
  return (merchant) =>
    createSessionSpendReceiptIssuer({
      signer: config.SUI402_RECEIPT_SIGNER_ID as string,
      privateKey,
      sequenceStore,
      ttlSeconds: config.SUI402_RECEIPT_TTL_SECONDS,
      metadata: ({ challenge, proof }) => ({
        challengeId: challenge.id,
        txDigest: proof.txDigest,
        service: merchant.service,
        merchantId: merchant.id
      })
    });
}

function readRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function readOptionalQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function readOptionalSuiNetwork(value: unknown): Sui402Network | Error | undefined {
  const raw = readOptionalQueryValue(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Sui402NetworkSchema.safeParse(raw);
  return parsed.success ? parsed.data : new Error("network must be one of sui:mainnet, sui:testnet, sui:devnet, or sui:localnet");
}

async function fetchOpenApiDocument(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json, application/openapi+json;q=0.9, */*;q=0.1" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error(`OpenAPI document fetch failed with HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("OpenAPI document must be JSON");
  }
}

class PublisherOpenApiOperationNotFoundError extends Error {
  constructor() {
    super("The selected OpenAPI operation was not found in the imported preview");
  }
}

async function buildPublisherApiDraftPreviewResult(
  draft: PublisherApiDraft,
  config: ConsoleConfig,
  fetchImpl: typeof fetch
): Promise<{
  application: MerchantApplication;
  openApi?: PublisherOpenApiPreview;
  selectedOpenApiEndpoint?: PublisherOpenApiEndpoint;
}> {
  let application = createMerchantApplication(publisherApiDraftToMerchantApplicationSubmit(draft), {
    reviewSlaHours: config.SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS
  });
  let openApi: PublisherOpenApiPreview | undefined;
  let selectedOpenApiEndpoint: PublisherOpenApiEndpoint | undefined;

  if (draft.openApiUrl) {
    const document = await fetchOpenApiDocument(fetchImpl, draft.openApiUrl);
    openApi = buildPublisherOpenApiPreview(document, {
      merchantId: application.request.id,
      sourceUrl: canonicalUrl(draft.openApiUrl)
    });
    selectedOpenApiEndpoint = selectPublisherOpenApiEndpoint(openApi, draft);
    if (hasPublisherOpenApiSelection(draft) && !selectedOpenApiEndpoint) {
      throw new PublisherOpenApiOperationNotFoundError();
    }
    application = {
      ...application,
      request: {
        ...application.request,
        resourceScope:
          selectedOpenApiEndpoint && !draft.resourceScope
            ? selectedOpenApiEndpoint.suggestedResourceScope
            : application.request.resourceScope
      },
      metadata: {
        ...application.metadata,
        openApi,
        ...(selectedOpenApiEndpoint ? { selectedOpenApiEndpoint } : {})
      }
    };
  }

  return { application, openApi, selectedOpenApiEndpoint };
}

function publisherOpenApiPreviewFromMetadata(application: MerchantApplication): PublisherOpenApiPreview | undefined {
  const preview = application.metadata?.openApi;
  const parsed = PublisherOpenApiPreviewSchema.safeParse(preview);
  return parsed.success ? parsed.data : undefined;
}

function publisherOpenApiSelectionFromMetadata(application: MerchantApplication): PublisherOpenApiEndpoint | undefined {
  const selection = application.metadata?.selectedOpenApiEndpoint;
  const parsed = PublisherOpenApiEndpointSchema.safeParse(selection);
  return parsed.success ? parsed.data : undefined;
}

function publisherWalletProofFromMetadata(application: MerchantApplication): z.infer<typeof PublisherWalletProofEvidenceSchema> | undefined {
  const parsed = PublisherWalletProofEvidenceSchema.safeParse(application.metadata?.walletProof);
  return parsed.success ? parsed.data : undefined;
}

function buildPublisherWalletProofMessage(application: MerchantApplication): string {
  return [
    "Sui402 publisher payout wallet proof",
    `applicationId=${application.id}`,
    `merchantId=${application.request.id}`,
    `payoutWallet=${application.request.merchant}`,
    `network=${application.request.network}`,
    `coinType=${application.request.coinType}`,
    `price=${application.request.price}`,
    `resourceScope=${application.request.resourceScope}`,
    `upstreamUrl=${application.request.upstreamUrl ?? "none"}`
  ].join("\n");
}

async function verifyPublisherWalletProof(
  application: MerchantApplication,
  proof: z.infer<typeof PublisherWalletProofSubmitSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const messageBytes = new TextEncoder().encode(proof.message);
    const publicKey = await verifyPersonalMessageSignature(messageBytes, proof.signature, {
      address: application.request.merchant
    });
    const signerAddress = publicKey.toSuiAddress();
    if (signerAddress.toLowerCase() !== application.request.merchant.toLowerCase()) {
      return { ok: false, error: "Signature was valid, but it did not recover the application payout wallet address" };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Wallet proof signature could not be verified"
    };
  }
}

function buildPublisherReviewConfigDraft(
  application: MerchantApplication,
  providerBaseUrl: string | undefined
): PublisherReviewConfigDraft | undefined {
  if (!providerBaseUrl) {
    return undefined;
  }

  const gatewayMerchant = createGatewayMerchantConfig({
    id: application.request.id,
    service: application.request.service,
    network: application.request.network,
    merchant: application.request.merchant,
    coinType: application.request.coinType,
    price: application.request.price,
    resourceScope: application.request.resourceScope,
    upstreamUrl: application.request.upstreamUrl,
    upstreamTimeoutMs: application.request.upstreamTimeoutMs,
    sessionPackageId: application.request.sessionPackageId,
    paymentPolicy: application.request.paymentPolicy,
    metadata: {
      applicationId: application.id,
      reviewOnly: true,
      source: "publisher-api-draft",
      selectedOpenApiEndpoint: application.metadata?.selectedOpenApiEndpoint
    }
  });
  const manifest = createGatewayManifest(gatewayMerchant);
  const registryListing = createListingFromManifest({
    id: application.request.id,
    name: application.request.service,
    providerBaseUrl,
    transport: application.request.transport,
    manifest,
    description: `Publisher-submitted ${application.request.transport.toUpperCase()} API for ${application.request.service}`,
    tags: application.request.transport === "mcp" ? ["mcp", "tools"] : ["api"],
    metadata: {
      applicationId: application.id,
      reviewOnly: true,
      source: "publisher-api-draft",
      selectedOpenApiEndpoint: application.metadata?.selectedOpenApiEndpoint
    }
  });
  const ownershipPassed = !application.verification || application.verification.status === "verified";
  const walletProof = publisherWalletProofFromMetadata(application);
  const operatorReviewPassed = application.status === "approved";

  return {
    publishMode: "review_only",
    gatewayMerchant: { ...gatewayMerchant },
    registryListing: { ...registryListing },
    gates: [
      {
        id: "ownership_verification",
        passed: ownershipPassed,
        label: "Ownership verification",
        description: ownershipPassed
          ? "Publisher ownership proof is verified or not required for this draft."
          : "Publisher must host the well-known proof before operator approval."
      },
      {
        id: "payout_wallet_proof",
        passed: Boolean(walletProof),
        label: "Payout wallet proof",
        description: walletProof
          ? `Payout wallet ${walletProof.address} signed the current application terms.`
          : "Publisher has not attached a Sui personal-message signature from the payout wallet yet."
      },
      {
        id: "operator_review",
        passed: operatorReviewPassed,
        label: "Operator review",
        description: operatorReviewPassed
          ? "Operator review has approved this application."
          : "A merchant operator must review ownership, pricing, wallet, upstream safety, and abuse risk."
      },
      {
        id: "paid_test_evidence",
        passed: false,
        label: "Paid test evidence",
        description: "A real signed paid call is still required after publish before the listing is promoted as ready."
      }
    ]
  };
}

function merchantApplicationView(
  application: MerchantApplication,
  config: ConsoleConfig
): Omit<MerchantApplication, "verification" | "metadata"> & {
  verification?: ReturnType<typeof merchantApplicationVerificationView>;
  walletProof?: z.infer<typeof PublisherWalletProofEvidenceSchema>;
  reviewDraft?: PublisherReviewConfigDraft;
  abuseControls: ReturnType<typeof merchantApplicationAbuseControlsView>;
} {
  const { verification: _verification, metadata: _metadata, ...safeApplication } = application;
  return {
    ...safeApplication,
    verification: merchantApplicationVerificationView(application.verification),
    walletProof: publisherWalletProofFromMetadata(application),
    reviewDraft: buildPublisherReviewConfigDraft(application, config.SUI402_CONSOLE_PROVIDER_BASE_URL),
    abuseControls: merchantApplicationAbuseControlsView(application, config)
  };
}

function merchantApplicationAbuseControlsView(application: MerchantApplication, config: ConsoleConfig) {
  const pendingReviewPath = `/v1/merchant-applications/${encodeURIComponent(application.id)}/review`;
  const publishedMerchantId = application.publishedMerchantId ?? application.request.id;
  return {
    schemaVersion: "sui402.publisher-intake-abuse-controls.v1",
    reviewSlaHours: config.SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS,
    reviewDueAt: application.reviewDueAt,
    status: application.status,
    intakeRateLimit: {
      max: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS
    },
    hostPolicy: {
      allowlistConfigured: Boolean(config.SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS),
      blocklistConfigured: Boolean(config.SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS)
    },
    requiredReviewChecks: [
      "ownership proof is verified before approval for upstream-backed applications",
      "payout wallet proof is attached or explicitly risk-accepted before approval",
      "upstream and OpenAPI hosts pass unsafe-target and allow/block policy",
      "pricing, resource scope, and transport are understandable and not misleading",
      "applicant contact, abuse risk, and support/takedown path are reviewed",
      "paid-test evidence is required before the public listing is promoted as ready"
    ],
    takedown: {
      pendingApplication: {
        method: "POST",
        path: pendingReviewPath,
        body: { action: "reject", reason: "Abuse, unsafe target, or unsupported risk profile" }
      },
      publishedMerchant: {
        method: "PATCH",
        path: `/v1/seller/merchants/${encodeURIComponent(publishedMerchantId)}`,
        body: { status: "paused" },
        note: "Pause the merchant/listing first, then preserve evidence in the audit trail and change-request review."
      }
    },
    escalation: {
      operatorQueuePath: "/v1/merchant-applications?status=pending",
      auditTrailPath: `/v1/audit-events?targetId=${encodeURIComponent(application.id)}`,
      applicantContact: application.applicant?.email ?? "not_provided",
      note: "Escalate suspicious applications to security/compliance before approval; rejection leaves gateway and marketplace state untouched."
    }
  };
}

function merchantApplicationVerificationView(
  verification: MerchantApplication["verification"] | undefined
):
  | {
      method: MerchantApplicationVerification["method"];
      status: MerchantApplicationVerification["status"];
      verificationUrl: string;
      dnsTxtName?: string;
      dnsTxtValue?: string;
      expectedUpstreamUrl: string;
      checkedAt?: string;
      verifiedAt?: string;
      error?: string;
      accessTokenPresent: boolean;
      accessTokenHash?: string;
    }
  | undefined {
  if (!verification) {
    return undefined;
  }

  const { token: _token, accessToken, ...safeVerification } = verification;
  return {
    ...safeVerification,
    accessTokenPresent: Boolean(accessToken),
    accessTokenHash: accessToken ? privateTokenHash(accessToken) : undefined
  };
}

function nextStepOptions(config: ConsoleConfig): { publicBaseUrl?: string } {
  return {
    publicBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL
  };
}

type PublicLinkOptions = {
  publicBaseUrl?: string;
};

type ScanIndexerProgress = {
  eventKind: "session-spend" | "settlement";
  cursorKey: string;
  cursor?: string;
  updatedAt?: string;
  checkpoint?: string;
  eventOffset?: number;
  label: string;
};

function publicLinkOptions(config: ConsoleConfig): PublicLinkOptions {
  return {
    publicBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL
  };
}

async function findScanPayment(
  store: ScanPaymentRecordStore,
  identifier: string,
  network?: Sui402Network
): Promise<PaymentRecord | undefined> {
  const byId = await store.get(identifier);
  if (byId && (!network || byId.proof.network === network)) {
    return byId;
  }

  if (store.getByTxDigest) {
    return store.getByTxDigest(identifier, network);
  }

  const records = store.listRecent ? await store.listRecent(1000) : [];
  return records.find(
    (record) =>
      (record.proof.txDigest === identifier || record.id === identifier) &&
      (!network || record.proof.network === network)
  );
}

async function findScanSettlement(
  store: ScanSettlementIndexStore,
  identifier: string
): Promise<SettlementRecord | undefined> {
  if (store.getByIdentifier) {
    return store.getByIdentifier(identifier);
  }

  const records = await store.list({ limit: 1000 });
  return records.find(
    (event) =>
      event.id === identifier ||
      event.txDigest === identifier ||
      event.ledgerId === identifier ||
      event.receiptId === identifier
  );
}

function buildPublisherApiProbe(
  application: MerchantApplication,
  merchant: GatewayMerchantConfig | undefined,
  listing: Sui402ServiceListing | undefined,
  payments: PaymentRecord[],
  config: ConsoleConfig
): Record<string, unknown> {
  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const applicationApproved = application.status === "approved";
  checks.push({
    name: "application_review",
    ok: applicationApproved,
    message: applicationApproved ? "Application is approved" : "Application is not approved yet"
  });

  checks.push({
    name: "merchant_published",
    ok: Boolean(merchant),
    message: merchant ? "Gateway merchant exists" : "Gateway merchant has not been published"
  });
  checks.push({
    name: "listing_published",
    ok: Boolean(listing),
    message: listing ? "Marketplace listing exists" : "Marketplace listing has not been published"
  });

  let upstreamSafe = true;
  if (merchant?.upstreamUrl) {
    try {
      assertSafeUpstreamUrl(merchant.upstreamUrl);
    } catch (error) {
      upstreamSafe = false;
      checks.push({
        name: "upstream_safety",
        ok: false,
        message: error instanceof Error ? error.message : "Upstream URL failed safety validation"
      });
    }
  }
  if (merchant && upstreamSafe) {
    checks.push({
      name: "upstream_safety",
      ok: true,
      message: merchant.upstreamUrl ? "Upstream URL is safe to proxy" : "No upstream URL configured; gateway will serve a local paid response"
    });
  }

  const active = merchant?.status === "active";
  checks.push({
    name: "merchant_active",
    ok: active,
    message: active ? "Merchant is active" : "Merchant is not active"
  });

  const manifest = merchant ? createGatewayManifest(merchant) : undefined;
  const protectedResourceUrl = merchant
    ? new URL(`/gateway/merchants/${merchant.id}/pay`, config.SUI402_CONSOLE_PROVIDER_BASE_URL).toString()
    : undefined;
  const challengePreview = merchant
    ? createChallenge({
        network: merchant.network,
        recipient: merchant.merchant,
        coinType: merchant.coinType,
        amount: merchant.price,
        resource: merchant.resourceScope,
        description: `${merchant.service} via Sui402 gateway`,
        expiresAt: new Date(Date.now() + merchant.challengeTtlSeconds * 1000).toISOString(),
        metadata: { merchantId: merchant.id, probe: true }
      })
    : undefined;
  const paidTestEvidence = buildPaidTestEvidence({ application, merchant, listing, payments });
  const paidTestCommand =
    merchant && protectedResourceUrl ? `sui402-pay curl ${protectedResourceUrl} --max-one-shot-amount ${merchant.price}` : undefined;

  const gatewayReady = checks.every((check) => check.ok);
  const paidTestCheck = {
    name: "paid_test_observed",
    ok: paidTestEvidence.observed,
    message: paidTestEvidence.observed
      ? "Verified paid test evidence exists"
      : "No verified paid test payment has been recorded for this API"
  };
  checks.push(paidTestCheck);
  const ready = gatewayReady && paidTestEvidence.observed;
  return {
    ready,
    gatewayReady,
    applicationId: application.id,
    merchantId: application.request.id,
    status: application.status,
    checks,
    manifest,
    listing,
    unpaidProbe: merchant
      ? {
          expectedStatus: 402,
          protectedResourceUrl,
          challenge: challengePreview,
          challengeIssued: false,
          note: "This is a readiness preview. A live unpaid request to the protected resource should return HTTP 402 and issue a fresh challenge."
        }
      : undefined,
    paidProbe: {
      supported: paidTestEvidence.observed,
      reason: paidTestEvidence.observed
        ? "Verified paid call evidence exists for this published API."
        : "No verified paid call evidence has been recorded yet. Run a real paid testnet call with a payer wallet before public launch.",
      evidence: paidTestEvidence,
      nextAction:
        merchant && protectedResourceUrl && paidTestCommand
          ? {
              label: paidTestEvidence.observed ? "Repeat paid test call" : "Run paid test call",
              command: paidTestCommand,
              note: `Use a local non-custodial Sui wallet on ${merchant.network}. This command caps fallback one-shot spend at the listed API price.`
            }
          : undefined
    },
    paidTestWizard: buildPaidTestWizard({
      application,
      merchant,
      listing,
      protectedResourceUrl,
      paidTestCommand,
      paidTestEvidence,
      gatewayReady,
      publicBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL
    })
  };
}

function buildPaidTestWizard(input: {
  application: MerchantApplication;
  merchant?: GatewayMerchantConfig;
  listing?: Sui402ServiceListing;
  protectedResourceUrl?: string;
  paidTestCommand?: string;
  paidTestEvidence: ReturnType<typeof buildPaidTestEvidence>;
  gatewayReady: boolean;
  publicBaseUrl?: string;
}): Record<string, unknown> {
  const token = input.application.verification?.accessToken;
  const probeUrl = publisherPublicRoute(input.publicBaseUrl, `/v1/publisher/apis/${input.application.id}/probe`);
  const statusUrl = publisherPublicRoute(input.publicBaseUrl, `/v1/publisher/apis/${input.application.id}/status`);
  const published = Boolean(input.merchant && input.listing);
  const paidObserved = input.paidTestEvidence.observed;
  const currentGate = paidObserved
    ? "complete"
    : !input.gatewayReady
      ? "publish_gateway_listing"
      : "run_paid_test";

  return {
    schemaVersion: "sui402.publisher-paid-test-wizard.v1",
    title: "Publisher paid-test wizard",
    readyForPublicLaunch: input.gatewayReady && paidObserved,
    currentGate,
    summary: paidObserved
      ? "Verified paid-test evidence has been observed. Repeat the paid test after any wallet, price, network, or upstream change."
      : published
        ? "Gateway and listing are published. Run the paid test command from a local non-custodial payer wallet, then rerun the probe."
        : "Finish ownership verification and operator review before running a paid test against the gateway.",
    commands: {
      checkStatus: publisherStatusCurl(statusUrl, token),
      rerunProbe: publisherProbeCurl(probeUrl, token),
      unpaidChallenge: input.protectedResourceUrl ? `curl -i "${input.protectedResourceUrl}"` : undefined,
      paidCall: input.paidTestCommand,
      inspectMarketplace: input.listing ? `sui402-pay marketplace detail ${input.listing.id}` : undefined,
      scanMerchant: input.merchant ? `sui402-pay scan merchant ${input.merchant.id}` : undefined
    },
    steps: [
      {
        id: "publish_or_verify",
        label: "Verify ownership and publish gateway/listing",
        status: published ? "done" : "current",
        description: published
          ? "The gateway merchant and marketplace listing exist."
          : "Host the publisher verification document, run verification, and wait for operator approval."
      },
      {
        id: "confirm_unpaid_402",
        label: "Confirm unpaid request returns HTTP 402",
        status: !published ? "blocked" : input.gatewayReady ? "done" : "current",
        description: "The protected resource should issue a fresh challenge before any paid request is sent.",
        command: input.protectedResourceUrl ? `curl -i "${input.protectedResourceUrl}"` : undefined
      },
      {
        id: "run_paid_call",
        label: "Run a capped paid call",
        status: !published || !input.gatewayReady ? "blocked" : paidObserved ? "done" : "current",
        description:
          "Run this from a funded user-owned Sui wallet. Sui402 does not custody payer funds or fake paid-test evidence.",
        command: input.paidTestCommand
      },
      {
        id: "rerun_probe",
        label: "Rerun readiness probe",
        status: paidObserved ? "done" : input.gatewayReady ? "current" : "blocked",
        description: "The probe turns ready only after verified payment evidence is indexed for this API.",
        command: publisherProbeCurl(probeUrl, token)
      }
    ],
    safety: [
      "Uses a local non-custodial payer wallet.",
      "Caps one-shot fallback spend at the listed API price.",
      "Does not prove legal/KYB fitness, uptime, refundability, or external audit.",
      "Repeat after wallet, price, coin, network, upstream, or resource-scope changes."
    ]
  };
}

function publisherTokenHeader(token: string | undefined): string {
  return token ? ` -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN"` : "";
}

function publisherStatusCurl(url: string, token: string | undefined): string {
  return `curl${publisherTokenHeader(token)} "${url}"`;
}

function publisherProbeCurl(url: string, token: string | undefined): string {
  return `curl -X POST${publisherTokenHeader(token)} "${url}"`;
}

function publisherPublicRoute(baseUrl: string | undefined, pathname: string, query: Record<string, string> = {}): string {
  const route = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const search = new URLSearchParams(query).toString();
  if (!baseUrl) {
    return `${route}${search ? `?${search}` : ""}`;
  }

  const url = new URL(route, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildPaidTestEvidence(input: {
  application: MerchantApplication;
  merchant?: GatewayMerchantConfig;
  listing?: Sui402ServiceListing;
  payments: PaymentRecord[];
}): {
  requiredForPublicLaunch: boolean;
  observed: boolean;
  status: "observed" | "missing" | "not_published";
  verifiedPayments: number;
  sessionPayments: number;
  volume: string;
  recentPayments: Array<Record<string, unknown>>;
} {
  const { merchant, listing, payments } = input;
  if (!merchant || !listing) {
    return {
      requiredForPublicLaunch: true,
      observed: false,
      status: "not_published",
      verifiedPayments: 0,
      sessionPayments: 0,
      volume: "0",
      recentPayments: []
    };
  }

  const matchedPayments = payments.filter((payment) => paymentBelongsToListing(payment, listing));
  return {
    requiredForPublicLaunch: true,
    observed: matchedPayments.length > 0,
    status: matchedPayments.length > 0 ? "observed" : "missing",
    verifiedPayments: matchedPayments.length,
    sessionPayments: matchedPayments.filter((payment) => payment.proof.kind === "session").length,
    volume: sumPaymentAmounts(matchedPayments).toString(),
    recentPayments: matchedPayments.slice(0, 5).map((payment) => ({
      digest: payment.proof.txDigest,
      displayDigest: shortDigest(payment.proof.txDigest),
      kind: payment.proof.kind,
      amount: payment.challenge.amount,
      coinType: payment.challenge.coinType,
      resource: payment.resource,
      createdAt: payment.createdAt
    }))
  };
}

function buildMerchantApplicationReviewEvidence(application: MerchantApplication): Record<string, unknown> {
  const walletProof = publisherWalletProofFromMetadata(application);
  return {
    ownershipVerification: {
      required: Boolean(application.request.upstreamUrl),
      verified: !application.request.upstreamUrl || application.verification?.status === "verified",
      method: application.verification?.method,
      verificationUrl: application.verification?.verificationUrl
    },
    payoutWalletProof: {
      required: true,
      verified: Boolean(walletProof),
      method: walletProof?.method,
      address: walletProof?.address ?? application.request.merchant,
      verifiedAt: walletProof?.verifiedAt,
      messageHash: walletProof?.messageHash
    },
    upstreamSafety: {
      checked: Boolean(application.request.upstreamUrl),
      safe: true,
      upstreamUrl: application.request.upstreamUrl
    },
    paidTest: {
      requiredForPublicLaunch: true,
      status: "pending_post_publish",
      message: "Approval publishes the gateway/listing. Run the publisher probe after a real paid test call to attach verified payment evidence before public launch."
    }
  };
}

function consoleGrpcUrl(config: ConsoleConfig, network: GatewayMerchantConfig["network"]): string | undefined {
  switch (network) {
    case "sui:mainnet":
      return config.SUI402_CONSOLE_MAINNET_GRPC_URL;
    case "sui:testnet":
      return config.SUI402_CONSOLE_TESTNET_GRPC_URL;
    case "sui:devnet":
      return config.SUI402_CONSOLE_DEVNET_GRPC_URL;
    case "sui:localnet":
      return config.SUI402_CONSOLE_LOCALNET_GRPC_URL;
  }
}

async function recordAuditEvent(
  stores: ConsoleStores,
  req: express.Request,
  res: express.Response,
  input: {
    action: ConsoleAuditAction;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const operator = res.locals.sui402Operator as { id: string; roles: ConsoleRole[] } | undefined;
  const seller = res.locals.sui402Seller as { id: string; roles: ConsoleSellerRole[]; merchantIds: string[] } | undefined;
  const eventInput = {
    action: input.action,
    actorId: operator?.id ?? seller?.id,
    actorRoles: operator?.roles ?? seller?.roles,
    targetType: input.targetType,
    targetId: input.targetId,
    requestId: req.header("x-request-id") ?? undefined,
    ip: req.ip,
    userAgent: req.header("user-agent") ?? undefined,
    metadata: input.metadata
  } satisfies Parameters<typeof createConsoleAuditEvent>[0];
  if (stores.audit.append) {
    await stores.audit.append(eventInput);
    return;
  }

  const previous = (await stores.audit.list({ limit: 1 }))[0];
  await stores.audit.record(createChainedConsoleAuditEvent(eventInput, previous));
}

async function buildOverview(
  stores: ConsoleStores,
  mode: ConsoleOverview["mode"],
  config: ConsoleConfig
): Promise<ConsoleOverview> {
  const storageDriver = config.SUI402_CONSOLE_STORAGE_DRIVER;
  const merchants = await stores.merchants.list();
  const listings = await stores.listings.list();
  const payments = await stores.payments.listRecent(20);
  const indexedSessionSpends = await stores.sessionSpends.list({ limit: 500 });
  const indexedSessions = aggregateSessionSpends(indexedSessionSpends);
  const indexedSettlementEvents = await stores.settlementEvents.list({ limit: 500 });
  const exports = await stores.exports.list(10);
  const merchantApplications = await stores.merchantApplications.list({ limit: 20 });
  const merchantChangeRequests = await stores.merchantChangeRequests.list({ limit: 20 });
  const auditEvents = await stores.audit.list({ limit: 10 });
  const settlementReport = buildSettlementReport({
    payments,
    exports,
    query: { limit: 20 }
  });
  const settlementReconciliation = buildSettlementReconciliationReport({
    payments,
    settlementEvents: indexedSettlementEvents,
    query: { limit: 20 }
  });
  const sessionPayments = payments.filter((payment) => payment.proof.kind === "session");

  return {
    mode,
    kpis: {
      verifiedPayments: payments.length,
      activeMerchants: merchants.filter((merchant) => merchant.status === "active").length,
      sessionVolume: sessionPayments.length,
      indexedSessionSpends: indexedSessionSpends.length,
      indexedSessions: indexedSessions.length,
      indexedSettlementEvents: indexedSettlementEvents.length
    },
    payments: payments.map(paymentToRow),
    readiness: [
      { label: "Provider manifest", value: `${listings.length} published`, status: "ready" },
      { label: "Replay protection", value: "Payment ledger enabled", status: "ready" },
      { label: "Storage readiness", value: storageDriver === "file" ? "File store" : "Memory stores", status: "active" },
      { label: "Audit status", value: "External review pending", status: "warn" }
    ],
    merchants,
    listings,
    exports,
    merchantApplications: merchantApplications.map((application) => merchantApplicationView(application, config)),
    merchantChangeRequests,
    settlements: settlementReport.summaries,
    settlementCaveats: [...SETTLEMENT_OPERATIONAL_CAVEATS],
    settlementReconciliation: settlementReconciliation.summary,
    auditEvents
  };
}

async function publishMerchant(
  stores: ConsoleStores,
  config: ConsoleConfig,
  parsed: z.infer<typeof MerchantCreateSchema>
): Promise<{
  merchant: GatewayMerchantConfig;
  listing: Sui402ServiceListing;
  manifest: ReturnType<typeof createGatewayManifest>;
}> {
  const merchant = createGatewayMerchantConfig({
    id: parsed.id,
    service: parsed.service,
    network: parsed.network,
    merchant: parsed.merchant,
    coinType: parsed.coinType,
    price: parsed.price,
    resourceScope: parsed.resourceScope,
    upstreamUrl: parsed.upstreamUrl,
    upstreamTimeoutMs: parsed.upstreamTimeoutMs,
    sessionPackageId: parsed.sessionPackageId,
    paymentPolicy: parsed.paymentPolicy
  });
  const manifest = createGatewayManifest(merchant);
  const listing = createListingFromManifest({
    id: merchant.id,
    name: merchant.service,
    providerBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL,
    transport: parsed.transport,
    manifest,
    tags: parsed.transport === "mcp" ? ["mcp", "tools"] : ["api"]
  });

  await stores.merchants.upsert(merchant);
  await stores.listings.upsert(listing);

  return { merchant, listing, manifest };
}

async function applyMerchantChangeRequest(
  stores: ConsoleStores,
  config: ConsoleConfig,
  merchant: GatewayMerchantConfig,
  request: MerchantChangeRequest
): Promise<{
  merchant: GatewayMerchantConfig;
  listing: Sui402ServiceListing;
  manifest: ReturnType<typeof createGatewayManifest>;
}> {
  const updated = createGatewayMerchantConfig({
    ...merchant,
    merchant: request.changes.merchant ?? merchant.merchant,
    network: request.changes.network ?? merchant.network,
    coinType: request.changes.coinType ?? merchant.coinType
  });
  const existingListing = await stores.listings.get(merchant.id);
  const manifest = createGatewayManifest(updated);
  const listing: Sui402ServiceListing = {
    ...createListingFromManifest({
      id: updated.id,
      name: updated.service,
      description: existingListing?.description,
      providerBaseUrl: config.SUI402_CONSOLE_PROVIDER_BASE_URL,
      transport: existingListing?.transport ?? (updated.resourceScope.startsWith("mcp:") ? "mcp" : "http"),
      manifest,
      tags: existingListing?.tags ?? (updated.resourceScope.startsWith("mcp:") ? ["mcp", "tools"] : ["api"]),
      metadata: existingListing?.metadata
    }),
    status: updated.status
  };

  await stores.merchants.upsert(updated);
  await stores.listings.upsert(listing);

  return { merchant: updated, listing, manifest };
}

function merchantChangeFields(
  merchant: GatewayMerchantConfig,
  changes: MerchantChangeRequest["changes"]
): Array<keyof MerchantChangeRequest["changes"]> {
  const fields: Array<keyof MerchantChangeRequest["changes"]> = [];
  if (changes.merchant !== undefined && changes.merchant !== merchant.merchant) {
    fields.push("merchant");
  }
  if (changes.network !== undefined && changes.network !== merchant.network) {
    fields.push("network");
  }
  if (changes.coinType !== undefined && changes.coinType !== merchant.coinType) {
    fields.push("coinType");
  }
  return fields;
}

function merchantChangePreviousValues(
  merchant: GatewayMerchantConfig,
  fields: Array<keyof MerchantChangeRequest["changes"]>
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, merchant[field]]));
}

async function verifyMerchantApplication(
  application: MerchantApplication,
  fetchImpl: typeof fetch,
  resolveTxtImpl: (hostname: string) => Promise<string[][]>
): Promise<MerchantApplication> {
  const verification = application.verification;
  if (!verification) {
    return application;
  }

  const checkedAt = new Date().toISOString();
  try {
    assertSafeUpstreamUrl(verification.verificationUrl);
    assertSafeUpstreamUrl(verification.expectedUpstreamUrl);
  } catch (error) {
    return applicationWithVerificationFailure(
      application,
      checkedAt,
      error instanceof Error ? error.message : "Publisher verification URL is unsafe"
    );
  }

  const wellKnown = await verifyMerchantApplicationWellKnown(application, fetchImpl);
  if (wellKnown.ok) {
    return applicationWithVerificationSuccess(application, checkedAt, "well-known");
  }

  const dnsTxt = await verifyMerchantApplicationDnsTxt(application, resolveTxtImpl);
  if (dnsTxt.ok) {
    return applicationWithVerificationSuccess(application, checkedAt, "dns-txt");
  }

  return applicationWithVerificationFailure(
    application,
    checkedAt,
    `Well-known verification failed: ${wellKnown.error}; DNS TXT verification failed: ${dnsTxt.error}`
  );
}

async function verifyMerchantApplicationWellKnown(
  application: MerchantApplication,
  fetchImpl: typeof fetch
): Promise<{ ok: true } | { ok: false; error: string }> {
  const verification = application.verification;
  if (!verification) {
    return { ok: true };
  }

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      verification.verificationUrl,
      {
        headers: {
          accept: "application/json"
        },
        redirect: "error"
      },
      10_000
    );
    if (!response.ok) {
      return { ok: false, error: `Verification document returned HTTP ${response.status}` };
    }

    const document = PublisherVerificationDocumentSchema.parse(await response.json());
    if (
      document.applicationId !== application.id ||
      document.merchantId !== application.request.id ||
      canonicalUrl(document.upstreamUrl) !== verification.expectedUpstreamUrl ||
      (document.verificationToken ?? document.token) !== verification.token
    ) {
      return { ok: false, error: "Verification document did not match application" };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Publisher well-known verification failed" };
  }
}

async function verifyMerchantApplicationDnsTxt(
  application: MerchantApplication,
  resolveTxtImpl: (hostname: string) => Promise<string[][]>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const verification = application.verification;
  if (!verification) {
    return { ok: true };
  }
  if (!verification.dnsTxtName || !verification.dnsTxtValue) {
    return { ok: false, error: "No DNS TXT verification challenge is configured" };
  }

  try {
    const records = await resolveTxtImpl(verification.dnsTxtName);
    const values = records.map((record) => record.join(""));
    if (!values.includes(verification.dnsTxtValue)) {
      return { ok: false, error: `DNS TXT ${verification.dnsTxtName} did not contain the expected Sui402 value` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Publisher DNS TXT verification failed" };
  }
}

function applicationWithVerificationSuccess(
  application: MerchantApplication,
  checkedAt: string,
  method: "well-known" | "dns-txt"
): MerchantApplication {
  if (!application.verification) {
    return application;
  }

  return {
    ...application,
    verification: MerchantApplicationVerificationSchema.parse({
      ...application.verification,
      method,
      status: "verified",
      checkedAt,
      verifiedAt: checkedAt,
      error: undefined
    })
  };
}

function applicationWithVerificationFailure(
  application: MerchantApplication,
  checkedAt: string,
  error: string
): MerchantApplication {
  if (!application.verification) {
    return application;
  }

  return {
    ...application,
    verification: MerchantApplicationVerificationSchema.parse({
      ...application.verification,
      status: "failed",
      checkedAt,
      error
    })
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function paymentToRow(payment: PaymentRecord): ConsoleOverview["payments"][number] {
  return {
    merchant: String(payment.challenge.metadata?.merchantId ?? "merchant"),
    resource: payment.resource,
    network: payment.challenge.network.replace("sui:", ""),
    amount: formatAmount(payment.challenge.amount, payment.challenge.coinType),
    status: payment.proof.kind === "session" ? "session" : "verified",
    digest: shortDigest(payment.proof.txDigest)
  };
}

function sellerMerchantView(merchant: GatewayMerchantConfig): Record<string, unknown> {
  return {
    id: merchant.id,
    service: merchant.service,
    network: merchant.network,
    merchant: merchant.merchant,
    coinType: merchant.coinType,
    price: merchant.price,
    resourceScope: merchant.resourceScope,
    upstreamUrl: merchant.upstreamUrl,
    upstreamTimeoutMs: merchant.upstreamTimeoutMs,
    sessionPackageId: merchant.sessionPackageId,
    status: merchant.status,
    sessionsEnabled: Boolean(merchant.sessionPackageId)
  };
}

function marketplaceListingToApi(
  listing: Sui402ServiceListing,
  payments: PaymentRecord[],
  merchant?: GatewayMerchantConfig,
  links: PublicLinkOptions = {}
): Record<string, unknown> {
  const listingPayments = payments.filter((payment) => paymentBelongsToListing(payment, listing));
  const reliability = marketplaceReliability(listingPayments);
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    transport: listing.transport,
    network: listing.network,
    merchant: listing.merchant,
    coinType: listing.coinType,
    price: listing.price,
    resourceScope: listing.resourceScope,
    sessionSupported: listing.sessionSupported,
    protectedResourceUrl: listing.protectedResourceUrl,
    sessionManagerUrl: listing.sessionManagerUrl,
    tags: listing.tags,
    status: listing.status,
    updatedAt: listing.updatedAt,
    readiness: marketplaceListingReadiness(listing, listingPayments, merchant),
    links: marketplaceApiLinks(listing.id, links),
    commands: marketplaceAgentCommands(listing),
    paymentPlan: marketplaceAgentPaymentPlan(listing),
    stats: {
      verifiedPayments: listingPayments.length,
      sessionPayments: listingPayments.filter((payment) => payment.proof.kind === "session").length,
      volume: sumPaymentAmounts(listingPayments).toString()
    },
    reliability
  };
}

function marketplaceListingToDetail(input: {
  listing: Sui402ServiceListing;
  merchant?: GatewayMerchantConfig;
  payments: PaymentRecord[];
  links?: PublicLinkOptions;
}): Record<string, unknown> {
  const { listing, merchant, payments, links = {} } = input;
  const api = marketplaceListingToApi(listing, payments, merchant, links);
  const readiness = marketplaceListingReadiness(listing, payments, merchant);
  const recentPayments = recentPublicPayments(payments, links, 10);

  return {
    schemaVersion: "sui402.marketplace.api.v1",
    generatedAt: new Date().toISOString(),
    dataSource: "console-api",
    api,
    merchant: merchant
      ? {
          id: merchant.id,
          service: merchant.service,
          network: merchant.network,
          merchant: merchant.merchant,
          coinType: merchant.coinType,
          price: merchant.price,
          resourceScope: merchant.resourceScope,
          status: merchant.status,
          sessionsEnabled: Boolean(merchant.sessionPackageId)
        }
      : undefined,
    trust: {
      listingPublished: listing.status === "active",
      merchantPublished: Boolean(merchant),
      upstreamConfigured: Boolean(merchant?.upstreamUrl || listing.protectedResourceUrl || listing.mcpServerUrl),
      sessionsEnabled: Boolean(merchant?.sessionPackageId ?? listing.sessionSupported)
    },
    readiness,
    commands: marketplaceAgentCommands(listing),
    paymentPlan: marketplaceAgentPaymentPlan(listing),
    stats: {
      verifiedPayments: payments.length,
      sessionPayments: payments.filter((payment) => payment.proof.kind === "session").length,
      volume: sumPaymentAmounts(payments).toString()
    },
    reliability: marketplaceReliability(payments, recentPayments.length),
    recentPayments,
    links: {
      protectedResourceUrl: listing.protectedResourceUrl,
      sessionManagerUrl: listing.sessionManagerUrl,
      ...marketplaceApiLinks(listing.id, links)
    }
  };
}

function marketplaceAgentCommands(listing: Sui402ServiceListing): Record<string, string> {
  const commands: Record<string, string> = {
    curl: marketplaceCurlCommand(listing),
    search: `sui402-pay search ${listing.name}`,
    scan: `sui402-pay scan merchant ${listing.id}`
  };

  if (listing.protectedResourceUrl && listing.sessionSupported) {
    commands.sessionOnly = `sui402-pay curl ${listing.protectedResourceUrl} --session-only`;
  }

  if (listing.sessionSupported) {
    commands.sessionInspect = `sui402-pay session inspect --merchant ${listing.merchant} --resource ${listing.resourceScope} --amount ${listing.price}`;
  }

  return commands;
}

function marketplaceCurlCommand(listing: Sui402ServiceListing): string {
  if (!listing.protectedResourceUrl) {
    return `sui402-pay search ${listing.name}`;
  }

  return `sui402-pay curl ${listing.protectedResourceUrl} --max-one-shot-amount ${listing.price}`;
}

function marketplaceAgentPaymentPlan(listing: Sui402ServiceListing): Record<string, unknown> {
  return {
    custody: "user_owned",
    authorizationMode: "live_402_challenge_plus_local_policy",
    network: listing.network,
    merchant: listing.merchant,
    coinType: listing.coinType,
    amountAtomic: listing.price,
    maxOneShotAmount: listing.price,
    resourceScope: listing.resourceScope,
    resourceScopeHash: listing.resourceScopeHash,
    protectedResourceUrl: listing.protectedResourceUrl,
    sessionSupported: listing.sessionSupported,
    sessionBehavior: listing.sessionSupported ? "session_first_with_capped_one_shot_fallback" : "capped_one_shot",
    sessionManagerUrl: listing.sessionManagerUrl,
    notes: [
      "The command caps one-shot fallback at the listed atomic price.",
      listing.sessionSupported
        ? "When a matching funded user-owned session exists, sui402-pay curl uses it before capped one-shot fallback."
        : "No session support is advertised; use capped one-shot payment only.",
      "The live 402 challenge must still match network, merchant, coin type, amount, and resource scope before signing."
    ]
  };
}

function marketplaceReliability(payments: PaymentRecord[], recentIndexedPayments = Math.min(payments.length, 10)): Record<string, unknown> {
  const observedAt = payments.map(paymentObservedAt).filter((value): value is string => Boolean(value)).sort();
  const firstVerifiedPaymentAt = observedAt[0];
  const lastVerifiedPaymentAt = observedAt.at(-1);
  const sessionPayments = payments.filter((payment) => payment.proof.kind === "session").length;
  const notes: string[] = [];

  if (payments.length === 0) {
    notes.push("No verified paid-call evidence has been indexed for this listing yet.");
  } else {
    notes.push("Verified payment records exist in the public scan index.");
  }

  if (sessionPayments === 0) {
    notes.push("No session spend has been observed for this listing yet.");
  }

  return {
    paidTestObserved: payments.length > 0,
    verifiedPayments: payments.length,
    sessionPayments,
    oneShotPayments: payments.length - sessionPayments,
    recentIndexedPayments,
    firstVerifiedPaymentAt,
    lastVerifiedPaymentAt,
    evidenceWindow:
      firstVerifiedPaymentAt && lastVerifiedPaymentAt
        ? {
            from: firstVerifiedPaymentAt,
            to: lastVerifiedPaymentAt,
            payments: payments.length
          }
        : undefined,
    notes
  };
}

function marketplaceListingReadiness(
  listing: Sui402ServiceListing,
  payments: PaymentRecord[],
  merchant?: GatewayMerchantConfig
): {
  ready: boolean;
  level: "ready" | "needs_review" | "paused";
  reasons: string[];
  checks: Array<{ name: string; ok: boolean; message: string }>;
} {
  const endpointConfigured = Boolean(listing.protectedResourceUrl || listing.mcpServerUrl || merchant?.upstreamUrl);
  const paidTestObserved = payments.length > 0;
  const merchantTermsMatch = merchant
    ? merchant.network === listing.network &&
      merchant.merchant.toLowerCase() === listing.merchant.toLowerCase() &&
      merchant.coinType === listing.coinType &&
      merchant.price === listing.price &&
      merchant.resourceScope === listing.resourceScope
    : false;
  const sessionsConsistent = !listing.sessionSupported || Boolean(merchant?.sessionPackageId || listing.sessionManagerUrl);
  const checks = [
    {
      name: "listing_active",
      ok: listing.status === "active",
      message: listing.status === "active" ? "Listing is active" : "Listing is paused"
    },
    {
      name: "merchant_published",
      ok: Boolean(merchant),
      message: merchant ? "Gateway merchant exists" : "Gateway merchant is missing"
    },
    {
      name: "merchant_active",
      ok: merchant?.status === "active",
      message: merchant?.status === "active" ? "Gateway merchant is active" : "Gateway merchant is not active"
    },
    {
      name: "payment_terms_match",
      ok: merchantTermsMatch,
      message: merchantTermsMatch ? "Listing and merchant payment terms match" : "Listing and merchant payment terms are not aligned"
    },
    {
      name: "protected_access",
      ok: endpointConfigured,
      message: endpointConfigured ? "Protected resource or MCP endpoint is configured" : "No protected access endpoint is configured"
    },
    {
      name: "session_config",
      ok: sessionsConsistent,
      message: sessionsConsistent ? "Session metadata is consistent" : "Listing advertises sessions without a session manager/package"
    },
    {
      name: "paid_test_observed",
      ok: paidTestObserved,
      message: paidTestObserved
        ? "Verified paid test evidence exists"
        : "No verified paid test payment has been recorded for this listing"
    }
  ];
  const reasons = checks.filter((check) => !check.ok).map((check) => check.message);
  const ready = reasons.length === 0;
  return {
    ready,
    level: ready ? "ready" : listing.status === "paused" ? "paused" : "needs_review",
    reasons,
    checks
  };
}

function buildPublicScanStats(input: {
  listings: Sui402ServiceListing[];
  payments: PaymentRecord[];
  sessionSpendCount: number;
  links?: PublicLinkOptions;
}): Record<string, unknown> {
  const activeListings = input.listings.filter((listing) => listing.status === "active");
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      apis: input.listings.length,
      activeApis: activeListings.length,
      sellers: new Set(input.listings.map((listing) => listing.merchant.toLowerCase())).size,
      verifiedPayments: input.payments.length,
      sessionPayments: input.payments.filter((payment) => payment.proof.kind === "session").length,
      indexedSessionSpends: input.sessionSpendCount
    },
    networks: countBy(input.listings, (listing) => listing.network),
    transports: countBy(input.listings, (listing) => listing.transport),
    coins: countBy(input.listings, (listing) => listing.coinType),
    volumeByCoin: sumPaymentsBy(input.payments, (payment) => payment.challenge.coinType),
    links: scanStatsLinks(input.links ?? {}),
    recentPayments: input.payments.slice(0, 10).map((payment) => ({
      merchantId: payment.challenge.metadata?.merchantId,
      network: payment.challenge.network,
      coinType: payment.challenge.coinType,
      amount: payment.challenge.amount,
      resource: payment.resource,
      kind: payment.proof.kind,
      digest: payment.proof.txDigest,
      displayDigest: shortDigest(payment.proof.txDigest),
      evidence: paymentScanEvidence(payment),
      links: scanPaymentLinks(payment.proof.txDigest, input.links ?? {})
    }))
  };
}

function paymentToPublicScanRecord(payment: PaymentRecord, links: PublicLinkOptions = {}): Record<string, unknown> {
  return {
    id: payment.id,
    digest: payment.proof.txDigest,
    network: payment.challenge.network,
    kind: payment.proof.kind,
    challengeId: payment.challenge.id,
    merchantId: payment.challenge.metadata?.merchantId,
    recipient: payment.challenge.recipient,
    coinType: payment.challenge.coinType,
    amount: payment.challenge.amount,
    resource: payment.resource,
    createdAt: payment.createdAt,
    sessionId: payment.proof.kind === "session" ? payment.proof.sessionId : undefined,
    evidence: paymentScanEvidence(payment),
    links: scanPaymentLinks(payment.proof.txDigest, links, payment.challenge.metadata?.merchantId),
    receipt: payment.receipt
      ? {
          id: payment.receipt.receipt.id,
          signer: payment.receipt.signer,
          sequence: payment.receipt.receipt.sequence,
          expiresAt: payment.receipt.receipt.expiresAt
        }
      : undefined
  };
}

function recentPublicPayments(payments: PaymentRecord[], links: PublicLinkOptions = {}, limit = 10): Array<Record<string, unknown>> {
  return [...payments]
    .sort((left, right) => (paymentObservedAt(right) ?? "").localeCompare(paymentObservedAt(left) ?? ""))
    .slice(0, limit)
    .map((payment) => paymentToPublicScanRecord(payment, links));
}

function paymentObservedAt(payment: PaymentRecord): string | undefined {
  if (payment.createdAt) {
    return payment.createdAt;
  }

  if ("paidAt" in payment.proof) {
    return payment.proof.paidAt;
  }

  if ("spentAt" in payment.proof) {
    return payment.proof.spentAt;
  }

  return undefined;
}

function sessionSpendsToPublicScanSession(
  sessionId: string,
  records: SessionSpendRecord[],
  links: PublicLinkOptions = {},
  indexerProgress?: ScanIndexerProgress
): Record<string, unknown> {
  const sorted = [...records].sort((left, right) => Date.parse(right.indexedAt) - Date.parse(left.indexedAt));
  const first = sorted[sorted.length - 1];
  const latest = sorted[0];
  const spentAmount = records.reduce((total, record) => total + BigInt(record.amount), 0n).toString();

  return {
    sessionId,
    network: latest?.network,
    packageId: latest?.packageId,
    coinType: latest?.coinType,
    payerHash: latest?.payer ? publicIdentityHash(latest.payer) : undefined,
    identityRedaction: {
      payer: latest?.payer ? "redacted_with_stable_hash" : "not_indexed"
    },
    merchant: latest?.merchant,
    spendCount: records.length,
    spentAmount,
    spentTotal: latest?.spentTotal,
    resourceScopeHashes: [...new Set(records.map((record) => record.resourceScopeHash))],
    firstSeenAt: first?.indexedAt,
    lastSeenAt: latest?.indexedAt,
    lastTxDigest: latest?.txDigest,
    evidence: latest
      ? {
          class: "onchain_indexed",
          source: "sui402_indexer",
          publicIdentifier: latest.txDigest,
          eventSeq: latest.eventSeq,
          indexedAt: latest.indexedAt
        }
      : undefined,
    indexerProgress,
    links: scanSessionLinks(sessionId, links),
    spends: sorted.slice(0, 25).map(sessionSpendToPublicScanRecord)
  };
}

function sessionSpendToPublicScanRecord(record: SessionSpendRecord): Record<string, unknown> {
  return {
    id: record.id,
    network: record.network,
    packageId: record.packageId,
    coinType: record.coinType,
    txDigest: record.txDigest,
    eventSeq: record.eventSeq,
    sessionId: record.sessionId,
    payerHash: record.payer ? publicIdentityHash(record.payer) : undefined,
    merchant: record.merchant,
    amount: record.amount,
    spentTotal: record.spentTotal,
    challengeId: record.challengeId,
    resourceScopeHash: record.resourceScopeHash,
    senderHash: record.sender ? publicIdentityHash(record.sender) : undefined,
    identityRedaction: {
      payer: record.payer ? "redacted_with_stable_hash" : "not_indexed",
      sender: record.sender ? "redacted_with_stable_hash" : "not_indexed"
    },
    evidence: {
      class: "onchain_indexed",
      source: "sui402_indexer",
      publicIdentifier: record.txDigest,
      eventSeq: record.eventSeq,
      indexedAt: record.indexedAt
    },
    timestampMs: record.timestampMs,
    indexedAt: record.indexedAt
  };
}

function paymentScanEvidence(payment: PaymentRecord): Record<string, unknown> {
  const classes = ["gateway_verified"];
  if (payment.receipt) {
    classes.push("signed_receipt");
  }

  return {
    class: payment.receipt ? "signed_receipt" : "gateway_verified",
    classes,
    source: "console_gateway",
    publicIdentifier: payment.proof.txDigest,
    challengeId: payment.challenge.id,
    observedAt: payment.createdAt
  };
}

function settlementToPublicScanRecord(
  record: SettlementRecord,
  links: PublicLinkOptions = {},
  indexerProgress?: ScanIndexerProgress
): Record<string, unknown> {
  return {
    id: record.id,
    network: record.network,
    packageId: record.packageId,
    coinType: record.coinType,
    txDigest: record.txDigest,
    eventSeq: record.eventSeq,
    kind: record.kind,
    ledgerId: record.ledgerId,
    receiptId: record.receiptId,
    payerHash: record.payer ? publicIdentityHash(record.payer) : undefined,
    merchant: record.merchant,
    signerHash: record.signer ? publicIdentityHash(record.signer) : undefined,
    amount: record.amount,
    sequence: record.sequence,
    resourceScopeHash: record.resourceScopeHash,
    submitterHash: record.submitter ? publicIdentityHash(record.submitter) : undefined,
    receiptCount: record.receiptCount,
    totalAmount: record.totalAmount,
    senderHash: record.sender ? publicIdentityHash(record.sender) : undefined,
    identityRedaction: {
      payer: record.payer ? "redacted_with_stable_hash" : "not_indexed",
      signer: record.signer ? "redacted_with_stable_hash" : "not_indexed",
      submitter: record.submitter ? "redacted_with_stable_hash" : "not_indexed",
      sender: record.sender ? "redacted_with_stable_hash" : "not_indexed"
    },
    evidence: {
      class: "settlement_record",
      source: "sui402_indexer",
      publicIdentifier: record.txDigest,
      eventSeq: record.eventSeq,
      indexedAt: record.indexedAt
    },
    caveats: [...SETTLEMENT_OPERATIONAL_CAVEATS],
    indexerProgress,
    timestampMs: record.timestampMs,
    indexedAt: record.indexedAt,
    links: scanSettlementLinks(record.txDigest, links)
  };
}

async function sessionIndexerProgress(
  store: IndexerCursorStore,
  record: SessionSpendRecord | undefined
): Promise<ScanIndexerProgress | undefined> {
  if (!record) {
    return undefined;
  }

  return scanIndexerProgress(store, "session-spend", record.packageId, record.coinType);
}

async function settlementIndexerProgress(
  store: IndexerCursorStore,
  record: SettlementRecord
): Promise<ScanIndexerProgress | undefined> {
  return scanIndexerProgress(store, "settlement", record.packageId, record.coinType);
}

async function scanIndexerProgress(
  store: IndexerCursorStore,
  eventKind: "session-spend" | "settlement",
  packageId: string | undefined,
  coinType: string | undefined
): Promise<ScanIndexerProgress | undefined> {
  if (!packageId || !coinType) {
    return undefined;
  }

  const cursorKey = defaultScanCursorKey(eventKind, packageId, coinType);
  const state = await store.getCursor(cursorKey);
  if (!state) {
    return {
      eventKind,
      cursorKey,
      label: "indexer_cursor_not_recorded"
    };
  }

  const checkpoint = readCheckpointCursor(state.cursor);
  return {
    eventKind,
    cursorKey: state.key,
    cursor: state.cursor,
    updatedAt: state.updatedAt,
    checkpoint: checkpoint?.checkpoint,
    eventOffset: checkpoint?.eventOffset,
    label: checkpoint ? "checkpoint_cursor" : state.cursor ? "opaque_cursor" : "cursor_empty"
  };
}

function defaultScanCursorKey(eventKind: "session-spend" | "settlement", packageId: string, coinType: string): string {
  const base = `${packageId}:${coinType}`;
  return eventKind === "settlement" ? `settlement:${base}` : base;
}

function readCheckpointCursor(cursor: string | undefined): { checkpoint: string; eventOffset: number } | undefined {
  if (!cursor) {
    return undefined;
  }

  const match = /^([0-9]+):([0-9]+)$/.exec(cursor);
  if (!match) {
    return undefined;
  }

  return {
    checkpoint: match[1] ?? "0",
    eventOffset: Number(match[2] ?? "0")
  };
}

function marketplaceApiLinks(apiId: string, options: PublicLinkOptions): Record<string, string> {
  const encoded = encodeURIComponent(apiId);
  return linkObject(
    {
      apiPath: `/v1/marketplace/apis/${encoded}`,
      publicPagePath: `/marketplace/${encoded}`,
      scanMerchantPath: `/v1/scan/merchants/${encoded}`,
      scanPagePath: `/scan/merchant/${encoded}`
    },
    options
  );
}

function scanStatsLinks(options: PublicLinkOptions): Record<string, string> {
  return linkObject(
    {
      apiPath: "/v1/scan/stats"
    },
    options
  );
}

function scanPaymentLinks(digest: string, options: PublicLinkOptions, merchantId?: unknown): Record<string, string> {
  const encoded = encodeURIComponent(digest);
  return {
    ...linkObject(
      {
        apiPath: `/v1/scan/payments/${encoded}`,
        publicPagePath: `/scan/payment/${encoded}`
      },
      options
    ),
    ...(typeof merchantId === "string" && merchantId.length > 0
      ? scanMerchantLinks(merchantId, options, "merchant")
      : {})
  };
}

function scanMerchantLinks(merchantId: string, options: PublicLinkOptions, prefix = ""): Record<string, string> {
  const encoded = encodeURIComponent(merchantId);
  const key = (name: string) => (prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name);
  return linkObject(
    {
      [key("apiPath")]: `/v1/scan/merchants/${encoded}`,
      [key("publicPagePath")]: `/scan/merchant/${encoded}`,
      [key("marketplacePath")]: `/marketplace/${encoded}`
    },
    options
  );
}

function scanSessionLinks(sessionId: string, options: PublicLinkOptions): Record<string, string> {
  const encoded = encodeURIComponent(sessionId);
  return linkObject(
    {
      apiPath: `/v1/scan/sessions/${encoded}`,
      publicPagePath: `/scan/session/${encoded}`
    },
    options
  );
}

function scanSettlementLinks(settlementId: string, options: PublicLinkOptions): Record<string, string> {
  const encoded = encodeURIComponent(settlementId);
  return linkObject(
    {
      apiPath: `/v1/scan/settlements/${encoded}`,
      publicPagePath: `/scan/settlement/${encoded}`
    },
    options
  );
}

function linkObject(paths: Record<string, string>, options: PublicLinkOptions): Record<string, string> {
  const links: Record<string, string> = { ...paths };
  if (!options.publicBaseUrl) {
    return links;
  }

  for (const [key, path] of Object.entries(paths)) {
    if (key.endsWith("Path")) {
      links[`${key.slice(0, -"Path".length)}Url`] = new URL(path, options.publicBaseUrl).toString();
    }
  }
  return links;
}

function renderMarketplacePublicPage(
  req: express.Request,
  listing: Sui402ServiceListing,
  merchant: GatewayMerchantConfig | undefined,
  payments: PaymentRecord[]
): string {
  const title = `${listing.name} | Sui402 Marketplace`;
  const description = cleanMetaDescription(
    listing.description ??
      `Discover ${listing.name} on the Sui402 marketplace: ${formatAmount(listing.price, listing.coinType)} on ${listing.network}.`
  );
  const readiness = marketplaceListingReadiness(listing, payments, merchant);
  const reliability = marketplaceReliability(payments);
  return renderPublicMetadataPage(req, {
    title,
    description,
    eyebrow: "Sui402 Marketplace",
    heading: listing.name,
    summary: description,
    badges: [listing.network, listing.transport.toUpperCase(), readiness.ready ? "Ready for agents" : "Needs review"],
    facts: [
      ["API id", listing.id],
      ["Price", formatAmount(listing.price, listing.coinType)],
      ["Resource", listing.resourceScope],
      ["Merchant", shortDigest(listing.merchant)],
      ["Verified payments", payments.length.toLocaleString()],
      ["Paid test observed", reliability.paidTestObserved ? "yes" : "no"],
      ["Last verified payment", typeof reliability.lastVerifiedPaymentAt === "string" ? reliability.lastVerifiedPaymentAt : "none"],
      ["Session support", listing.sessionSupported ? "yes" : "no"]
    ],
    links: [
      ["JSON detail", `/v1/marketplace/apis/${encodeURIComponent(listing.id)}`],
      ["Scan merchant", `/scan/merchant/${encodeURIComponent(listing.id)}`],
      ...(listing.protectedResourceUrl ? ([["Protected resource", listing.protectedResourceUrl]] as Array<[string, string]>) : [])
    ],
    code: marketplaceCurlCommand(listing),
    alternateJsonPath: `/v1/marketplace/apis/${encodeURIComponent(listing.id)}`,
    sections: [
      {
        title: "Launch readiness",
        body: readiness.ready
          ? "This listing has the core launch gates agents need before making a paid call."
          : "This listing is public, but at least one launch gate still needs review before agents should rely on it.",
        items: readiness.checks.map((check) => [check.name, `${check.ok ? "pass" : "blocked"} - ${check.message}`])
      },
      {
        title: "Agent path",
        body: "Agents should prefer the JSON detail contract for stable fields, then use the CLI command for local non-custodial payment.",
        items: [
          ["Discovery JSON", `/v1/marketplace/apis/${listing.id}`],
          ["Scan evidence", `/scan/merchant/${listing.id}`],
          ["Payment mode", listing.sessionSupported ? "session-capable with one-shot fallback" : "one-shot payment"]
        ]
      },
      publicRedactionSection()
    ]
  });
}

function renderScanPaymentPublicPage(req: express.Request, payment: PaymentRecord): string {
  const title = `Payment ${shortDigest(payment.proof.txDigest)} | Sui402 Scan`;
  const description = cleanMetaDescription(
    `Inspect a ${payment.proof.kind} Sui402 payment of ${formatAmount(payment.challenge.amount, payment.challenge.coinType)} for ${payment.resource} on ${payment.challenge.network}.`
  );
  return renderPublicMetadataPage(req, {
    title,
    description,
    eyebrow: "Sui402 Scan",
    heading: `Payment ${shortDigest(payment.proof.txDigest)}`,
    summary: description,
    badges: [payment.challenge.network, payment.proof.kind, payment.challenge.metadata?.merchantId ? String(payment.challenge.metadata.merchantId) : "indexed"],
    facts: [
      ["Digest", payment.proof.txDigest],
      ["Amount", formatAmount(payment.challenge.amount, payment.challenge.coinType)],
      ["Resource", payment.resource],
      ["Recipient", shortDigest(payment.challenge.recipient)],
      ["Challenge", shortDigest(payment.challenge.id)],
      ["Created", payment.createdAt ?? "unknown"]
    ],
    links: [
      ["JSON detail", `/v1/scan/payments/${encodeURIComponent(payment.proof.txDigest)}`],
      ...(payment.challenge.metadata?.merchantId
        ? ([["Merchant", `/scan/merchant/${encodeURIComponent(String(payment.challenge.metadata.merchantId))}`]] as Array<[string, string]>)
        : [])
    ],
    code: `sui402-pay scan payment ${payment.proof.txDigest}`,
    alternateJsonPath: `/v1/scan/payments/${encodeURIComponent(payment.proof.txDigest)}`,
    sections: [
      {
        title: "Evidence class",
        body: "This page renders a public scan record for a payment observed by the console gateway/indexer path.",
        items: [
          ["Provenance", payment.proof.kind === "session" ? "session spend receipt" : "one-shot payment proof"],
          ["Attribution", payment.challenge.metadata?.merchantId ? `merchant ${String(payment.challenge.metadata.merchantId)}` : "recipient/resource fallback"],
          ["Public identifier", payment.proof.txDigest]
        ]
      },
      publicRedactionSection()
    ]
  });
}

function renderScanMerchantPublicPage(
  req: express.Request,
  merchantId: string,
  merchant: GatewayMerchantConfig | undefined,
  listing: Sui402ServiceListing | undefined,
  payments: PaymentRecord[]
): string {
  const title = `${listing?.name ?? merchant?.service ?? merchantId} | Sui402 Scan`;
  const description = cleanMetaDescription(
    `Inspect Sui402 merchant ${merchantId}: ${payments.length.toLocaleString()} verified payment(s), ${payments
      .filter((payment) => payment.proof.kind === "session")
      .length.toLocaleString()} session payment(s), and ${sumPaymentAmounts(payments).toString()} indexed volume.`
  );
  return renderPublicMetadataPage(req, {
    title,
    description,
    eyebrow: "Sui402 Scan",
    heading: listing?.name ?? merchant?.service ?? merchantId,
    summary: description,
    badges: [merchant?.network ?? listing?.network ?? "indexed", listing?.transport.toUpperCase() ?? "merchant"],
    facts: [
      ["Merchant id", merchantId],
      ["Wallet", shortDigest(merchant?.merchant ?? listing?.merchant ?? "unknown")],
      ["Resource", merchant?.resourceScope ?? listing?.resourceScope ?? "unknown"],
      ["Verified payments", payments.length.toLocaleString()],
      ["Volume", sumPaymentAmounts(payments).toString()],
      ["Sessions", payments.filter((payment) => payment.proof.kind === "session").length.toLocaleString()]
    ],
    links: [
      ["JSON detail", `/v1/scan/merchants/${encodeURIComponent(merchantId)}`],
      ...(listing ? ([["Marketplace", `/marketplace/${encodeURIComponent(listing.id)}`]] as Array<[string, string]>) : [])
    ],
    code: `sui402-pay scan merchant ${merchantId}`,
    alternateJsonPath: `/v1/scan/merchants/${encodeURIComponent(merchantId)}`,
    sections: [
      {
        title: "Merchant evidence",
        body: "This page combines public listing metadata with indexed payment evidence for the merchant id.",
        items: [
          ["Listing", listing ? "marketplace listing found" : "no marketplace listing found"],
          ["Gateway merchant", merchant ? "gateway merchant found" : "gateway merchant missing"],
          ["Payment evidence", `${payments.length.toLocaleString()} verified payment record(s)`]
        ]
      },
      publicRedactionSection()
    ]
  });
}

function renderScanSessionPublicPage(
  req: express.Request,
  sessionId: string,
  records: SessionSpendRecord[],
  indexerProgress?: ScanIndexerProgress
): string {
  const session = sessionSpendsToPublicScanSession(sessionId, records, {}, indexerProgress) as {
    network?: string;
    coinType?: string;
    payerHash?: string;
    merchant?: string;
    spendCount: number;
    spentAmount: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    lastTxDigest?: string;
  };
  const title = `Session ${shortDigest(sessionId)} | Sui402 Scan`;
  const description = cleanMetaDescription(
    `Inspect Sui402 session ${shortDigest(sessionId)} with ${session.spendCount.toLocaleString()} spend(s) totaling ${formatAmount(session.spentAmount, session.coinType ?? "")}.`
  );
  return renderPublicMetadataPage(req, {
    title,
    description,
    eyebrow: "Sui402 Scan",
    heading: `Session ${shortDigest(sessionId)}`,
    summary: description,
    badges: [session.network ?? "indexed", "session"],
    facts: [
      ["Session id", sessionId],
      ["Spent", formatAmount(session.spentAmount, session.coinType ?? "")],
      ["Spend count", session.spendCount.toLocaleString()],
      ["Payer", session.payerHash ? `redacted (${shortDigest(session.payerHash)})` : "redacted"],
      ["Merchant", shortDigest(session.merchant ?? "unknown")],
      ["Last tx", session.lastTxDigest ? shortDigest(session.lastTxDigest) : "unknown"]
    ],
    links: [["JSON detail", `/v1/scan/sessions/${encodeURIComponent(sessionId)}`]],
    code: `sui402-pay scan session ${sessionId}`,
    alternateJsonPath: `/v1/scan/sessions/${encodeURIComponent(sessionId)}`,
    sections: [
      {
        title: "Session evidence",
        body: "This page summarizes indexed spends for a user-owned Sui402 payment session.",
        items: [
          ["Provenance", "indexed AgentPaymentSession spend records"],
          ["Spend count", session.spendCount.toLocaleString()],
          ["Scope hashes", `${records.length > 0 ? new Set(records.map((record) => record.resourceScopeHash)).size : 0} observed`]
        ]
      },
      indexerProgressSection(indexerProgress),
      publicRedactionSection()
    ].filter((section): section is PublicMetadataSection => Boolean(section))
  });
}

function renderScanSettlementPublicPage(
  req: express.Request,
  record: SettlementRecord,
  indexerProgress?: ScanIndexerProgress
): string {
  const amount = record.amount ?? record.totalAmount ?? "0";
  const title = `Settlement ${shortDigest(record.txDigest)} | Sui402 Scan`;
  const description = cleanMetaDescription(
    `Inspect Sui402 ${record.kind} settlement ${shortDigest(record.txDigest)} for ${formatAmount(amount, record.coinType)} on ${record.network}.`
  );
  return renderPublicMetadataPage(req, {
    title,
    description,
    eyebrow: "Sui402 Scan",
    heading: `Settlement ${shortDigest(record.txDigest)}`,
    summary: description,
    badges: [record.network, record.kind],
    facts: [
      ["Tx digest", record.txDigest],
      ["Amount", formatAmount(amount, record.coinType)],
      ["Merchant", shortDigest(record.merchant)],
      ["Ledger", shortDigest(record.ledgerId)],
      ["Submitter", shortDigest(record.submitter)],
      ["Indexed", record.indexedAt]
    ],
    links: [["JSON detail", `/v1/scan/settlements/${encodeURIComponent(record.txDigest)}`]],
    code: `sui402-pay scan settlement ${record.txDigest}`,
    alternateJsonPath: `/v1/scan/settlements/${encodeURIComponent(record.txDigest)}`,
    sections: [
      {
        title: "Settlement evidence",
        body: "This page renders a public settlement event or receipt record that can be reconciled against payment evidence.",
        items: [
          ["Provenance", `${record.kind} settlement record`],
          ["Ledger", shortDigest(record.ledgerId)],
          ["Receipt", record.receiptId ? shortDigest(record.receiptId) : "not attached"]
        ]
      },
      indexerProgressSection(indexerProgress),
      settlementEvidenceLimitsSection(),
      publicRedactionSection()
    ].filter((section): section is PublicMetadataSection => Boolean(section))
  });
}

function indexerProgressSection(progress: ScanIndexerProgress | undefined): PublicMetadataSection | undefined {
  if (!progress) {
    return undefined;
  }

  return {
    title: "Indexer progress",
    body: "This cursor describes the local Sui402 indexer progress for the event stream behind this public record. It is provenance, not an external audit or legal finality claim.",
    items: [
      ["Event stream", progress.eventKind],
      ["Cursor key", progress.cursorKey],
      ["Cursor label", progress.label],
      ["Cursor", progress.cursor ?? "not recorded"],
      ["Checkpoint", progress.checkpoint ?? "not checkpoint-based"],
      ["Event offset", progress.eventOffset === undefined ? "unknown" : String(progress.eventOffset)],
      ["Updated", progress.updatedAt ?? "unknown"]
    ]
  };
}

function settlementEvidenceLimitsSection(): PublicMetadataSection {
  return {
    title: "Evidence limits",
    body: "Settlement scan records are operational reconciliation evidence only. They do not prove escrowed fund movement, refund guarantees, legal settlement finality, or external audit unless separate evidence is linked.",
    items: SETTLEMENT_OPERATIONAL_CAVEATS.map((caveat, index) => [`Caveat ${index + 1}`, caveat])
  };
}

function renderPublicNotFoundPage(
  req: express.Request,
  title: string,
  description: string,
  options: {
    recordLabel?: string;
    recordId?: string;
    alternateJsonPath?: string;
    links?: Array<[string, string]>;
  } = {}
): string {
  const facts: Array<[string, string]> = [["Status", "not found"]];
  if (options.recordLabel && options.recordId) {
    facts.push([options.recordLabel, options.recordId]);
  }

  return renderPublicMetadataPage(req, {
    title: `${title} | Sui402`,
    description,
    eyebrow: "Sui402 Public Surface",
    heading: title,
    summary: description,
    badges: ["not indexed yet"],
    facts,
    links: options.links ?? [["Marketplace API", "/v1/marketplace/apis"]],
    alternateJsonPath: options.alternateJsonPath,
    sections: [
      {
        title: "What happened",
        body: "The requested public record is not indexed in this console environment yet.",
        items: [["Next action", "Check the JSON marketplace/scan APIs or wait for indexing"]]
      }
    ],
    noindex: true
  });
}

type PublicMetadataSection = {
  title: string;
  body: string;
  items?: Array<[string, string]>;
};

function renderPublicMetadataPage(
  req: express.Request,
  input: {
    title: string;
    description: string;
    eyebrow: string;
    heading: string;
    summary: string;
    badges?: string[];
    facts?: Array<[string, string]>;
    links?: Array<[string, string]>;
    code?: string;
    alternateJsonPath?: string;
    sections?: PublicMetadataSection[];
    noindex?: boolean;
  }
): string {
  const canonicalUrl = absoluteRequestUrl(req);
  const safeTitle = escapeHtml(input.title);
  const safeDescription = escapeHtml(cleanMetaDescription(input.description));
  const facts = (input.facts ?? [])
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  const badges = (input.badges ?? []).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("");
  const links = (input.links ?? [])
    .map(([label, href]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`)
    .join("");
  const code = input.code ? `<pre><code>${escapeHtml(input.code)}</code></pre>` : "";
  const sections = (input.sections ?? [])
    .map((section) => renderPublicMetadataSection(section))
    .join("");
  const robots = input.noindex ? `<meta name="robots" content="noindex,follow" />` : "";
  const alternateJson = input.alternateJsonPath
    ? `<link rel="alternate" type="application/json" href="${escapeAttribute(absolutePathUrl(req, input.alternateJsonPath))}" />`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
    ${alternateJson}
    ${robots}
    <style>
      :root { color-scheme: dark; font-family: Geist, Satoshi, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070b12; color: #eef5ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px 20px; background: radial-gradient(circle at top left, rgba(75, 158, 255, .16), transparent 34%), #070b12; }
      main { width: min(980px, 100%); border: 1px solid rgba(148, 163, 184, .24); border-radius: 28px; padding: 34px; background: rgba(10, 16, 28, .9); box-shadow: 0 24px 90px rgba(0, 0, 0, .34); }
      p, dd { color: #b9c7d9; }
      .eyebrow { color: #79b7ff; text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 700; }
      h1 { margin: 12px 0; font-size: clamp(34px, 7vw, 64px); line-height: .95; letter-spacing: -.05em; }
      .badges, .links { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; }
      .badges span, .links a { border: 1px solid rgba(148, 163, 184, .28); border-radius: 999px; padding: 8px 12px; color: #dceaff; text-decoration: none; background: rgba(255,255,255,.04); }
      dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin: 24px 0 0; }
      dt { color: #7f8ea3; font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
      dd { margin: 6px 0 0; overflow-wrap: anywhere; }
      .sections { display: grid; gap: 14px; margin-top: 24px; }
      section { border: 1px solid rgba(148, 163, 184, .18); border-radius: 20px; padding: 18px; background: rgba(255,255,255,.035); }
      section h2 { margin: 0; color: #eef5ff; font-size: 17px; letter-spacing: -.02em; }
      section p { margin: 8px 0 0; line-height: 1.6; }
      section dl { margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      pre { overflow-x: auto; border: 1px solid rgba(121, 183, 255, .26); border-radius: 18px; padding: 16px; background: #020817; color: #8ee6a8; }
      footer { margin-top: 28px; color: #7f8ea3; font-size: 13px; }
      @media (max-width: 680px) { body { padding: 18px 12px; } main { padding: 22px; border-radius: 22px; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${escapeHtml(input.eyebrow)}</div>
      <h1>${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.summary)}</p>
      ${badges ? `<div class="badges">${badges}</div>` : ""}
      ${facts ? `<dl>${facts}</dl>` : ""}
      ${code}
      ${sections ? `<div class="sections">${sections}</div>` : ""}
      ${links ? `<nav class="links">${links}</nav>` : ""}
      <footer>Public Sui402 metadata page. Sensitive request payloads, headers, cookies, admin keys, and private upstream configuration are never rendered here.</footer>
    </main>
  </body>
</html>`;
}

function renderPublicMetadataSection(section: PublicMetadataSection): string {
  const items = (section.items ?? [])
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  return `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p>${items ? `<dl>${items}</dl>` : ""}</section>`;
}

function publicRedactionSection(): PublicMetadataSection {
  return {
    title: "Public safety",
    body: "This page is safe to share. It intentionally omits private payloads, authorization headers, cookies, admin keys, verification tokens, signer material, and private upstream configuration.",
    items: [
      ["Rendered", "public identifiers, payment terms, aggregate evidence"],
      ["Redacted", "secrets, request bodies, payment headers, private upstream config"]
    ]
  };
}

function absoluteRequestUrl(req: express.Request): string {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
}

function absolutePathUrl(req: express.Request, path: string): string {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${req.get("host") ?? "localhost"}${path}`;
}

function cleanMetaDescription(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function listingMatchesSearch(listing: Sui402ServiceListing, query: string): boolean {
  const needle = query.toLowerCase();
  return [
    listing.id,
    listing.name,
    listing.description,
    listing.resourceScope,
    listing.network,
    listing.transport,
    ...listing.tags
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function paymentBelongsToListing(payment: PaymentRecord, listing: Sui402ServiceListing): boolean {
  const attributedMerchantId = payment.challenge.metadata?.merchantId;
  const candidate =
    (typeof attributedMerchantId === "string" && attributedMerchantId === listing.id) ||
    payment.challenge.recipient.toLowerCase() === listing.merchant.toLowerCase();
  if (!candidate) {
    return false;
  }

  return paymentMatchesListingTerms(payment, listing);
}

function paymentMatchesListingTerms(payment: PaymentRecord, listing: Sui402ServiceListing): boolean {
  return (
    payment.challenge.network === listing.network &&
    payment.challenge.recipient.toLowerCase() === listing.merchant.toLowerCase() &&
    payment.challenge.coinType === listing.coinType &&
    payment.challenge.amount === listing.price &&
    payment.resource === listing.resourceScope &&
    resourceScopeHash(payment.resource) === listing.resourceScopeHash
  );
}

function sumPaymentAmounts(payments: PaymentRecord[]): bigint {
  return payments.reduce((total, payment) => total + BigInt(payment.challenge.amount), 0n);
}

function countBy<T>(items: T[], readKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = readKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function sumPaymentsBy(payments: PaymentRecord[], readKey: (payment: PaymentRecord) => string): Record<string, string> {
  const sums: Record<string, bigint> = {};
  for (const payment of payments) {
    const key = readKey(payment);
    sums[key] = (sums[key] ?? 0n) + BigInt(payment.challenge.amount);
  }

  return Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, value.toString()]));
}

function formatAmount(amount: string, coinType: string): string {
  if (coinType === "0x2::sui::SUI") {
    return `${amount} MIST`;
  }

  return `${amount} ${coinType.split("::").at(-1) ?? "units"}`;
}

function shortDigest(digest: string): string {
  return digest.length > 12 ? `${digest.slice(0, 5)}...${digest.slice(-4)}` : digest;
}

function publicIdentityHash(value: string): string {
  return `sha256:${createHash("sha256").update(value.toLowerCase()).digest("hex")}`;
}

function privateTokenHash(value: string): string {
  return sha256Hash(value);
}

function sha256Hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

type PublisherSessionClaims = {
  v: 1;
  applicationId: string;
  merchantId: string;
  sid: string;
  iat: number;
  exp: number;
};

type PublisherAuthContext =
  | { kind: "publisher_access_token" }
  | { kind: "publisher_session"; sessionId: string; expiresAt: string };

function createPublisherSessionToken(
  application: MerchantApplication,
  ttlSeconds: number,
  options: { now?: Date } = {}
): { token: string; claims: PublisherSessionClaims; expiresAt: string } {
  if (!application.verification?.accessToken) {
    throw new Error(`Merchant application ${application.id} does not have a publisher access token`);
  }

  const now = options.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const claims: PublisherSessionClaims = {
    v: 1,
    applicationId: application.id,
    merchantId: application.request.id,
    sid: `psess_${randomBytes(16).toString("base64url")}`,
    iat,
    exp
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = signPublisherSessionPayload(payload, application.verification.accessToken);
  return {
    token: `sui402ps_${payload}.${signature}`,
    claims,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function authenticatePublisherRequest(application: MerchantApplication, req: express.Request): PublisherAuthContext | undefined {
  const session = verifyPublisherSessionToken(application, readBearerToken(req.header("authorization")));
  if (session) {
    return {
      kind: "publisher_session",
      sessionId: session.sid,
      expiresAt: new Date(session.exp * 1000).toISOString()
    };
  }

  const token = req.header("x-sui402-publisher-token");
  if (application.verification?.accessToken && token === application.verification.accessToken) {
    return { kind: "publisher_access_token" };
  }

  return undefined;
}

function verifyPublisherSessionToken(
  application: MerchantApplication,
  token: string | undefined,
  options: { now?: Date } = {}
): PublisherSessionClaims | undefined {
  if (!token || !application.verification?.accessToken || !token.startsWith("sui402ps_")) {
    return undefined;
  }

  const withoutPrefix = token.slice("sui402ps_".length);
  const [payload, signature, ...rest] = withoutPrefix.split(".");
  if (!payload || !signature || rest.length > 0) {
    return undefined;
  }

  const expectedSignature = signPublisherSessionPayload(payload, application.verification.accessToken);
  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  let claims: PublisherSessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PublisherSessionClaims;
  } catch {
    return undefined;
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (
    claims.v !== 1 ||
    claims.applicationId !== application.id ||
    claims.merchantId !== application.request.id ||
    typeof claims.sid !== "string" ||
    !claims.sid.startsWith("psess_") ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > nowSeconds ||
    claims.exp <= nowSeconds
  ) {
    return undefined;
  }

  return claims;
}

function signPublisherSessionPayload(payload: string, accessToken: string): string {
  return createHmac("sha256", accessToken).update(payload).digest("base64url");
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    return undefined;
  }
  return token;
}

function publisherAuthView(auth: PublisherAuthContext): Record<string, unknown> {
  if (auth.kind === "publisher_session") {
    return {
      kind: "publisher_session",
      sessionId: auth.sessionId,
      expiresAt: auth.expiresAt
    };
  }

  return {
    kind: "publisher_access_token",
    recommendation: "Exchange this long-lived token for a short-lived publisher session before browser/portal use."
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function absoluteConsoleRoute(baseUrl: string | undefined, pathname: string): string {
  const route = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return baseUrl ? new URL(route, baseUrl).toString() : route;
}

type PublicIntakeHostPolicyViolation = {
  allowed: false;
  error: "public_intake_host_blocked" | "public_intake_host_not_allowed";
  hostname: string;
  pattern?: string;
};

function evaluatePublicIntakeHostPolicy(
  urls: Array<string | undefined>,
  config: ConsoleConfig
): { allowed: true } | PublicIntakeHostPolicyViolation {
  const allowedHosts = parseHostPolicy(config.SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS);
  const blockedHosts = parseHostPolicy(config.SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS);

  for (const url of urls) {
    if (!url) {
      continue;
    }
    const hostname = new URL(url).hostname.toLowerCase();
    const blocked = findHostPolicyMatch(hostname, blockedHosts);
    if (blocked) {
      return {
        allowed: false,
        error: "public_intake_host_blocked",
        hostname,
        pattern: blocked
      };
    }
    if (allowedHosts.length > 0 && !findHostPolicyMatch(hostname, allowedHosts)) {
      return {
        allowed: false,
        error: "public_intake_host_not_allowed",
        hostname
      };
    }
  }

  return { allowed: true };
}

function intakePolicyErrorResponse(violation: PublicIntakeHostPolicyViolation): Record<string, unknown> {
  return {
    error: violation.error,
    message:
      violation.error === "public_intake_host_blocked"
        ? "This publisher host is currently blocked by public intake policy"
        : "This publisher host is not on the current public intake allowlist",
    hostname: violation.hostname,
    policy: violation.error === "public_intake_host_blocked" ? "blocked_hosts" : "allowed_hosts"
  };
}

function parseHostPolicy(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function findHostPolicyMatch(hostname: string, patterns: string[]): string | undefined {
  return patterns.find((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === pattern;
  });
}

function decodePemBase64(value: string | undefined): string | undefined {
  return value ? Buffer.from(value, "base64").toString("utf8") : undefined;
}

function publicIntakeKey(req: express.Request): string {
  return `${req.ip}:${req.header("user-agent") ?? "unknown"}`;
}

async function rejectPublisherAuthFailure(input: {
  req: express.Request;
  res: express.Response;
  limiter: WindowRateLimitStore;
  config: ConsoleConfig;
  applicationId: string;
}): Promise<boolean> {
  const limit = await input.limiter.consume(
    `publisher-auth:${input.applicationId}:${publicIntakeKey(input.req)}`,
    {
      max: input.config.SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX,
      windowMs: input.config.SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS
    }
  );

  if (limit.allowed) {
    return false;
  }

  input.res.setHeader("retry-after", String(limit.retryAfterSeconds ?? 1));
  input.res.status(429).json({
    error: "rate_limited",
    message: "Too many invalid publisher credentials. Try again later.",
    retryAfterSeconds: limit.retryAfterSeconds
  });
  return true;
}

function publicReadSurface(
  config: ConsoleConfig,
  limiter: WindowRateLimitStore,
  surface: "marketplace" | "scan"
): express.RequestHandler {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const limit = await limiter.consume(`public-read:${surface}:${publicIntakeKey(req)}`, {
      max: config.SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX,
      windowMs: config.SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_WINDOW_MS
    });
    if (!limit.allowed) {
      res.setHeader("retry-after", String(limit.retryAfterSeconds ?? 1));
      res.setHeader("cache-control", "no-store");
      res.status(429).json({
        error: "rate_limited",
        message: `Too many public ${surface} requests. Try again later.`,
        retryAfterSeconds: limit.retryAfterSeconds
      });
      return;
    }

    setPublicReadCacheHeaders(res, config.SUI402_CONSOLE_PUBLIC_READ_CACHE_SECONDS);
    next();
  };
}

function setPublicReadCacheHeaders(res: express.Response, maxAgeSeconds: number): void {
  if (maxAgeSeconds === 0) {
    res.setHeader("cache-control", "no-store");
    return;
  }

  res.setHeader("cache-control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 4}`);
  res.setHeader("vary", "accept, origin");
}

function privateConsoleSurface(): express.RequestHandler {
  return (_req, res, next) => {
    if (res.hasHeader("cache-control")) {
      next();
      return;
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("pragma", "no-cache");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    next();
  };
}

function corsForLocalDashboard(config: ConsoleConfig): express.RequestHandler {
  const explicitOrigins = (config.SUI402_CONSOLE_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const configuredOrigins = new Set(
    [
      ...(config.NODE_ENV === "production" ? [config.SUI402_CONSOLE_PROVIDER_BASE_URL] : []),
      ...explicitOrigins
    ]
      .map((origin) => originFromUrl(origin))
      .filter((origin): origin is string => Boolean(origin))
  );
  const allowWildcard = config.NODE_ENV !== "production" && explicitOrigins.length === 0;

  return (req, res, next) => {
    const requestOrigin = req.header("origin");
    if (allowWildcard) {
      res.setHeader("access-control-allow-origin", "*");
    } else if (requestOrigin && configuredOrigins.has(requestOrigin)) {
      res.setHeader("access-control-allow-origin", requestOrigin);
    }
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader(
      "access-control-allow-headers",
      "content-type,authorization,x-sui402-admin-key,x-sui402-seller-key,x-sui402-publisher-token"
    );
    next();
  };
}

function originFromUrl(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
