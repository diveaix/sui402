import { isIP } from "node:net";
import express from "express";
import { z } from "zod";
import {
  SUI402_VERSION,
  SUI402_PAYMENT_HEADER,
  Sui402NetworkSchema,
  resourceScopeHash,
  type Sui402ProviderManifest
} from "@sui402/protocol";
import { Sui402SpendingPolicySchema } from "@sui402/policy";
import {
  createSui402SessionRouter,
  MemoryChallengeStore,
  requireSuiPayment,
  type ChallengeStore,
  type PaymentReceiptIssuer,
  type PaymentRecordStore,
  type PaymentVerifier,
  type Sui402SessionManagerOptions
} from "@sui402/server";
import { Sui402Verifier } from "@sui402/sui";

export const GatewayMerchantConfigSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  service: z.string().min(1),
  network: Sui402NetworkSchema,
  merchant: z.string().min(1),
  coinType: z.string().min(1),
  price: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  upstreamUrl: z.string().url().refine(isSafeUpstreamUrlString, {
    message: "upstreamUrl must be an http(s) URL with a public upstream host"
  }).optional(),
  upstreamTimeoutMs: z.number().int().positive().max(120_000).default(15_000),
  sessionPackageId: z.string().min(1).optional(),
  paymentPolicy: Sui402SpendingPolicySchema.optional(),
  challengeTtlSeconds: z.number().int().positive().default(300),
  status: z.enum(["active", "paused"]).default("active"),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type GatewayMerchantConfigInput = z.input<typeof GatewayMerchantConfigSchema>;
export type GatewayMerchantConfig = z.infer<typeof GatewayMerchantConfigSchema>;

export type MerchantStore = {
  upsert(merchant: GatewayMerchantConfig): Promise<void> | void;
  get(id: string): Promise<GatewayMerchantConfig | undefined> | GatewayMerchantConfig | undefined;
  list?(): Promise<GatewayMerchantConfig[]> | GatewayMerchantConfig[];
};

export class MemoryMerchantStore implements MerchantStore {
  readonly #merchants = new Map<string, GatewayMerchantConfig>();

  upsert(merchant: GatewayMerchantConfig): void {
    this.#merchants.set(merchant.id, merchant);
  }

  get(id: string): GatewayMerchantConfig | undefined {
    return this.#merchants.get(id);
  }

