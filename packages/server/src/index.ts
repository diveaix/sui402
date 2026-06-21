import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { Sui402SignedSpendReceipt } from "@sui402/receipts";
import {
  evaluateChallengePolicy,
  type Sui402SpendingPolicy
} from "@sui402/policy";
import {
  SUI402_CHALLENGE_HEADER,
  SUI402_PAYMENT_HEADER,
  Sui402AnyPaymentProofSchema,
  createChallenge,
  decodeHeader,
  encodeHeader,
  isExpired,
  type Sui402Challenge,
  type Sui402ChallengeInput,
  type Sui402AnyPaymentProof,
  type Sui402Network,
  type Sui402PaymentProof,
  type Sui402SessionSpendProof,
  type Sui402PaymentRequiredResponse
} from "@sui402/protocol";
import {
  Sui402Verifier,
  findUsableAgentPaymentSession,
  listAgentPaymentSessions,
  type AgentPaymentSession,
  type SessionSpendVerificationResult,
  type VerificationResult
} from "@sui402/sui";
import type { ClientWithCoreApi } from "@mysten/sui/client";

export type ChallengeStore = {
  issue(challenge: Sui402Challenge): Promise<void> | void;
  get(id: string): Promise<Sui402Challenge | undefined> | Sui402Challenge | undefined;
  consume(id: string): Promise<boolean> | boolean;
};

export type PaymentVerifier = {
  verifyPayment(challenge: Sui402Challenge, proof: Sui402PaymentProof): Promise<VerificationResult>;
  verifySessionSpend?(
    challenge: Sui402Challenge,
    proof: Sui402SessionSpendProof
  ): Promise<SessionSpendVerificationResult>;
};

export type PaymentRecord = {
  id: string;
  challenge: Sui402Challenge;
  proof: Sui402AnyPaymentProof;
  verification: (VerificationResult | SessionSpendVerificationResult) & { ok: true };
  receipt?: Sui402SignedSpendReceipt;
  resource: string;
  createdAt: string;
};

export type PaymentReceiptIssuer = (input: {
  challenge: Sui402Challenge;
  proof: Sui402AnyPaymentProof;
  verification: (VerificationResult | SessionSpendVerificationResult) & { ok: true };
  request: Request;
}) => Promise<Sui402SignedSpendReceipt | undefined> | Sui402SignedSpendReceipt | undefined;

export type PaymentRecordStore = {
  record(payment: PaymentRecord): Promise<boolean> | boolean;
  get(id: string): Promise<PaymentRecord | undefined> | PaymentRecord | undefined;
  getByProof?(network: Sui402Network, txDigest: string): Promise<PaymentRecord | undefined> | PaymentRecord | undefined;
  getByTxDigest?(txDigest: string, network?: Sui402Network): Promise<PaymentRecord | undefined> | PaymentRecord | undefined;
  listRecent?(limit?: number): Promise<PaymentRecord[]> | PaymentRecord[];
  listByRecipient?(recipient: string): Promise<PaymentRecord[]> | PaymentRecord[];
};

export type HttpMetrics = {
  middleware: RequestHandler;
  render(): string;
};

type HttpMetricBucket = {
  method: string;
  path: string;
  status: string;
  count: number;
  durationSeconds: number;
  durationBucketCounts: number[];
};

