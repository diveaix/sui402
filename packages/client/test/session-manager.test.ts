import { describe, expect, it } from "vitest";
import {
  Sui402Client,
  Sui402SessionManagerClient,
  createPolicyGuardedPaymentHandler,
  createSuiPaymentHandler,
  discoverSui402Provider
} from "../src/index.js";
import { createChallenge, resourceScopeHash } from "@sui402/protocol";

const PACKAGE = `0x${"f".repeat(64)}`;
const OWNER = `0x${"b".repeat(64)}`;
const MERCHANT = `0x${"a".repeat(64)}`;
const SESSION = `0x${"e".repeat(64)}`;

describe("Sui402SessionManagerClient", () => {
  it("rejects corrupt challenge ids before invoking payment handlers", async () => {
    let called = false;
    const validChallenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "api:premium",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const client = new Sui402Client({
      fetch: async () =>
        Response.json(
          { error: "payment_required", challenge: { ...validChallenge, id: "tampered" } },
          { status: 402 }
        ),
      paymentHandler: async ({ challenge }) => {
        called = true;
        return {
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: challenge.id,
          network: challenge.network,
          txDigest: "digest",
          paidAt: "2026-05-19T00:00:00.000Z"
        };
      }
    });

    await expect(client.fetch("https://merchant.example/pay")).rejects.toThrow("Invalid Sui402 challenge id");
    expect(called).toBe(false);
  });

  it("rejects expired challenges before invoking payment handlers", async () => {
    let called = false;
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "api:premium",
        expiresAt: "2000-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const client = new Sui402Client({
      fetch: async () => Response.json({ error: "payment_required", challenge }, { status: 402 }),
      paymentHandler: async ({ challenge }) => {
        called = true;
        return {
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: challenge.id,
          network: challenge.network,
          txDigest: "digest",
          paidAt: "2026-05-19T00:00:00.000Z"
        };
      }
    });

    await expect(client.fetch("https://merchant.example/pay")).rejects.toThrow("Sui402 challenge is expired");
    expect(called).toBe(false);
  });

  it("wraps payment handlers with policy checks", async () => {
    const guarded = createPolicyGuardedPaymentHandler(
      async ({ challenge }) => ({
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: challenge.network,
        txDigest: "digest",
        spentAt: "2026-05-19T00:00:00.000Z"
      }),
      {
        paymentKind: "session",
        policy: {
          allowedNetworks: ["sui:testnet"],
          allowedMerchants: [MERCHANT],
          allowedCoinTypes: ["0x2::sui::SUI"],
          allowedResourceScopes: ["api:*"],
          maxAmount: "1000",
          requireSession: true,
          allowOneShot: false
        }
      }
    );
    const challenge = {
      version: "sui402-0.1" as const,
      id: "challenge",
      network: "sui:testnet" as const,
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:premium",
      nonce: "nonce-with-enough-entropy",
      expiresAt: "2099-01-01T00:00:00.000Z"
    };

    await expect(guarded({ challenge, originalRequest: new Request("https://merchant.example") })).resolves.toMatchObject({
      kind: "session"
    });
  });

  it("rejects policy-blocked payments before invoking the signer", async () => {
    let called = false;
    const guarded = createPolicyGuardedPaymentHandler(
      async ({ challenge }) => {
        called = true;
        return {
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: challenge.id,
          network: challenge.network,
          txDigest: "digest",
          paidAt: "2026-05-19T00:00:00.000Z"
        };
      },
      {
        paymentKind: "one-shot",
        policy: {
          allowedNetworks: ["sui:testnet"],
          allowedMerchants: [MERCHANT],
          maxAmount: "1000"
        }
      }
    );
    const challenge = {
      version: "sui402-0.1" as const,
      id: "challenge",
      network: "sui:testnet" as const,
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1001",
      resource: "api:premium",
      nonce: "nonce-with-enough-entropy",
      expiresAt: "2099-01-01T00:00:00.000Z"
    };

    await expect(guarded({ challenge, originalRequest: new Request("https://merchant.example") })).rejects.toThrow(
      "exceeds policy maximum"
    );
    expect(called).toBe(false);
  });

  it("discovers Sui402 provider manifests", async () => {
    const manifest = await discoverSui402Provider("https://merchant.example", {
      fetch: async (input) => {
        expect(String(input)).toBe("https://merchant.example/.well-known/sui402");

        return Response.json({
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
            packageId: PACKAGE,
            managerPath: "/sui402"
          },
          endpoints: {
            wellKnown: "/.well-known/sui402",
            protectedResource: "/v1/entitlements/current",
            sessionManager: "/sui402"
          }
        });
      }
    });

    expect(manifest.service).toBe("merchant-api");
    expect(manifest.sessions.packageId).toBe(PACKAGE);
  });

  it("auto-selects non-SUI payment coins from a coin listing client", async () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x123::usdc::USDC",
        amount: "1000",
        resource: "api:premium",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const signedTransactions: unknown[] = [];
    const handler = createSuiPaymentHandler(
      {
        toSuiAddress: () => OWNER,
        signAndExecuteTransaction: async ({ transaction }) => {
          signedTransactions.push(transaction);
          return { digest: "digest" };
        }
      },
      {
        coinSelectionClient: {
          listCoins: async (input) => {
            expect(input.owner).toBe(OWNER);
            expect(input.coinType).toBe("0x123::usdc::USDC");
            return {
              hasNextPage: false,
              cursor: null,
              objects: [
                { objectId: `0x${"1".repeat(64)}`, balance: "700", coinType: "0x123::usdc::USDC" },
                { objectId: `0x${"2".repeat(64)}`, balance: "600", coinType: "0x123::usdc::USDC" }
              ]
            };
          }
        }
      }
    );

    const proof = await handler({ challenge, originalRequest: new Request("https://merchant.example") });

    expect(proof).toMatchObject({ kind: "one-shot", txDigest: "digest", payer: OWNER });
    expect(signedTransactions).toHaveLength(1);
  });

  it("reads provider config and usable session responses", async () => {
    const calls: string[] = [];
    const manager = new Sui402SessionManagerClient({
      baseUrl: "https://merchant.example/sui402",
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(`${url.pathname}${url.search}`);

        if (url.pathname.endsWith("/config")) {
          return Response.json({
            network: "sui:testnet",
            packageId: PACKAGE,
            merchant: MERCHANT,
            coinType: "0x2::sui::SUI",
            resourceScopeHash: "11".repeat(32)
          });
        }

        return Response.json({
          owner: OWNER,
          usable: true,
          session: {
            id: SESSION,
            type: `${PACKAGE}::sessions::AgentPaymentSession<0x2::sui::SUI>`,
            packageId: PACKAGE,
            coinType: "0x2::sui::SUI",
            payer: OWNER,
            merchant: MERCHANT,
            balance: "5000",
            spent: "0",
            maxPerRequest: "2000",
            expiresMs: "4070908800000",
            resourceScopeHash: "11".repeat(32),
            revoked: false
          }
        });
      }
    });

    const config = await manager.getConfig();
    const usable = await manager.findUsableSession(OWNER, { amount: "1000" });

    expect(config.packageId).toBe(PACKAGE);
    expect(usable.session?.id).toBe(SESSION);
    expect(calls).toEqual([
      "/sui402/config",
      `/sui402/owners/${OWNER}/sessions/usable?amount=1000`
    ]);
  });

  it("builds managed session transactions from provider config", async () => {
    const manager = new Sui402SessionManagerClient({
      baseUrl: "https://merchant.example/sui402",
      fetch: async () =>
        Response.json({
          network: "sui:testnet",
          packageId: PACKAGE,
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          resourceScopeHash: "11".repeat(32)
        })
    });

    await expect(
      manager.buildOpenSessionTransaction({
        maxPerRequest: "1000",
        expiresMs: "4070908800000",
        funding: { kind: "sui", amount: "5000" }
      })
    ).resolves.toBeDefined();

    await expect(
      manager.buildCloseSessionTransaction({
        sessionId: SESSION
      })
    ).resolves.toBeDefined();
  });
});
