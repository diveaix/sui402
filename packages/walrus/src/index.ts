import { SUI402_VERSION, Sui402NetworkSchema, canonicalJson, sha256 } from "@sui402/protocol";
import { Sui402SignedSpendReceiptSchema } from "@sui402/receipts";
import { z } from "zod";

export const Sui402WalrusArtifactKindSchema = z.enum([
  "receipt-bundle",
  "agent-memory-snapshot",
  "provider-manifest",
  "registry-snapshot",
  "audit-log"
]);

export type Sui402WalrusArtifactKind = z.infer<typeof Sui402WalrusArtifactKindSchema>;

export const Sui402WalrusArtifactInputSchema = z.object({
  kind: Sui402WalrusArtifactKindSchema,
  owner: z.string().min(1),
  network: Sui402NetworkSchema.optional(),
  contentType: z.string().min(1).default("application/json"),
  encrypted: z.boolean().default(false),
  payload: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime()
});

export type Sui402WalrusArtifactInput = z.input<typeof Sui402WalrusArtifactInputSchema>;

export const Sui402WalrusArtifactSchema = Sui402WalrusArtifactInputSchema.extend({
  version: z.literal(SUI402_VERSION),
  id: z.string().regex(/^[a-f0-9]{64}$/i),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/i)
});

export type Sui402WalrusArtifact = z.infer<typeof Sui402WalrusArtifactSchema>;

export const Sui402ReceiptBundlePayloadSchema = z.object({
  receipts: z.array(Sui402SignedSpendReceiptSchema).min(1),
  summary: z
    .object({
      count: z.number().int().nonnegative(),
      totalAmount: z.string().regex(/^\d+$/).optional(),
      coinType: z.string().optional()
    })
    .optional()
});

export type Sui402ReceiptBundlePayload = z.infer<typeof Sui402ReceiptBundlePayloadSchema>;

export const Sui402AgentMemorySnapshotPayloadSchema = z.object({
  subject: z.string().min(1),
  scope: z.string().min(1),
  entries: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "agent", "tool", "system", "summary"]),
      content: z.string(),
      createdAt: z.string().datetime(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })
  ),
  redactions: z.array(z.string()).default([])
});

export type Sui402AgentMemorySnapshotPayload = z.infer<typeof Sui402AgentMemorySnapshotPayloadSchema>;

export type WalrusStoreResponse = {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
  raw: unknown;
};

export type WalrusPublishOptions = {
  publisherUrl: string;
  artifact: Sui402WalrusArtifact;
  epochs?: number;
  deletable?: boolean;
  fetch?: typeof fetch;
};

export type WalrusReadOptions = {
  aggregatorUrl: string;
  blobId: string;
  fetch?: typeof fetch;
};

export function createWalrusArtifact(
  input: Sui402WalrusArtifactInput,
  now = new Date()
): Sui402WalrusArtifact {
  const parsed = Sui402WalrusArtifactInputSchema.parse({
    ...input,
    createdAt: input.createdAt ?? now.toISOString()
  });
  const payloadHash = sha256(canonicalJson(parsed.payload));
  const unsigned = {
    version: SUI402_VERSION,
    ...parsed,
    payloadHash
  } satisfies Omit<Sui402WalrusArtifact, "id">;

  return {
    ...unsigned,
    id: sha256(canonicalJson(unsigned))
  };
}