export function createHttpMetrics(service: string): HttpMetrics {
  const startedAt = Date.now();
  const buckets = new Map<string, HttpMetricBucket>();
  const durationBuckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  return {
    middleware(req, res, next) {
      const requestStartedAt = process.hrtime.bigint();
      res.on("finish", () => {
        const path = metricPath(req);
        const status = String(res.statusCode);
        const key = JSON.stringify([req.method, path, status]);
        const durationSeconds = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000_000;
        const bucket = buckets.get(key) ?? {
          method: req.method,
          path,
          status,
          count: 0,
          durationSeconds: 0,
          durationBucketCounts: durationBuckets.map(() => 0)
        };
        bucket.count += 1;
        bucket.durationSeconds += durationSeconds;
        durationBuckets.forEach((upperBound, index) => {
          if (durationSeconds <= upperBound) {
            bucket.durationBucketCounts[index] = (bucket.durationBucketCounts[index] ?? 0) + 1;
          }
        });
        buckets.set(key, bucket);
      });
      next();
    },
    render() {
      const serviceLabel = escapePrometheusLabel(service);
      const lines = [
        "# HELP sui402_process_uptime_seconds Process uptime in seconds.",
        "# TYPE sui402_process_uptime_seconds gauge",
        `sui402_process_uptime_seconds{service="${serviceLabel}"} ${(Date.now() - startedAt) / 1000}`,
        "# HELP sui402_http_requests_total HTTP requests completed.",
        "# TYPE sui402_http_requests_total counter",
        "# HELP sui402_http_request_duration_seconds HTTP request duration in seconds.",
        "# TYPE sui402_http_request_duration_seconds histogram"
      ];

      for (const bucket of [...buckets.values()].sort(compareHttpMetricBuckets)) {
        const labels = `service="${serviceLabel}",method="${escapePrometheusLabel(bucket.method)}",path="${escapePrometheusLabel(bucket.path)}",status="${escapePrometheusLabel(bucket.status)}"`;
        lines.push(`sui402_http_requests_total{${labels}} ${bucket.count}`);
        durationBuckets.forEach((upperBound, index) => {
          lines.push(
            `sui402_http_request_duration_seconds_bucket{${labels},le="${upperBound}"} ${bucket.durationBucketCounts[index]}`
          );
        });
        lines.push(`sui402_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${bucket.count}`);
        lines.push(`sui402_http_request_duration_seconds_sum{${labels}} ${bucket.durationSeconds}`);
        lines.push(`sui402_http_request_duration_seconds_count{${labels}} ${bucket.count}`);
      }

      return `${lines.join("\n")}\n`;
    }
  };
}

export type ObservedAgentPaymentSession = {
  sessionId: string;
  network: Sui402Network;
  payer?: string;
  merchant: string;
  coinType: string;
  spendCount: number;
  spentAmount: string;
  resources: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastTxDigest: string;
  lastPaymentId: string;
};

export type ListObservedAgentPaymentSessionsOptions = {
  records: PaymentRecordStore;
  limit?: number;
  recordLimit?: number;
  sessionId?: string;
  payer?: string;
  merchant?: string;
};

export type RequireSuiPaymentOptions = {
  network?: Sui402Network;
  recipient: string;
  coinType: string;
  amount: string;
  description?: string;
  ttlSeconds?: number;
  store?: ChallengeStore;
  records?: PaymentRecordStore;
  verifier?: PaymentVerifier;
  policy?: Sui402SpendingPolicy;
  resource?: (req: Request) => string;
  receiptIssuer?: PaymentReceiptIssuer;
  onVerified?: (
    result: (VerificationResult | SessionSpendVerificationResult) & { ok: true },
    req: Request
  ) => Promise<void> | void;
};

export type Sui402SessionManagerOptions = {
  network?: Sui402Network;
  client?: ClientWithCoreApi;
  packageId: string;
  merchant?: string;
  coinType?: string;
  resourceScopeHash?: string;
  limit?: number;
};

export type SessionManagerConfigResponse = {
  network: Sui402Network;
  packageId: string;
  merchant?: string;
  coinType?: string;
  resourceScopeHash?: string;
};

export type SessionListResponse = {
  owner: string;
  sessions: AgentPaymentSession[];
};

export type UsableSessionResponse = {
  owner: string;
  usable: boolean;
  session?: AgentPaymentSession;
};

export class MemoryChallengeStore implements ChallengeStore {
  #challenges = new Map<string, Sui402Challenge>();
  #consumed = new Set<string>();

