import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ConsoleRoleSchema, ConsoleSellerRoleSchema } from "./auth.js";

export const ConsoleAuditActionSchema = z.enum([
  "merchant.create",
  "seller.merchant.update",
  "seller.merchant_change.request",
  "merchant_change.approve",
  "merchant_change.reject",
  "merchant_application.submit",
  "merchant_application.verify",
  "merchant_application.wallet_proof.verify",
  "merchant_application.probe",
  "merchant_application.publisher_session.issue",
  "merchant_application.publisher_access_token.rotate",
  "merchant_application.approve",
  "merchant_application.reject",
  "indexer.session_spends.ingest",
  "indexer.settlement_events.ingest",
  "indexer.cursor.update",
  "export.payment_ledger.publish",
  "export.receipts.publish",
  "export.audit_head.publish"
]);

export type ConsoleAuditAction = z.infer<typeof ConsoleAuditActionSchema>;

export const ConsoleAuditEventSchema = z.object({
  id: z.string().min(1),
  action: ConsoleAuditActionSchema,
  actorId: z.string().min(1).optional(),
  actorRoles: z.array(z.union([ConsoleRoleSchema, ConsoleSellerRoleSchema])).optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  ip: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  createdAt: z.string().datetime()
});

export type ConsoleAuditEvent = z.infer<typeof ConsoleAuditEventSchema>;

