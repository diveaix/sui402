import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const SUI402_VERSION = "sui402-0.1";
export const SUI402_CHALLENGE_HEADER = "sui402-challenge";
export const SUI402_PAYMENT_HEADER = "sui402-payment";

export const Sui402NetworkSchema = z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]);
export type Sui402Network = z.infer<typeof Sui402NetworkSchema>;

export const Sui402ChallengeInputSchema = z.object({
  network: Sui402NetworkSchema,
  recipient: z.string().min(1),
  coinType: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  resource: z.string().min(1),
  description: z.string().optional(),
  expiresAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type Sui402ChallengeInput = z.infer<typeof Sui402ChallengeInputSchema>;

export const Sui402ChallengeSchema = Sui402ChallengeInputSchema.extend({
  version: z.literal(SUI402_VERSION),
  id: z.string().min(1),
  nonce: z.string().min(16)
});

export type Sui402Challenge = z.infer<typeof Sui402ChallengeSchema>;

export const Sui402PaymentProofSchema = z.object({
  version: z.literal(SUI402_VERSION),
  challengeId: z.string().min(1),
  network: Sui402NetworkSchema,
  txDigest: z.string().min(1),
  payer: z.string().min(1).optional(),
  paidAt: z.string().datetime(),
  kind: z.literal("one-shot").default("one-shot")
});

export type Sui402PaymentProof = z.infer<typeof Sui402PaymentProofSchema>;

export const Sui402SessionPolicySchema = z.object({
  network: Sui402NetworkSchema,
  payer: z.string().min(1),
  merchant: z.string().min(1),
  coinType: z.string().min(1),
  totalBudget: z.string().regex(/^\d+$/),
  maxPerRequest: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  expiresAt: z.string().datetime()
});

export type Sui402SessionPolicy = z.infer<typeof Sui402SessionPolicySchema>;

export const Sui402SessionSpendProofSchema = z.object({
  version: z.literal(SUI402_VERSION),
  kind: z.literal("session"),
  challengeId: z.string().min(1),
  sessionId: z.string().min(1),
  network: Sui402NetworkSchema,
  txDigest: z.string().min(1),
  payer: z.string().min(1).optional(),
  spentAt: z.string().datetime()
});

export type Sui402SessionSpendProof = z.infer<typeof Sui402SessionSpendProofSchema>;

export const Sui402AnyPaymentProofSchema = z.discriminatedUnion("kind", [
  Sui402PaymentProofSchema,
  Sui402SessionSpendProofSchema
]);

export type Sui402AnyPaymentProof = z.infer<typeof Sui402AnyPaymentProofSchema>;

export const Sui402PaymentRequiredResponseSchema = z.object({
  error: z.literal("payment_required"),
  challenge: Sui402ChallengeSchema
});

export type Sui402PaymentRequiredResponse = z.infer<typeof Sui402PaymentRequiredResponseSchema>;

export const Sui402ProviderManifestSchema = z.object({
  version: z.literal(SUI402_VERSION),
  service: z.string().min(1),
  network: Sui402NetworkSchema,
  merchant: z.string().min(1),
  coinType: z.string().min(1),
  price: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  resourceScopeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  payments: z.object({
    kinds: z.array(z.enum(["one-shot", "session"])).min(1),
    challengeTtlSeconds: z.number().int().positive().optional()
  }),
  sessions: z.object({
    enabled: z.boolean(),
    packageId: z.string().min(1).optional(),
    managerPath: z.string().min(1).optional()
  }),
  endpoints: z.object({
    wellKnown: z.string().min(1),
    protectedResource: z.string().min(1).optional(),
    sessionManager: z.string().min(1).optional()
  })
});

export type Sui402ProviderManifest = z.infer<typeof Sui402ProviderManifestSchema>;

export function createChallenge(input: Sui402ChallengeInput, nonce = randomNonce()): Sui402Challenge {
  const parsed = Sui402ChallengeInputSchema.parse(input);
  const unsigned = {
    version: SUI402_VERSION,
    ...parsed,
    nonce
  } satisfies Omit<Sui402Challenge, "id">;

  return {
    ...unsigned,
    id: challengeId(unsigned)
  };
}

export function challengeId(challenge: Omit<Sui402Challenge, "id">): string {
  return sha256(canonicalJson(challenge));
}

export function assertChallengeId(challenge: Sui402Challenge): void {
  const { id, ...rest } = challenge;
  const expected = challengeId(rest);
  if (id !== expected) {
    throw new Error("Invalid Sui402 challenge id");
  }
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeHeader<T>(headerValue: string, schema: z.ZodSchema<T>): T {
  const json = Buffer.from(headerValue, "base64url").toString("utf8");
  return schema.parse(JSON.parse(json));
}

export function randomNonce(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function resourceScopeHash(resourceScope: string): string {
  return sha256(resourceScope);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortKeys(entryValue)])
    );
  }

  return value;
}