  issue(challenge: Sui402Challenge): void {
    this.#challenges.set(challenge.id, challenge);
  }

  get(id: string): Sui402Challenge | undefined {
    const challenge = this.#challenges.get(id);
    if (!challenge || isExpired(challenge.expiresAt)) {
      this.#challenges.delete(id);
      return undefined;
    }

    return challenge;
  }

  consume(id: string): boolean {
    if (this.#consumed.has(id)) {
      return false;
    }

    this.#consumed.add(id);
    this.#challenges.delete(id);
    return true;
  }
}

function metricPath(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath === "string") {
    return `${req.baseUrl}${routePath}` || "/";
  }

  const pathname = req.path || "/";
  return pathname
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return ":id";
      }
      if (/^[a-f0-9]{64}$/i.test(segment) || /^[0-9a-f-]{32,}$/i.test(segment) || segment.length > 80) {
        return ":id";
      }
      return segment;
    })
    .join("/");
}

function escapePrometheusLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\"", "\\\"");
}

function compareHttpMetricBuckets(left: HttpMetricBucket, right: HttpMetricBucket): number {
  return (
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method) ||
    left.status.localeCompare(right.status)
  );
}

export class MemoryPaymentRecordStore implements PaymentRecordStore {
  #records = new Map<string, PaymentRecord>();

  record(payment: PaymentRecord): boolean {
    if (this.#records.has(payment.id) || this.getByProof(payment.proof.network, payment.proof.txDigest)) {
      return false;
    }

    this.#records.set(payment.id, payment);
    return true;
  }

  get(id: string): PaymentRecord | undefined {
    return this.#records.get(id);
  }

  getByProof(network: Sui402Network, txDigest: string): PaymentRecord | undefined {
    return [...this.#records.values()].find(
      (record) => record.proof.network === network && record.proof.txDigest === txDigest
    );
  }

  getByTxDigest(txDigest: string, network?: Sui402Network): PaymentRecord | undefined {
    return [...this.#records.values()].find(
      (record) => record.proof.txDigest === txDigest && (!network || record.proof.network === network)
    );
  }

