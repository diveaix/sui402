import { describe, expect, it } from "vitest";
import {
  Sui402ChallengeSchema,
  Sui402PaymentProofSchema,
  Sui402ProviderManifestSchema,
  assertChallengeId,
  createChallenge,
  decodeHeader,
  encodeHeader,
  resourceScopeHash
} from "../src/index.js";

describe("Sui402 protocol", () => {
  it("creates stable challenge ids", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: "0xmerchant",
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2026-05-18T12:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    expect(() => assertChallengeId(challenge)).not.toThrow();
    expect(challenge.id).toHaveLength(64);
  });

  it("encodes challenges for HTTP headers", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: "0xmerchant",
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2026-05-18T12:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const roundTrip = decodeHeader(encodeHeader(challenge), Sui402ChallengeSchema);
    expect(roundTrip).toEqual(challenge);
  });

  it("defaults one-shot payment proof kind", () => {
    const proof = Sui402PaymentProofSchema.parse({
      version: "sui402-0.1",
      challengeId: "challenge",
      network: "sui:testnet",
      txDigest: "digest",
      paidAt: "2026-05-18T12:00:00.000Z"
    });

    expect(proof.kind).toBe("one-shot");
  });

  it("hashes resource scopes deterministically", () => {
    expect(resourceScopeHash("GET https://api.example.com/*")).toHaveLength(64);
    expect(resourceScopeHash("GET https://api.example.com/*")).toBe(resourceScopeHash("GET https://api.example.com/*"));
  });

  it("parses provider discovery manifests", () => {
    const manifest = Sui402ProviderManifestSchema.parse({
      version: "sui402-0.1",
      service: "merchant-api",
      network: "sui:testnet",
      merchant: "0xmerchant",
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*",
      resourceScopeHash: resourceScopeHash("api:*"),
      payments: {
        kinds: ["one-shot", "session"],
        challengeTtlSeconds: 300
      },
      sessions: {
        enabled: true,
        packageId: "0xpackage",
        managerPath: "/sui402"
      },
      endpoints: {
        wellKnown: "/.well-known/sui402",
        protectedResource: "/v1/entitlements/current",
        sessionManager: "/sui402"
      }
    });

    expect(manifest.payments.kinds).toContain("session");
  });
});