export function createReceiptBundleArtifact(input: {
  owner: string;
  network?: z.infer<typeof Sui402NetworkSchema>;
  receipts: Sui402ReceiptBundlePayload["receipts"];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): Sui402WalrusArtifact {
  const payload = Sui402ReceiptBundlePayloadSchema.parse({
    receipts: input.receipts,
    summary: {
      count: input.receipts.length,
      coinType: input.receipts[0]?.receipt.coinType,
      totalAmount: sumReceiptAmounts(input.receipts)
    }
  });

  return createWalrusArtifact({
    kind: "receipt-bundle",
    owner: input.owner,
    network: input.network,
    contentType: "application/json",
    encrypted: false,
    payload,
    metadata: input.metadata,
    createdAt: input.createdAt ?? new Date().toISOString()
  });
}

export function createAgentMemorySnapshotArtifact(input: {
  owner: string;
  network?: z.infer<typeof Sui402NetworkSchema>;
  payload: Sui402AgentMemorySnapshotPayload;
  encrypted?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): Sui402WalrusArtifact {
  const payload = Sui402AgentMemorySnapshotPayloadSchema.parse(input.payload);
  return createWalrusArtifact({
    kind: "agent-memory-snapshot",
    owner: input.owner,
    network: input.network,
    contentType: "application/json",
    encrypted: input.encrypted ?? false,
    payload,
    metadata: input.metadata,
    createdAt: input.createdAt ?? new Date().toISOString()
  });
}

export function assertWalrusArtifactId(artifact: Sui402WalrusArtifact): void {
  const parsed = Sui402WalrusArtifactSchema.parse(artifact);
  if (sha256(canonicalJson(parsed.payload)) !== parsed.payloadHash) {
    throw new Error("Invalid Sui402 Walrus artifact payload hash");
  }

  const { id, ...withoutId } = parsed;
  if (sha256(canonicalJson(withoutId)) !== id) {
    throw new Error("Invalid Sui402 Walrus artifact id");
  }
}

export async function publishWalrusArtifact(options: WalrusPublishOptions): Promise<WalrusStoreResponse> {
  assertWalrusArtifactId(options.artifact);
  const httpFetch = options.fetch ?? fetch;
  const url = new URL("/v1/blobs", normalizeBaseUrl(options.publisherUrl));
  if (options.epochs !== undefined) {
    url.searchParams.set("epochs", String(options.epochs));
  }
  if (options.deletable !== undefined) {
    url.searchParams.set("deletable", String(options.deletable));
  }

  const response = await httpFetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: canonicalJson(options.artifact)
  });
  if (!response.ok) {
    throw new Error(`Walrus publisher failed with HTTP ${response.status}`);
  }

  return parseWalrusStoreResponse(await response.json());
}

export async function readWalrusArtifact(options: WalrusReadOptions): Promise<Sui402WalrusArtifact> {
  const httpFetch = options.fetch ?? fetch;
  const url = new URL(`/v1/blobs/${encodeURIComponent(options.blobId)}`, normalizeBaseUrl(options.aggregatorUrl));
  const response = await httpFetch(url);
  if (!response.ok) {
    throw new Error(`Walrus aggregator failed with HTTP ${response.status}`);
  }

  const artifact = Sui402WalrusArtifactSchema.parse(await response.json());
  assertWalrusArtifactId(artifact);
  return artifact;
}

export function parseWalrusStoreResponse(raw: unknown): WalrusStoreResponse {
  const record = asRecord(raw);
  const newlyCreated = asRecord(record.newlyCreated);
  const alreadyCertified = asRecord(record.alreadyCertified);
  const blobObject = asRecord(newlyCreated.blobObject);
  const storage = asRecord(blobObject.storage);
  const blobId = readString(record.blobId) ?? readString(blobObject.blobId) ?? readString(alreadyCertified.blobId);
  if (!blobId) {
    throw new Error("Walrus publisher response did not include a blob id");
  }

  return {
    blobId,
    objectId: readString(blobObject.id) ?? readString(newlyCreated.blobObjectId) ?? readString(record.objectId),
    endEpoch: readNumber(storage.endEpoch) ?? readNumber(record.endEpoch),
    raw
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function sumReceiptAmounts(receipts: Sui402ReceiptBundlePayload["receipts"]): string | undefined {
  if (receipts.length === 0) {
    return undefined;
  }

  return receipts.reduce((sum, receipt) => sum + BigInt(receipt.receipt.amount), 0n).toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