export const ConsoleAuditEventQuerySchema = z.object({
  action: ConsoleAuditActionSchema.optional(),
  actorId: z.string().min(1).optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

export type ConsoleAuditEventQuery = z.infer<typeof ConsoleAuditEventQuerySchema>;

export type ConsoleAuditEventInput = Omit<ConsoleAuditEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

const AUDIT_REDACTED_VALUE = "[redacted:audit-secret]";
const AUDIT_REDACTED_CYCLE = "[redacted:audit-cycle]";
const MAX_AUDIT_METADATA_DEPTH = 12;
const SENSITIVE_AUDIT_KEY_PARTS = [
  "authorization",
  "cookie",
  "cookies",
  "header",
  "headers",
  "password",
  "privatekey",
  "seedphrase",
  "mnemonic",
  "adminkey",
  "adminapikey",
  "operatorapikey",
  "operatorkey",
  "apikey",
  "secret",
  "token",
  "accesstoken",
  "publisheraccesstoken",
  "publishersessiontoken",
  "sessiontoken",
  "verificationtoken",
  "rawauthorizationheader",
  "rawheaders",
  "requestbody",
  "rawrequestbody"
];
const AUDIT_SECRET_VALUE_PATTERN =
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b|sui402(?:p|ps|v)_[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

export interface ConsoleAuditLogStore {
  record(event: ConsoleAuditEvent): Promise<void> | void;
  append?(input: ConsoleAuditEventInput): Promise<ConsoleAuditEvent> | ConsoleAuditEvent;
  list(query?: ConsoleAuditEventQuery): Promise<ConsoleAuditEvent[]> | ConsoleAuditEvent[];
}

export type AuditHashChainVerification = {
  ok: boolean;
  checked: number;
  firstEventId?: string;
  lastEventId?: string;
  rootPreviousHash?: string;
  headHash?: string;
  errors: Array<{
    eventId: string;
    reason: string;
  }>;
};

export class MemoryConsoleAuditLogStore implements ConsoleAuditLogStore {
  readonly #events = new Map<string, ConsoleAuditEvent>();

  record(event: ConsoleAuditEvent): void {
    this.#events.set(event.id, event);
  }

  append(input: ConsoleAuditEventInput): ConsoleAuditEvent {
    const previous = this.list({ limit: 1 })[0];
    const event = createChainedConsoleAuditEvent(input, previous);
    this.record(event);
    return event;
  }

  list(query: ConsoleAuditEventQuery = { limit: 100 }): ConsoleAuditEvent[] {
    return [...this.#events.values()]
      .filter((event) => matchesAuditEventQuery(event, query))
      .sort(compareAuditEventsDescending)
      .slice(0, query.limit);
  }
}

export function createConsoleAuditEvent(input: ConsoleAuditEventInput): ConsoleAuditEvent {
  const event = ConsoleAuditEventSchema.parse({
    ...input,
    metadata: sanitizeAuditMetadata(input.metadata),
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString()
  });
  return ConsoleAuditEventSchema.parse({
    ...event,
    hash: computeAuditEventHash(event)
  });
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  return sanitizeAuditMetadataRecord(metadata, new WeakSet(), 0);
}

export function createChainedConsoleAuditEvent(
  input: ConsoleAuditEventInput,
  previous?: ConsoleAuditEvent
): ConsoleAuditEvent {
  const requestedTimestamp = input.createdAt ? Date.parse(input.createdAt) : Date.now();
  const previousTimestamp = previous ? Date.parse(previous.createdAt) : Number.NEGATIVE_INFINITY;
  const createdAt = new Date(Math.max(requestedTimestamp, previousTimestamp + 1)).toISOString();
  return createConsoleAuditEvent({
    ...input,
    previousHash: previous?.hash,
    createdAt
  });
}

export function verifyAuditHashChain(
  events: ConsoleAuditEvent[],
  options: { allowExternalRoot?: boolean } = {}
): AuditHashChainVerification {
  const chronological = [...events].sort(compareAuditEventsAscending);
  const errors: AuditHashChainVerification["errors"] = [];
  const rootPreviousHash = options.allowExternalRoot ? chronological[0]?.previousHash : undefined;
  let previousHash = rootPreviousHash;

  for (const event of chronological) {
    if (!event.hash) {
      errors.push({ eventId: event.id, reason: "missing_hash" });
      previousHash = undefined;
      continue;
    }

    if (event.previousHash !== previousHash) {
      errors.push({ eventId: event.id, reason: "previous_hash_mismatch" });
    }

    const expectedHash = computeAuditEventHash(event);
    if (event.hash.toLowerCase() !== expectedHash) {
      errors.push({ eventId: event.id, reason: "hash_mismatch" });
    }

    previousHash = event.hash;
  }

  return {
    ok: errors.length === 0,
    checked: chronological.length,
    firstEventId: chronological[0]?.id,
    lastEventId: chronological.at(-1)?.id,
    rootPreviousHash,
    headHash: chronological.at(-1)?.hash,
    errors
  };
}

export function matchesAuditEventQuery(event: ConsoleAuditEvent, query: ConsoleAuditEventQuery): boolean {
  return (
    (!query.action || event.action === query.action) &&
    (!query.actorId || event.actorId === query.actorId) &&
    (!query.targetType || event.targetType === query.targetType) &&
    (!query.targetId || event.targetId === query.targetId)
  );
}

export function compareAuditEventsDescending(left: ConsoleAuditEvent, right: ConsoleAuditEvent): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}

function compareAuditEventsAscending(left: ConsoleAuditEvent, right: ConsoleAuditEvent): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}

function sanitizeAuditMetadataValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return AUDIT_SECRET_VALUE_PATTERN.test(value) ? AUDIT_REDACTED_VALUE : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return AUDIT_REDACTED_CYCLE;
  }

  if (depth >= MAX_AUDIT_METADATA_DEPTH) {
    return "[redacted:audit-depth]";
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeAuditMetadataValue(entry, seen, depth + 1));
    }

    return sanitizeAuditMetadataRecord(value as Record<string, unknown>, seen, depth + 1);
  } finally {
    seen.delete(value);
  }
}

function sanitizeAuditMetadataRecord(
  record: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      isSensitiveAuditMetadataKey(key) ? AUDIT_REDACTED_VALUE : sanitizeAuditMetadataValue(value, seen, depth)
    ])
  );
}

function isSensitiveAuditMetadataKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (isAuditDigestKey(normalized)) {
    return false;
  }

  if (isAuditSecretStatusKey(normalized)) {
    return false;
  }

  return SENSITIVE_AUDIT_KEY_PARTS.some((part) => normalized.includes(part));
}

function isAuditDigestKey(normalizedKey: string): boolean {
  return (
    normalizedKey.endsWith("hash") ||
    normalizedKey.endsWith("digest") ||
    normalizedKey.endsWith("fingerprint") ||
    normalizedKey.endsWith("checksum")
  );
}

function isAuditSecretStatusKey(normalizedKey: string): boolean {
  return (
    normalizedKey.endsWith("present") ||
    normalizedKey.endsWith("missing") ||
    normalizedKey.endsWith("wasmissing") ||
    normalizedKey.endsWith("configured") ||
    normalizedKey.endsWith("enabled")
  );
}

function computeAuditEventHash(event: ConsoleAuditEvent): string {
  const { hash: _hash, ...hashable } = event;
  return createHash("sha256").update(canonicalJson(hashable)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
