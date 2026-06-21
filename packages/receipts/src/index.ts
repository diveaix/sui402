import { sign as nodeSign, verify as nodeVerify, type KeyLike } from "node:crypto";
import { z } from "zod";
import {
  SUI402_VERSION,
  type Sui402AnyPaymentProof,
  type Sui402Challenge,
  Sui402NetworkSchema,
  canonicalJson,
  isExpired,
  randomNonce,
  resourceScopeHash,
  sha256
} from "@sui402/protocol";

export const Sui402SpendReceiptInputSchema = z.object({
  network: Sui402NetworkSchema,
  sessionId: z.string().min(1),
  payer: z.string().min(1),
  merchant: z.string().min(1),
  coinType: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  resource: z.string().min(1),
  sequence: z.string().regex(/^\d+$/),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type Sui402SpendReceiptInput = z.infer<typeof Sui402SpendReceiptInputSchema>;

export const Sui402SpendReceiptSchema = Sui402SpendReceiptInputSchema.extend({
  version: z.literal(SUI402_VERSION),
  id: z.string().regex(/^[a-f0-9]{64}$/i),
  nonce: z.string().min(16),
  resourceScopeHash: z.string().regex(/^[a-f0-9]{64}$/i)
});

export type Sui402SpendReceipt = z.infer<typeof Sui402SpendReceiptSchema>;

export const Sui402SignedSpendReceiptSchema = z.object({
  receipt: Sui402SpendReceiptSchema,
  signatureScheme: z.literal("ed25519"),
  signer: z.string().min(1),
  signature: z.string().min(1)
});

export type Sui402SignedSpendReceipt = z.infer<typeof Sui402SignedSpendReceiptSchema>;

export type ReceiptVerificationResult =
  | {
      ok: true;
      receipt: Sui402SpendReceipt;
    }
  | {
      ok: false;
      reason: string;
    };

export const ReceiptFinalityPolicySchema = z.object({
  minSettlementDelaySeconds: z.number().int().nonnegative().default(0),
  disputeWindowSeconds: z.number().int().nonnegative().default(24 * 60 * 60),
  maxReceiptAgeSeconds: z.number().int().positive().optional()
});

export type ReceiptFinalityPolicy = z.infer<typeof ReceiptFinalityPolicySchema>;

export type ReceiptFinalityStatus = "pending" | "disputable" | "final" | "expired";

export type ReceiptFinalityDecision = {
  status: ReceiptFinalityStatus;
  issuedAt: string;
  expiresAt: string;
  settleAfter: string;
  disputeUntil: string;
  reasons: string[];
};

export type ReceiptSequenceValidationResult =
  | {
      ok: true;
      checked: number;
    }
  | {
      ok: false;
      checked: number;
      reason: string;
      receiptId?: string;
    };

export type ReceiptSequenceStore = {
  nextSequence(key: string): Promise<string> | string;
};

export type SpendReceiptSigner = {
  signer: string;
  signatureScheme: "ed25519";
  sign(bytes: Buffer): Promise<string> | string;
};

export class LocalEd25519SpendReceiptSigner implements SpendReceiptSigner {
  readonly signer: string;
  readonly signatureScheme = "ed25519" as const;
  readonly #privateKey: KeyLike;

  constructor(options: { signer: string; privateKey: KeyLike }) {
    this.signer = options.signer;
    this.#privateKey = options.privateKey;
  }

  sign(bytes: Buffer): string {
    return nodeSign(null, bytes, this.#privateKey).toString("base64url");
  }
}

export type AwsKmsEd25519SignInput = {
  KeyId: string;
  Message: Buffer;
  MessageType: "RAW";
  SigningAlgorithm: "ED25519_SHA_512";
};

export type AwsKmsEd25519SignOutput = {
  Signature?: Uint8Array | Buffer | string;
};

export type AwsKmsEd25519SignClient =
  | {
      sign(input: AwsKmsEd25519SignInput): Promise<AwsKmsEd25519SignOutput> | AwsKmsEd25519SignOutput;
    }
  | {
      send(command: unknown): Promise<AwsKmsEd25519SignOutput> | AwsKmsEd25519SignOutput;
    };

export class AwsKmsEd25519SpendReceiptSigner implements SpendReceiptSigner {
  readonly signer: string;
  readonly signatureScheme = "ed25519" as const;
  readonly #keyId: string;
  readonly #client: AwsKmsEd25519SignClient;
  readonly #commandFactory?: (input: AwsKmsEd25519SignInput) => unknown;

  constructor(options: {
    signer: string;
    keyId: string;
    client: AwsKmsEd25519SignClient;
    commandFactory?: (input: AwsKmsEd25519SignInput) => unknown;
  }) {
    this.signer = options.signer;
    this.#keyId = options.keyId;
    this.#client = options.client;
    this.#commandFactory = options.commandFactory;
  }

  async sign(bytes: Buffer): Promise<string> {
    const input = {
      KeyId: this.#keyId,
      Message: bytes,
      MessageType: "RAW",
      SigningAlgorithm: "ED25519_SHA_512"
    } satisfies AwsKmsEd25519SignInput;
    const output =
      "sign" in this.#client
        ? await this.#client.sign(input)
        : await this.#client.send(this.#commandFactory ? this.#commandFactory(input) : input);

    return encodeRemoteSignature(output.Signature, "AWS KMS");
  }
}

export type GcpKmsEd25519SignRequest = {
  name: string;
  data: Buffer;
};

export type GcpKmsEd25519SignResponse = {
  signature?: Uint8Array | Buffer | string;
  verifiedDataCrc32c?: boolean;
};

export type GcpKmsEd25519SignClient = {
  asymmetricSign(
    request: GcpKmsEd25519SignRequest
  ):
    | Promise<GcpKmsEd25519SignResponse | [GcpKmsEd25519SignResponse]>
    | GcpKmsEd25519SignResponse
    | [GcpKmsEd25519SignResponse];
};

export class GcpKmsEd25519SpendReceiptSigner implements SpendReceiptSigner {
  readonly signer: string;
  readonly signatureScheme = "ed25519" as const;
  readonly #keyVersionName: string;
  readonly #client: GcpKmsEd25519SignClient;
  readonly #requireVerifiedDataCrc32c: boolean;

  constructor(options: {
    signer: string;
    keyVersionName: string;
    client: GcpKmsEd25519SignClient;
    requireVerifiedDataCrc32c?: boolean;
  }) {
    this.signer = options.signer;
    this.#keyVersionName = options.keyVersionName;
    this.#client = options.client;
    this.#requireVerifiedDataCrc32c = options.requireVerifiedDataCrc32c ?? false;
  }

  async sign(bytes: Buffer): Promise<string> {
    const raw = await this.#client.asymmetricSign({
      name: this.#keyVersionName,
      data: bytes
    });
    const response = Array.isArray(raw) ? raw[0] : raw;
    if (this.#requireVerifiedDataCrc32c && response.verifiedDataCrc32c === false) {
      throw new Error("GCP KMS did not verify receipt signing payload CRC32C");
    }

    return encodeRemoteSignature(response.signature, "GCP KMS");
  }
}

export class MemoryReceiptSequenceStore implements ReceiptSequenceStore {
  readonly #sequences = new Map<string, bigint>();

  nextSequence(key: string): string {
    const next = (this.#sequences.get(key) ?? 0n) + 1n;
    this.#sequences.set(key, next);
    return next.toString();
  }
}

export type SessionReceiptIssuerInput = {
  challenge: Sui402Challenge;
  proof: Sui402AnyPaymentProof;
  verification: {
    ok: true;
    digest: string;
    payer?: string;
    recipient: string;
    amount: string;
    coinType: string;
    sessionId?: string;
  };
};

export type CreateSessionSpendReceiptIssuerOptions = {
  signer: string;
  privateKey?: KeyLike;
  receiptSigner?: SpendReceiptSigner;
  sequenceStore?: ReceiptSequenceStore;
  ttlSeconds?: number;
  now?: () => Date;
  metadata?: (input: SessionReceiptIssuerInput) => Record<string, unknown> | undefined;
};

export function createSessionSpendReceiptIssuer(options: CreateSessionSpendReceiptIssuerOptions): (
  input: SessionReceiptIssuerInput
) => Promise<Sui402SignedSpendReceipt | undefined> {
  const sequenceStore = options.sequenceStore ?? new MemoryReceiptSequenceStore();
  const receiptSigner =
    options.receiptSigner ??
    (options.privateKey
      ? new LocalEd25519SpendReceiptSigner({ signer: options.signer, privateKey: options.privateKey })
      : undefined);
  if (!receiptSigner) {
    throw new Error("createSessionSpendReceiptIssuer requires privateKey or receiptSigner");
  }

  if (receiptSigner.signer !== options.signer) {
    throw new Error("Receipt signer id must match issuer signer id");
  }

  const now = options.now ?? (() => new Date());
  const ttlSeconds = options.ttlSeconds ?? 24 * 60 * 60;

  return async (input) => {
    if (input.proof.kind !== "session" || !input.verification.sessionId) {
      return undefined;
    }

    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const sequence = await sequenceStore.nextSequence(receiptSequenceKey(input));
    const receipt = createSpendReceipt({
      network: input.challenge.network,
      sessionId: input.verification.sessionId,
      payer: input.verification.payer ?? input.proof.payer ?? "unknown",
      merchant: input.challenge.recipient,
      coinType: input.challenge.coinType,
      amount: input.challenge.amount,
      resource: input.challenge.resource,
      sequence,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadata: options.metadata?.(input)
    });

    return signSpendReceiptWithSigner({
      receipt,
      receiptSigner
    });
  };
}

export function createSpendReceipt(input: Sui402SpendReceiptInput, nonce = randomNonce()): Sui402SpendReceipt {
  const parsed = Sui402SpendReceiptInputSchema.parse(input);
  const unsigned = {
    version: SUI402_VERSION,
    ...parsed,
    nonce,
    resourceScopeHash: resourceScopeHash(parsed.resource)
  } satisfies Omit<Sui402SpendReceipt, "id">;

  return {
    ...unsigned,
    id: receiptId(unsigned)
  };
}

export function receiptId(receipt: Omit<Sui402SpendReceipt, "id">): string {
  return sha256(canonicalJson(receipt));
}

export function assertReceiptId(receipt: Sui402SpendReceipt): void {
  const { id, ...rest } = receipt;
  const expected = receiptId(rest);
  if (id !== expected) {
    throw new Error("Invalid Sui402 spend receipt id");
  }
}

export function signSpendReceipt(input: {
  receipt: Sui402SpendReceipt;
  signer: string;
  privateKey: KeyLike;
}): Sui402SignedSpendReceipt {
  assertReceiptId(input.receipt);
  const signature = nodeSign(null, receiptSigningBytes(input.receipt), input.privateKey).toString("base64url");
  return {
    receipt: input.receipt,
    signatureScheme: "ed25519",
    signer: input.signer,
    signature
  };
}

export async function signSpendReceiptWithSigner(input: {
  receipt: Sui402SpendReceipt;
  receiptSigner: SpendReceiptSigner;
}): Promise<Sui402SignedSpendReceipt> {
  assertReceiptId(input.receipt);
  const signature = await input.receiptSigner.sign(receiptSigningBytes(input.receipt));
  return {
    receipt: input.receipt,
    signatureScheme: input.receiptSigner.signatureScheme,
    signer: input.receiptSigner.signer,
    signature
  };
}

export function verifySignedSpendReceipt(
  input: Sui402SignedSpendReceipt,
  publicKey: KeyLike,
  now = new Date()
): ReceiptVerificationResult {
  const signed = Sui402SignedSpendReceiptSchema.parse(input);

  try {
    assertReceiptId(signed.receipt);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid receipt id" };
  }

  if (isExpired(signed.receipt.expiresAt, now)) {
    return { ok: false, reason: "Spend receipt expired" };
  }

  const verified = nodeVerify(
    null,
    receiptSigningBytes(signed.receipt),
    publicKey,
    Buffer.from(signed.signature, "base64url")
  );
  if (!verified) {
    return { ok: false, reason: "Invalid spend receipt signature" };
  }

  return {
    ok: true,
    receipt: signed.receipt
  };
}

export function evaluateReceiptFinality(
  input: Sui402SpendReceipt | Sui402SignedSpendReceipt,
  policyInput: Partial<ReceiptFinalityPolicy> = {},
  now = new Date()
): ReceiptFinalityDecision {
  const receipt = "receipt" in input ? input.receipt : input;
  const policy = ReceiptFinalityPolicySchema.parse(policyInput);
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  const settleAfter = issuedAt + policy.minSettlementDelaySeconds * 1000;
  const disputeUntil = issuedAt + policy.disputeWindowSeconds * 1000;
  const nowMs = now.getTime();
  const reasons: string[] = [];

  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) {
    throw new Error("Receipt finality requires valid issuedAt and expiresAt timestamps");
  }

  if (nowMs > expiresAt) {
    reasons.push("receipt_expired");
    return finalityDecision("expired", receipt, settleAfter, disputeUntil, reasons);
  }

  if (policy.maxReceiptAgeSeconds !== undefined && nowMs - issuedAt > policy.maxReceiptAgeSeconds * 1000) {
    reasons.push("receipt_age_exceeds_policy");
    return finalityDecision("expired", receipt, settleAfter, disputeUntil, reasons);
  }

  if (nowMs < settleAfter) {
    reasons.push("settlement_delay_open");
    return finalityDecision("pending", receipt, settleAfter, disputeUntil, reasons);
  }

  if (nowMs < disputeUntil) {
    reasons.push("dispute_window_open");
    return finalityDecision("disputable", receipt, settleAfter, disputeUntil, reasons);
  }

  return finalityDecision("final", receipt, settleAfter, disputeUntil, reasons);
}

export function validateMonotonicReceiptSequences(
  receipts: Array<Sui402SpendReceipt | Sui402SignedSpendReceipt>
): ReceiptSequenceValidationResult {
  const lastByStream = new Map<string, { sequence: bigint; receiptId: string }>();
  let checked = 0;

  for (const input of receipts) {
    const receipt = "receipt" in input ? input.receipt : input;
    checked += 1;
    const sequence = BigInt(receipt.sequence);
    const streamKey = receiptSequenceStreamKey(receipt);
    const previous = lastByStream.get(streamKey);
    if (previous && sequence <= previous.sequence) {
      return {
        ok: false,
        checked,
        receiptId: receipt.id,
        reason: `Receipt sequence ${receipt.sequence} is not greater than previous sequence ${previous.sequence.toString()} for stream ${streamKey}`
      };
    }

    lastByStream.set(streamKey, { sequence, receiptId: receipt.id });
  }

  return { ok: true, checked };
}

export function receiptSigningBytes(receipt: Sui402SpendReceipt): Buffer {
  return Buffer.from(canonicalJson(receipt), "utf8");
}

function finalityDecision(
  status: ReceiptFinalityStatus,
  receipt: Sui402SpendReceipt,
  settleAfter: number,
  disputeUntil: number,
  reasons: string[]
): ReceiptFinalityDecision {
  return {
    status,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    settleAfter: new Date(settleAfter).toISOString(),
    disputeUntil: new Date(disputeUntil).toISOString(),
    reasons
  };
}

function encodeRemoteSignature(signature: Uint8Array | Buffer | string | undefined, provider: string): string {
  if (!signature) {
    throw new Error(`${provider} signing response did not include a signature`);
  }

  if (typeof signature === "string") {
    return Buffer.from(signature, "base64").toString("base64url");
  }

  return Buffer.from(signature).toString("base64url");
}

function receiptSequenceKey(input: SessionReceiptIssuerInput): string {
  return `${input.challenge.network}:${input.verification.sessionId}:${input.challenge.recipient}:${input.challenge.resource}`;
}

function receiptSequenceStreamKey(receipt: Sui402SpendReceipt): string {
  return `${receipt.network}:${receipt.sessionId}:${receipt.merchant}:${receipt.resourceScopeHash}`;
}