  listByRecipient(recipient: string): PaymentRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.challenge.recipient.toLowerCase() === recipient.toLowerCase()
    );
  }

  listRecent(limit = 100): PaymentRecord[] {
    return [...this.#records.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }
}

export async function listObservedAgentPaymentSessions(
  options: ListObservedAgentPaymentSessionsOptions
): Promise<ObservedAgentPaymentSession[]> {
  if (!options.records.listRecent) {
    throw new Error("Payment record store does not support recent payment listing");
  }

  const records = await options.records.listRecent(options.recordLimit ?? 1000);
  const sessions = new Map<string, ObservedAgentPaymentSession>();

  for (const record of records) {
    if (record.proof.kind !== "session" || !("sessionId" in record.verification)) {
      continue;
    }

    const proof = record.proof;
    const verification = record.verification;
    const payer = verification.payer ?? proof.payer;
    const merchant = verification.recipient;
    if (options.sessionId && normalizeSessionKey(proof.sessionId) !== normalizeSessionKey(options.sessionId)) {
      continue;
    }

    if (options.payer && (!payer || payer.toLowerCase() !== options.payer.toLowerCase())) {
      continue;
    }

    if (options.merchant && merchant.toLowerCase() !== options.merchant.toLowerCase()) {
      continue;
    }

    const existing = sessions.get(proof.sessionId);
    if (!existing) {
      sessions.set(proof.sessionId, {
        sessionId: proof.sessionId,
        network: proof.network,
        payer,
        merchant,
        coinType: verification.coinType,
        spendCount: 1,
        spentAmount: verification.amount,
        resources: [record.resource],
        firstSeenAt: record.createdAt,
        lastSeenAt: record.createdAt,
        lastTxDigest: proof.txDigest,
        lastPaymentId: record.id
      });
      continue;
    }

    existing.spendCount += 1;
    existing.spentAmount = (BigInt(existing.spentAmount) + BigInt(verification.amount)).toString();
    if (!existing.resources.includes(record.resource)) {
      existing.resources.push(record.resource);
    }

    if (Date.parse(record.createdAt) < Date.parse(existing.firstSeenAt)) {
      existing.firstSeenAt = record.createdAt;
    }

    if (Date.parse(record.createdAt) > Date.parse(existing.lastSeenAt)) {
      existing.lastSeenAt = record.createdAt;
      existing.lastTxDigest = proof.txDigest;
      existing.lastPaymentId = record.id;
    }
  }

  return [...sessions.values()]
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .slice(0, options.limit ?? 100);
}

export function requireSuiPayment(options: RequireSuiPaymentOptions): RequestHandler {
  const store = options.store ?? new MemoryChallengeStore();
  const records = options.records;
  const verifier = options.verifier ?? new Sui402Verifier({ network: options.network ?? "sui:testnet" });
  const ttlSeconds = options.ttlSeconds ?? 300;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const proofHeader = req.header(SUI402_PAYMENT_HEADER);
      if (!proofHeader) {
        await respondWithChallenge(req, res, options, store, ttlSeconds);
        return;
      }

      const proof = decodeHeader(proofHeader, Sui402AnyPaymentProofSchema);
      const challenge = await store.get(proof.challengeId);
      if (!challenge) {
        res.status(402).json({ error: "payment_required", message: "Unknown or expired payment challenge" });
        return;
      }

      if (records?.getByProof) {
        const existingPayment = await records.getByProof(proof.network, proof.txDigest);
        if (existingPayment) {
          res.status(409).json({
            error: "payment_replayed",
            message: "Payment proof transaction has already been used"
          });
          return;
        }
      }

      const verification =
        proof.kind === "session"
          ? await verifySessionPayment(verifier, challenge, proof)
          : await verifier.verifyPayment(challenge, proof);
      if (!verification.ok) {
        res.status(402).json({ error: "payment_required", message: verification.reason });
        return;
      }

      if (options.policy) {
        const decision = evaluateChallengePolicy(options.policy, challenge, { paymentKind: proof.kind });
        if (!decision.ok) {
          res.status(403).json({
            error: "payment_policy_violation",
            message: "Payment proof violates merchant payment policy",
            reasons: decision.reasons
          });
          return;
        }
      }

      const consumed = await store.consume(challenge.id);
      if (!consumed) {
        res.status(409).json({ error: "payment_replayed", message: "Payment challenge already consumed" });
        return;
      }

      const receipt = await options.receiptIssuer?.({
        challenge,
        proof,
        verification,
        request: req
      });

      const paymentRecord: PaymentRecord = {
        id: `${proof.network}:${proof.txDigest}:${challenge.id}`,
        challenge,
        proof,
        verification,
        receipt,
        resource: challenge.resource,
        createdAt: new Date().toISOString()
      };
      const recorded = (await records?.record(paymentRecord)) ?? true;
      if (!recorded) {
        res.status(409).json({
          error: "payment_replayed",
          message: "Payment proof transaction has already been used"
        });
        return;
      }

      await options.onVerified?.(verification, req);
      res.locals.sui402 = { challenge, proof, verification };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createSui402SessionRouter(options: Sui402SessionManagerOptions): express.Router {
  const router = express.Router();
  const network = options.network ?? "sui:testnet";

  router.get("/config", (_req, res) => {
    const body: SessionManagerConfigResponse = {
      network,
      packageId: options.packageId,
      merchant: options.merchant,
      coinType: options.coinType,
      resourceScopeHash: options.resourceScopeHash
    };

    res.json(body);
  });

  router.get("/owners/:owner/sessions", async (req, res, next) => {
    try {
      const owner = req.params.owner;
      if (!owner) {
        res.status(400).json({ error: "invalid_owner", message: "Owner address is required" });
        return;
      }

      const sessions = await listAgentPaymentSessions({
        client: options.client,
        network,
        owner,
        packageId: options.packageId,
        coinType: readOptionalQuery(req.query.coinType) ?? options.coinType,
        limit: readOptionalNumberQuery(req.query.limit) ?? options.limit
      });
      const body: SessionListResponse = { owner, sessions };

      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/owners/:owner/sessions/usable", async (req, res, next) => {
    try {
      const owner = req.params.owner;
      if (!owner) {
        res.status(400).json({ error: "invalid_owner", message: "Owner address is required" });
        return;
      }

      const amount = readRequiredQuery(req.query.amount ?? req.query.minBalance, "amount");
      const merchant = readOptionalQuery(req.query.merchant) ?? options.merchant;
      const resourceScopeHash = readOptionalQuery(req.query.resourceScopeHash) ?? options.resourceScopeHash;
      if (!merchant) {
        res.status(400).json({ error: "invalid_merchant", message: "merchant query parameter is required" });
        return;
      }

      if (!resourceScopeHash) {
        res
          .status(400)
          .json({ error: "invalid_resource_scope", message: "resourceScopeHash query parameter is required" });
        return;
      }

      const session = await findUsableAgentPaymentSession({
        client: options.client,
        network,
        owner,
        packageId: options.packageId,
        coinType: readOptionalQuery(req.query.coinType) ?? options.coinType,
        merchant,
        resourceScopeHash,
        minBalance: amount,
        limit: readOptionalNumberQuery(req.query.limit) ?? options.limit
      });
      const body: UsableSessionResponse = { owner, usable: Boolean(session), session };

      res.json(body);
    } catch (error) {
      if (error instanceof QueryParameterError) {
        res.status(400).json({ error: "invalid_query", message: error.message });
        return;
      }

      next(error);
    }
  });

  return router;
}

async function verifySessionPayment(
  verifier: PaymentVerifier,
  challenge: Sui402Challenge,
  proof: Sui402SessionSpendProof
): Promise<SessionSpendVerificationResult> {
  if (!verifier.verifySessionSpend) {
    return { ok: false, reason: "Session payments are not configured for this server" };
  }

  return verifier.verifySessionSpend(challenge, proof);
}

async function respondWithChallenge(
  req: Request,
  res: Response,
  options: RequireSuiPaymentOptions,
  store: ChallengeStore,
  ttlSeconds: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const challengeInput: Sui402ChallengeInput = {
    network: options.network ?? "sui:testnet",
    recipient: options.recipient,
    coinType: options.coinType,
    amount: options.amount,
    resource: options.resource?.(req) ?? defaultResource(req),
    description: options.description,
    expiresAt
  };

  const challenge = createChallenge(challengeInput);
  await store.issue(challenge);

  const body: Sui402PaymentRequiredResponse = {
    error: "payment_required",
    challenge
  };

  res
    .status(402)
    .setHeader(SUI402_CHALLENGE_HEADER, encodeHeader(challenge))
    .json(body);
}

function normalizeSessionKey(sessionId: string): string {
  return sessionId.toLowerCase();
}

function defaultResource(req: Request): string {
  const protocol = req.protocol;
  const host = req.get("host") ?? "localhost";
  return `${req.method.toUpperCase()} ${protocol}://${host}${req.originalUrl}`;
}

class QueryParameterError extends Error {}

function readRequiredQuery(value: unknown, name: string): string {
  const parsed = readOptionalQuery(value);
  if (!parsed) {
    throw new QueryParameterError(`${name} query parameter is required`);
  }

  return parsed;
}

function readOptionalQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return readOptionalQuery(value[0]);
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumberQuery(value: unknown): number | undefined {
  const parsed = readOptionalQuery(value);
  if (!parsed) {
    return undefined;
  }

  const number = Number(parsed);
  if (!Number.isInteger(number) || number <= 0) {
    throw new QueryParameterError("limit query parameter must be a positive integer");
  }

  return number;
}
