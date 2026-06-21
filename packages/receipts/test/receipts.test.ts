import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AwsKmsEd25519SpendReceiptSigner,
  assertReceiptId,
  GcpKmsEd25519SpendReceiptSigner,
  LocalEd25519SpendReceiptSigner,
  createSpendReceipt,
  createSessionSpendReceiptIssuer,
  evaluateReceiptFinality,
  receiptSigningBytes,
  signSpendReceipt,
  signSpendReceiptWithSigner,
  validateMonotonicReceiptSequences,
  verifySignedSpendReceipt
} from "../src/index.js";

const PAYER = `0x${"b".repeat(64)}`;
const MERCHANT = `0x${"a".repeat(64)}`;
const SESSION = `0x${"e".repeat(64)}`;

describe("Sui402 spend receipts", () => {
  it("creates stable receipt ids", () => {
    const first = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const second = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");

    expect(first.id).toBe(second.id);
    expect(first.resourceScopeHash).toHaveLength(64);
    expect(() => assertReceiptId(first)).not.toThrow();
  });

  it("signs and verifies spend receipts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const signed = signSpendReceipt({
      receipt,
      signer: PAYER,
      privateKey
    });

    expect(verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:00.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("signs receipts through a pluggable signer", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const signed = await signSpendReceiptWithSigner({
      receipt,
      receiptSigner: new LocalEd25519SpendReceiptSigner({
        signer: PAYER,
        privateKey
      })
    });

    expect(signed.signer).toBe(PAYER);
    expect(verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:00.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("issues receipts through a remote signer callback", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const issuer = createSessionSpendReceiptIssuer({
      signer: MERCHANT,
      receiptSigner: {
        signer: MERCHANT,
        signatureScheme: "ed25519",
        sign: (bytes) => signWithNodePrivateKey(bytes, privateKey)
      },
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      ttlSeconds: 60
    });
    const signed = await issuer(sessionIssuerInput());

    expect(signed?.signer).toBe(MERCHANT);
    expect(signed && verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:30.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("signs receipts through an AWS KMS Ed25519 adapter", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const calls: unknown[] = [];
    const signer = new AwsKmsEd25519SpendReceiptSigner({
      signer: MERCHANT,
      keyId: "arn:aws:kms:us-east-1:123456789012:key/key-id",
      client: {
        sign: (input) => {
          calls.push(input);
          return {
            Signature: Buffer.from(signWithNodePrivateKey(input.Message, privateKey), "base64url")
          };
        }
      }
    });
    const signed = await signSpendReceiptWithSigner({ receipt, receiptSigner: signer });

    expect(calls[0]).toMatchObject({
      KeyId: "arn:aws:kms:us-east-1:123456789012:key/key-id",
      MessageType: "RAW",
      SigningAlgorithm: "ED25519_SHA_512"
    });
    expect(Buffer.compare((calls[0] as { Message: Buffer }).Message, receiptSigningBytes(receipt))).toBe(0);
    expect(verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:00.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("signs receipts through a GCP KMS Ed25519 adapter", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const calls: unknown[] = [];
    const signer = new GcpKmsEd25519SpendReceiptSigner({
      signer: MERCHANT,
      keyVersionName: "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
      requireVerifiedDataCrc32c: true,
      client: {
        asymmetricSign: (request) => {
          calls.push(request);
          return [
            {
              signature: Buffer.from(signWithNodePrivateKey(request.data, privateKey), "base64url"),
              verifiedDataCrc32c: true
            }
          ];
        }
      }
    });
    const signed = await signSpendReceiptWithSigner({ receipt, receiptSigner: signer });

    expect(calls[0]).toMatchObject({
      name: "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1"
    });
    expect(Buffer.compare((calls[0] as { data: Buffer }).data, receiptSigningBytes(receipt))).toBe(0);
    expect(verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:00.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("fails closed when KMS signers do not return signatures", async () => {
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");

    await expect(
      signSpendReceiptWithSigner({
        receipt,
        receiptSigner: new AwsKmsEd25519SpendReceiptSigner({
          signer: MERCHANT,
          keyId: "key-id",
          client: {
            sign: () => ({})
          }
        })
      })
    ).rejects.toThrow("AWS KMS signing response did not include a signature");

    await expect(
      signSpendReceiptWithSigner({
        receipt,
        receiptSigner: new GcpKmsEd25519SpendReceiptSigner({
          signer: MERCHANT,
          keyVersionName: "key-version",
          requireVerifiedDataCrc32c: true,
          client: {
            asymmetricSign: () => ({ signature: Buffer.alloc(64), verifiedDataCrc32c: false })
          }
        })
      })
    ).rejects.toThrow("GCP KMS did not verify receipt signing payload CRC32C");
  });

  it("rejects tampered receipts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(makeInput(), "nonce-with-enough-entropy");
    const signed = signSpendReceipt({ receipt, signer: PAYER, privateKey });
    const tampered = {
      ...signed,
      receipt: {
        ...signed.receipt,
        amount: "2"
      }
    };

    expect(verifySignedSpendReceipt(tampered, publicKey, new Date("2026-05-19T00:00:00.000Z"))).toMatchObject({
      ok: false,
      reason: "Invalid Sui402 spend receipt id"
    });
  });

  it("rejects expired receipts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createSpendReceipt(
      {
        ...makeInput(),
        expiresAt: "2026-05-19T00:00:01.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const signed = signSpendReceipt({ receipt, signer: PAYER, privateKey });

    expect(verifySignedSpendReceipt(signed, publicKey, new Date("2026-05-19T00:00:02.000Z"))).toMatchObject({
      ok: false,
      reason: "Spend receipt expired"
    });
  });

  it("issues signed session spend receipts with monotonic sequences", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const issuer = createSessionSpendReceiptIssuer({
      signer: MERCHANT,
      privateKey,
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      ttlSeconds: 60
    });
    const input = sessionIssuerInput();

    const first = await issuer(input);
    const second = await issuer(input);

    expect(first?.receipt.sequence).toBe("1");
    expect(second?.receipt.sequence).toBe("2");
    expect(first?.receipt.expiresAt).toBe("2026-05-19T00:01:00.000Z");
    expect(first && verifySignedSpendReceipt(first, publicKey, new Date("2026-05-19T00:00:30.000Z"))).toMatchObject({
      ok: true
    });
  });

  it("evaluates receipt settlement and dispute finality windows", () => {
    const receipt = createSpendReceipt(
      {
        ...makeInput(),
        issuedAt: "2026-05-19T00:00:00.000Z",
        expiresAt: "2026-05-19T01:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const policy = {
      minSettlementDelaySeconds: 60,
      disputeWindowSeconds: 300
    };

    expect(evaluateReceiptFinality(receipt, policy, new Date("2026-05-19T00:00:30.000Z"))).toMatchObject({
      status: "pending",
      settleAfter: "2026-05-19T00:01:00.000Z",
      disputeUntil: "2026-05-19T00:05:00.000Z",
      reasons: ["settlement_delay_open"]
    });
    expect(evaluateReceiptFinality(receipt, policy, new Date("2026-05-19T00:02:00.000Z"))).toMatchObject({
      status: "disputable",
      reasons: ["dispute_window_open"]
    });
    expect(evaluateReceiptFinality(receipt, policy, new Date("2026-05-19T00:06:00.000Z"))).toMatchObject({
      status: "final",
      reasons: []
    });
    expect(evaluateReceiptFinality(receipt, policy, new Date("2026-05-19T01:00:01.000Z"))).toMatchObject({
      status: "expired",
      reasons: ["receipt_expired"]
    });
  });

  it("validates monotonic receipt sequences per receipt stream", () => {
    const first = createSpendReceipt({ ...makeInput(), sequence: "1" }, "nonce-with-enough-entropy-1");
    const second = createSpendReceipt({ ...makeInput(), sequence: "2" }, "nonce-with-enough-entropy-2");
    const duplicate = createSpendReceipt({ ...makeInput(), sequence: "2" }, "nonce-with-enough-entropy-3");
    const otherStream = createSpendReceipt(
      { ...makeInput(), resource: "api:other-call", sequence: "1" },
      "nonce-with-enough-entropy-4"
    );

    expect(validateMonotonicReceiptSequences([first, second, otherStream])).toMatchObject({
      ok: true,
      checked: 3
    });
    expect(validateMonotonicReceiptSequences([first, second, duplicate])).toMatchObject({
      ok: false,
      checked: 3,
      receiptId: duplicate.id
    });
  });
});

function makeInput() {
  return {
    network: "sui:testnet" as const,
    sessionId: SESSION,
    payer: PAYER,
    merchant: MERCHANT,
    coinType: "0x2::sui::SUI",
    amount: "1",
    resource: "api:tiny-call",
    sequence: "1",
    issuedAt: "2026-05-19T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
}

function sessionIssuerInput() {
  return {
    challenge: {
      version: "sui402-0.1" as const,
      id: "challenge-id",
      nonce: "nonce-with-enough-entropy",
      network: "sui:testnet" as const,
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1",
      resource: "api:tiny-call",
      expiresAt: "2099-01-01T00:00:00.000Z"
    },
    proof: {
      version: "sui402-0.1" as const,
      kind: "session" as const,
      challengeId: "challenge-id",
      sessionId: SESSION,
      network: "sui:testnet" as const,
      txDigest: "digest-1",
      payer: PAYER,
      spentAt: "2026-05-19T00:00:00.000Z"
    },
    verification: {
      ok: true as const,
      digest: "digest-1",
      sessionId: SESSION,
      payer: PAYER,
      recipient: MERCHANT,
      amount: "1",
      coinType: "0x2::sui::SUI"
    }
  };
}

function signWithNodePrivateKey(bytes: Buffer, privateKey: KeyObject): string {
  return nodeSign(null, bytes, privateKey).toString("base64url");
}