  list(): GatewayMerchantConfig[] {
    return [...this.#merchants.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

export type GatewayRouterOptions = {
  merchants: MerchantStore;
  challengeStore?: ChallengeStore;
  paymentRecords?: PaymentRecordStore;
  verifierFactory?: (merchant: GatewayMerchantConfig) => PaymentVerifier;
  receiptIssuerFactory?: (merchant: GatewayMerchantConfig) => PaymentReceiptIssuer | undefined;
  sessionClientFactory?: (merchant: GatewayMerchantConfig) => Sui402SessionManagerOptions["client"] | undefined;
  adminAuth?: express.RequestHandler;
  adminApiKey?: string;
};

export function createGatewayRouter(options: GatewayRouterOptions): express.Router {
  const router = express.Router();
  const challengeStore = options.challengeStore ?? new MemoryChallengeStore();
  const adminAuth = options.adminAuth ?? requireAdmin(options.adminApiKey);

  router.get("/merchants", adminAuth, async (_req, res, next) => {
    try {
      const merchants = options.merchants.list ? await options.merchants.list() : [];
      res.json({
        version: SUI402_VERSION,
        count: merchants.length,
        merchants
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/merchants", express.json({ limit: "1mb" }), adminAuth, async (req, res, next) => {
    try {
      const merchant = createGatewayMerchantConfig(req.body);
      await options.merchants.upsert(merchant);
      res.status(201).json(merchant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "invalid_merchant", issues: error.issues });
        return;
      }

      next(error);
    }
  });

  router.get("/merchants/:merchantId/.well-known/sui402", async (req, res, next) => {
    try {
      const merchant = await readMerchant(options.merchants, req.params.merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      res.json(createGatewayManifest(merchant));
    } catch (error) {
      next(error);
    }
  });

  router.use("/merchants/:merchantId/sessions", async (req, res, next) => {
    try {
      const merchant = await readMerchant(options.merchants, req.params.merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      if (!merchant.sessionPackageId) {
        res.status(404).json({
          error: "sessions_not_enabled",
          message: "Payment sessions are not enabled for this merchant"
        });
        return;
      }

      return createSui402SessionRouter({
        network: merchant.network,
        client: options.sessionClientFactory?.(merchant),
        packageId: merchant.sessionPackageId,
        merchant: merchant.merchant,
        coinType: merchant.coinType,
        resourceScopeHash: resourceScopeHash(merchant.resourceScope)
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  router.all("/merchants/:merchantId/pay", async (req, res, next) => {
    try {
      const merchant = await readMerchant(options.merchants, req.params.merchantId);
      if (!merchant) {
        res.status(404).json({ error: "merchant_not_found", message: "Merchant not found" });
        return;
      }

      if (merchant.status !== "active") {
        res.status(403).json({ error: "merchant_paused", message: "Merchant is paused" });
        return;
      }

      if (merchant.upstreamUrl && !validateUpstreamUrlOrRespond(res, merchant.upstreamUrl)) {
        return;
      }

      const verifier =
        options.verifierFactory?.(merchant) ??
        new Sui402Verifier({
          network: merchant.network,
          sessionPackageId: merchant.sessionPackageId
        });

      return requireSuiPayment({
        network: merchant.network,
        recipient: merchant.merchant,
        coinType: merchant.coinType,
        amount: merchant.price,
        description: `${merchant.service} via Sui402 gateway`,
        ttlSeconds: merchant.challengeTtlSeconds,
        store: challengeStore,
        records: options.paymentRecords,
        verifier,
        policy: merchant.paymentPolicy,
        receiptIssuer: options.receiptIssuerFactory?.(merchant),
        resource: () => merchant.resourceScope
      })(req, res, () => {
        void respondWithMerchantResource(req, res, merchant).catch(next);
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createGatewayMerchantConfig(input: GatewayMerchantConfigInput): GatewayMerchantConfig {
  return GatewayMerchantConfigSchema.parse(input);
}

export function createGatewayManifest(merchant: GatewayMerchantConfig): Sui402ProviderManifest {
  const scopeHash = resourceScopeHash(merchant.resourceScope);
  const sessionsEnabled = Boolean(merchant.sessionPackageId);
  return {
    version: SUI402_VERSION,
    service: merchant.service,
    network: merchant.network,
    merchant: merchant.merchant,
    coinType: merchant.coinType,
    price: merchant.price,
    resourceScope: merchant.resourceScope,
    resourceScopeHash: scopeHash,
    payments: {
      kinds: sessionsEnabled ? ["one-shot", "session"] : ["one-shot"],
      challengeTtlSeconds: merchant.challengeTtlSeconds
    },
    sessions: {
      enabled: sessionsEnabled,
      packageId: merchant.sessionPackageId,
      managerPath: sessionsEnabled ? `/gateway/merchants/${merchant.id}/sessions` : undefined
    },
    endpoints: {
      wellKnown: `/gateway/merchants/${merchant.id}/.well-known/sui402`,
      protectedResource: `/gateway/merchants/${merchant.id}/pay`,
      sessionManager: sessionsEnabled ? `/gateway/merchants/${merchant.id}/sessions` : undefined
    }
  };
}

async function readMerchant(store: MerchantStore, id: string | undefined): Promise<GatewayMerchantConfig | undefined> {
  return id ? store.get(id) : undefined;
}

async function respondWithMerchantResource(
  req: express.Request,
  res: express.Response,
  merchant: GatewayMerchantConfig
): Promise<void> {
  if (!merchant.upstreamUrl) {
    res.json({
      paid: true,
      merchantId: merchant.id,
      service: merchant.service,
      resourceScope: merchant.resourceScope,
      payment: res.locals.sui402?.verification
    });
    return;
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchPaidUpstream(req, res, merchant);
  } catch (error) {
    if (respondToUnsafeUpstreamUrlError(res, error)) {
      return;
    }

    throw error;
  }

  res.status(upstreamResponse.status);
  copyResponseHeaders(upstreamResponse.headers, res);

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.send(body);
}

async function fetchPaidUpstream(
  req: express.Request,
  res: express.Response,
  merchant: GatewayMerchantConfig
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), merchant.upstreamTimeoutMs);
  try {
    const upstreamUrl = assertSafeUpstreamUrl(merchant.upstreamUrl!);
    const originalUrl = new URL(req.originalUrl, "http://sui402.local");
    upstreamUrl.search = originalUrl.search;

    const headers = copyRequestHeaders(req.headers);
    const verification = res.locals.sui402?.verification as { digest?: string; sessionId?: string } | undefined;
    headers.set("x-sui402-merchant-id", merchant.id);
    headers.set("x-sui402-resource-scope", merchant.resourceScope);
    if (verification?.digest) {
      headers.set("x-sui402-payment-digest", verification.digest);
    }
    if (verification?.sessionId) {
      headers.set("x-sui402-session-id", verification.sessionId);
    }

    const method = req.method.toUpperCase();
    const requestBody = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);
    const body = requestBody ? toArrayBuffer(requestBody) : undefined;
    return await fetch(upstreamUrl, {
      method,
      headers,
      body,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Upstream API timed out after ${merchant.upstreamTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function copyRequestHeaders(headers: express.Request["headers"]): Headers {
  const copied = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (REQUEST_HOP_BY_HOP_HEADERS.has(lowerKey) || REQUEST_PRIVATE_HEADERS.has(lowerKey) || lowerKey === "host") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        copied.append(key, item);
      }
    } else if (value !== undefined) {
      copied.set(key, value);
    }
  }

  return copied;
}

function copyResponseHeaders(headers: Headers, res: express.Response): void {
  headers.forEach((value, key) => {
    if (!RESPONSE_HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
}

async function readRequestBody(req: express.Request): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return body;
}

function isSafeUpstreamUrlString(value: string): boolean {
  try {
    assertSafeUpstreamUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeUpstreamUrl(value: string): URL {
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(value);
  } catch {
    throw new UnsafeUpstreamUrlError("Merchant upstreamUrl must be a valid URL");
  }
  if (!SAFE_UPSTREAM_PROTOCOLS.has(upstreamUrl.protocol)) {
    throw new UnsafeUpstreamUrlError("Merchant upstreamUrl must use http or https");
  }

  if (upstreamUrl.username || upstreamUrl.password) {
    throw new UnsafeUpstreamUrlError("Merchant upstreamUrl must not include credentials");
  }

  const hostname = normalizeUrlHostname(upstreamUrl.hostname);
  if (!hostname || UNSAFE_UPSTREAM_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new UnsafeUpstreamUrlError("Merchant upstreamUrl host is not allowed");
  }

  if (isUnsafeIpHost(hostname)) {
    throw new UnsafeUpstreamUrlError("Merchant upstreamUrl host must be publicly routable");
  }

  return upstreamUrl;
}

function validateUpstreamUrlOrRespond(res: express.Response, value: string): boolean {
  try {
    assertSafeUpstreamUrl(value);
    return true;
  } catch (error) {
    if (respondToUnsafeUpstreamUrlError(res, error)) {
      return false;
    }

    throw error;
  }
}

function respondToUnsafeUpstreamUrlError(res: express.Response, error: unknown): boolean {
  if (!(error instanceof UnsafeUpstreamUrlError)) {
    return false;
  }

  res.status(502).json({
    error: "unsafe_upstream_url",
    message: error.message
  });
  return true;
}

function normalizeUrlHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.+$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
}

function isUnsafeIpHost(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    return isUnsafeIpv4(hostname);
  }

  if (version === 6) {
    return isUnsafeIpv6(hostname);
  }

  return false;
}

function isUnsafeIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const first = octets[0]!;
  const second = octets[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isUnsafeIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = parseIpv4MappedIpv6(normalized);
    return mappedIpv4 ? isUnsafeIpv4(mappedIpv4) : true;
  }

  const firstGroup = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  if (!Number.isInteger(firstGroup)) {
    return true;
  }

  return (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80;
}

function parseIpv4MappedIpv6(hostname: string): string | undefined {
  const suffix = hostname.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }

  const groups = suffix.split(":");
  if (groups.length !== 2) {
    return undefined;
  }

  const high = Number.parseInt(groups[0]!, 16);
  const low = Number.parseInt(groups[1]!, 16);
  if (![high, low].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff)) {
    return undefined;
  }

  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

class UnsafeUpstreamUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUpstreamUrlError";
  }
}

const REQUEST_HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

const REQUEST_PRIVATE_HEADERS = new Set([SUI402_PAYMENT_HEADER.toLowerCase(), "authorization", "cookie"]);

const RESPONSE_HOP_BY_HOP_HEADERS = new Set([
  ...REQUEST_HOP_BY_HOP_HEADERS,
  "content-length",
  "content-encoding"
]);

const SAFE_UPSTREAM_PROTOCOLS = new Set(["http:", "https:"]);

const UNSAFE_UPSTREAM_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal"
]);

function requireAdmin(apiKey: string | undefined): express.RequestHandler {
  return (req, res, next) => {
    if (!apiKey) {
      res.status(403).json({ error: "gateway_read_only", message: "Gateway admin routes are disabled" });
      return;
    }

    const bearer = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const header = req.header("x-sui402-admin-key");
    if (bearer !== apiKey && header !== apiKey) {
      res.status(401).json({ error: "unauthorized", message: "Invalid gateway admin key" });
      return;
    }

    next();
  };
}
