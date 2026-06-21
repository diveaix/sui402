import { describe, expect, it } from "vitest";
import { createChallenge, resourceScopeHash, type Sui402ProviderManifest } from "@sui402/protocol";
import {
  assertChallengeAllowed,
  evaluateChallengePolicy,
  evaluateProviderManifestPolicy,
  isResourceScopeAllowed,
  type Sui402SpendingPolicy
} from "../src/index.js";

const MERCHANT = `0x${"a".repeat(64)}`;
const OTHER_MERCHANT = `0x${"b".repeat(64)}`;

const policy: Sui402SpendingPolicy = {
  allowedNetworks: ["sui:testnet"],
  allowedMerchants: [MERCHANT],
  allowedCoinTypes: ["0x2::sui::SUI"],
  allowedResourceScopes: ["api:*"],
  maxAmount: "1000",
  allowOneShot: true,
  allowSessions: true
};

describe("Sui402 spending policy", () => {
  it("allows matching provider manifests and challenges", () => {
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:premium",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const manifest = makeManifest();

    expect(evaluateChallengePolicy(policy, challenge, { paymentKind: "one-shot" })).toMatchObject({ ok: true });
    expect(evaluateProviderManifestPolicy(policy, manifest)).toMatchObject({ ok: true });
    expect(() => assertChallengeAllowed(policy, challenge, { paymentKind: "session" })).not.toThrow();
  });

  it("rejects disallowed merchants, resources, and amounts", () => {
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: OTHER_MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1001",
      resource: "admin:secrets",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const decision = evaluateChallengePolicy(policy, challenge, { paymentKind: "one-shot" });

    expect(decision.ok).toBe(false);
    expect(decision.reasons).toContain(`Merchant ${OTHER_MERCHANT} is not allowed`);
    expect(decision.reasons).toContain("Amount 1001 exceeds policy maximum 1000");
    expect(decision.reasons).toContain("Resource scope admin:secrets is not allowed");
  });

  it("enforces session-only policies", () => {
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:premium",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const sessionOnly = {
      ...policy,
      requireSession: true,
      allowOneShot: false
    };

    expect(evaluateChallengePolicy(sessionOnly, challenge, { paymentKind: "one-shot" })).toMatchObject({
      ok: false
    });
    expect(evaluateChallengePolicy(sessionOnly, challenge, { paymentKind: "session" })).toMatchObject({
      ok: true
    });
    expect(evaluateProviderManifestPolicy(sessionOnly, { ...makeManifest(), sessions: { enabled: false } })).toMatchObject({
      ok: false
    });
  });

  it("matches resource scope wildcard prefixes", () => {
    expect(isResourceScopeAllowed("api:premium", ["api:*"])).toBe(true);
    expect(isResourceScopeAllowed("admin:premium", ["api:*"])).toBe(false);
    expect(isResourceScopeAllowed("anything", ["*"])).toBe(true);
  });
});

function makeManifest(): Sui402ProviderManifest {
  return {
    version: "sui402-0.1",
    service: "merchant-api",
    network: "sui:testnet",
    merchant: MERCHANT,
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
      packageId: `0x${"f".repeat(64)}`,
      managerPath: "/sui402"
    },
    endpoints: {
      wellKnown: "/.well-known/sui402",
      protectedResource: "/v1/entitlements/current",
      sessionManager: "/sui402"
    }
  };
}
