import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  MemoryChallengeStore,
  MemoryPaymentRecordStore,
  createSui402SessionRouter,
  listObservedAgentPaymentSessions,
  requireSuiPayment
} from "../src/index.js";
import { SUI402_PAYMENT_HEADER, createChallenge, encodeHeader } from "@sui402/protocol";
import { createSpendReceipt, signSpendReceipt } from "@sui402/receipts";

const PACKAGE = `0x${"f".repeat(64)}`;
const OWNER = `0x${"b".repeat(64)}`;
const MERCHANT = `0x${"a".repeat(64)}`;
const SESSION = `0x${"e".repeat(64)}`;

describe("MemoryChallengeStore", () => {
  it("allows a challenge to be consumed once", async () => {
    const store = new MemoryChallengeStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: "0xmerchant",
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "GET https://example.com/data",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await store.issue(challenge);

    expect(await store.get(challenge.id)).toEqual(challenge);
    expect(await store.consume(challenge.id)).toBe(true);
    expect(await store.consume(challenge.id)).toBe(false);
  });

  it("finds recorded payments by network and transaction digest", async () => {
    const records = new MemoryPaymentRecordStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: "0xmerchant",
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "GET https://example.com/data",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await records.record({
      id: "payment-1",
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "digest",
        paidAt: "2026-05-18T12:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest",
        recipient: "0xmerchant",
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      resource: challenge.resource,
      createdAt: "2026-05-18T12:00:00.000Z"
    });

    expect(await records.getByProof("sui:testnet", "digest")).toBeDefined();
  });

  it("rejects payment proof transaction reuse", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const verifier = {
      verifyPayment: async () =>
        ({
          ok: true,
          digest: "same-digest",
          recipient: MERCHANT,
          amount: "1000",
          coinType: "0x2::sui::SUI"
        }) as const
    };
    const firstChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const secondChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(firstChallenge);
    await store.issue(secondChallenge);

    const app = express();
    app.get(
      "/paid",
      requireSuiPayment({
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        store,
        records,
        verifier
      }),
      (_req, res) => res.json({ ok: true })
    );
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const first = await fetch(`http://127.0.0.1:${port}/paid`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: firstChallenge.id,
            network: "sui:testnet",
            txDigest: "same-digest",
            paidAt: "2026-05-18T12:00:00.000Z"
          })
        }
      });
      const replay = await fetch(`http://127.0.0.1:${port}/paid`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: secondChallenge.id,
            network: "sui:testnet",
            txDigest: "same-digest",
            paidAt: "2026-05-18T12:00:00.000Z"
          })
        }
      });

      expect(first.status).toBe(200);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ error: "payment_replayed" });
    } finally {
      server.close();
    }
  });

  it("rejects concurrent payment proof transaction reuse across challenge IDs", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const firstChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const secondChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(firstChallenge);
    await store.issue(secondChallenge);

    let verificationCalls = 0;
    let releaseVerification: () => void = () => {};
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const verifier = {
      verifyPayment: async (_challenge: unknown, proof: { txDigest: string }) => {
        verificationCalls += 1;
        if (verificationCalls === 2) {
          releaseVerification();
        }

        await verificationGate;
        return {
          ok: true,
          digest: proof.txDigest,
          recipient: MERCHANT,
          amount: "1000",
          coinType: "0x2::sui::SUI"
        } as const;
      }
    };

    const app = express();
    app.get(
      "/paid",
      requireSuiPayment({
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        store,
        records,
        verifier
      }),
      (_req, res) => res.json({ ok: true })
    );
    const server = app.listen(0);

    try {
      const [first, second] = await Promise.all([
        fetch(`${serverBaseUrl(server)}/paid`, {
          headers: {
            [SUI402_PAYMENT_HEADER]: encodeHeader({
              version: "sui402-0.1",
              kind: "one-shot",
              challengeId: firstChallenge.id,
              network: "sui:testnet",
              txDigest: "same-racy-digest",
              paidAt: "2026-05-18T12:00:00.000Z"
            })
          }
        }),
        fetch(`${serverBaseUrl(server)}/paid`, {
          headers: {
            [SUI402_PAYMENT_HEADER]: encodeHeader({
              version: "sui402-0.1",
              kind: "one-shot",
              challengeId: secondChallenge.id,
              network: "sui:testnet",
              txDigest: "same-racy-digest",
              paidAt: "2026-05-18T12:00:00.000Z"
            })
          }
        })
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const replay = [first, second].find((response) => response.status === 409);
      if (!replay) {
        throw new Error("Expected one concurrent replay response");
      }

      expect(await replay.json()).toMatchObject({ error: "payment_replayed" });
      expect(await records.listRecent()).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("rejects verified payments that violate server-side payment policy", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(challenge);

    const app = express();
    app.get(
      "/paid",
      requireSuiPayment({
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        store,
        records,
        verifier: {
          verifyPayment: async (_challenge, proof) =>
            ({
              ok: true,
              digest: proof.txDigest,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        },
        policy: {
          allowedNetworks: ["sui:testnet"],
          allowedMerchants: [MERCHANT],
          allowedCoinTypes: ["0x2::sui::SUI"],
          allowedResourceScopes: ["api:*"],
          requireSession: true,
          allowOneShot: false
        }
      }),
      (_req, res) => res.json({ ok: true })
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/paid`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "one-shot",
            challengeId: challenge.id,
            network: "sui:testnet",
            txDigest: "digest-policy-rejected",
            paidAt: "2026-05-18T12:00:00.000Z"
          })
        }
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        error: "payment_policy_violation",
        reasons: expect.arrayContaining(["Policy requires session payments"])
      });
      expect(await records.getByProof("sui:testnet", "digest-policy-rejected")).toBeUndefined();
      expect(await store.get(challenge.id)).toBeDefined();
    } finally {
      server.close();
    }
  });

  it("records payment ledger entries by recipient", async () => {
    const records = new MemoryPaymentRecordStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: "0xmerchant",
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "GET https://example.com/data",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await records.record({
      id: "payment-1",
      challenge,
      proof: {
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "digest",
        paidAt: "2026-05-18T12:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest",
        recipient: "0xmerchant",
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      resource: challenge.resource,
      createdAt: "2026-05-18T12:00:00.000Z"
    });

    expect(await records.get("payment-1")).toBeDefined();
    expect(await records.listByRecipient("0xMERCHANT")).toHaveLength(1);
  });

  it("indexes observed session payments from the payment ledger", async () => {
    const records = new MemoryPaymentRecordStore();
    const firstChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:alpha",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const secondChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "2000",
      resource: "api:beta",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    await records.record({
      id: "payment-1",
      challenge: firstChallenge,
      proof: {
        version: "sui402-0.1",
        kind: "session",
        challengeId: firstChallenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest-1",
        payer: OWNER,
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest-1",
        sessionId: SESSION,
        payer: OWNER,
        recipient: MERCHANT,
        amount: "1000",
        coinType: "0x2::sui::SUI"
      },
      resource: firstChallenge.resource,
      createdAt: "2026-05-18T12:00:00.000Z"
    });
    await records.record({
      id: "payment-2",
      challenge: secondChallenge,
      proof: {
        version: "sui402-0.1",
        kind: "session",
        challengeId: secondChallenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest-2",
        payer: OWNER,
        spentAt: "2026-05-18T12:10:00.000Z"
      },
      verification: {
        ok: true,
        digest: "digest-2",
        sessionId: SESSION,
        payer: OWNER,
        recipient: MERCHANT,
        amount: "2000",
        coinType: "0x2::sui::SUI"
      },
      resource: secondChallenge.resource,
      createdAt: "2026-05-18T12:10:00.000Z"
    });

    const sessions = await listObservedAgentPaymentSessions({ records });

    expect(sessions).toEqual([
      {
        sessionId: SESSION,
        network: "sui:testnet",
        payer: OWNER,
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        spendCount: 2,
        spentAmount: "3000",
        resources: ["api:beta", "api:alpha"],
        firstSeenAt: "2026-05-18T12:00:00.000Z",
        lastSeenAt: "2026-05-18T12:10:00.000Z",
        lastTxDigest: "digest-2",
        lastPaymentId: "payment-2"
      }
    ]);
  });

  it("emits signed spend receipts for verified session payments", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:*",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(challenge);

    const app = express();
    app.get(
      "/paid",
      requireSuiPayment({
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        store,
        records,
        verifier: {
          verifyPayment: async () => ({ ok: false, reason: "one-shot disabled in test" }),
          verifySessionSpend: async (_challenge, proof) =>
            ({
              ok: true,
              digest: proof.txDigest,
              sessionId: proof.sessionId,
              payer: OWNER,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        },
        receiptIssuer: ({ challenge: verifiedChallenge, proof, verification }) => {
          if (proof.kind !== "session" || !("sessionId" in verification)) {
            return undefined;
          }

          return signSpendReceipt({
            receipt: createSpendReceipt(
              {
                network: verifiedChallenge.network,
                sessionId: verification.sessionId,
                payer: verification.payer ?? proof.payer ?? "unknown",
                merchant: verifiedChallenge.recipient,
                coinType: verifiedChallenge.coinType,
                amount: verifiedChallenge.amount,
                resource: verifiedChallenge.resource,
                sequence: "1",
                issuedAt: "2026-05-19T00:00:00.000Z",
                expiresAt: "2099-01-01T00:00:00.000Z"
              },
              "nonce-with-enough-entropy"
            ),
            signer: MERCHANT,
            privateKey
          });
        }
      }),
      (_req, res) => res.json({ ok: true })
    );
    const server = app.listen(0);

    try {
      const response = await fetch(`${serverBaseUrl(server)}/paid`, {
        headers: {
          [SUI402_PAYMENT_HEADER]: encodeHeader({
            version: "sui402-0.1",
            kind: "session",
            challengeId: challenge.id,
            sessionId: SESSION,
            network: "sui:testnet",
            txDigest: "session-digest",
            payer: OWNER,
            spentAt: "2026-05-19T00:00:00.000Z"
          })
        }
      });
      const record = await records.getByProof("sui:testnet", "session-digest");

      expect(response.status).toBe(200);
      expect(record?.receipt?.receipt.sessionId).toBe(SESSION);
      expect(record?.receipt?.signer).toBe(MERCHANT);
    } finally {
      server.close();
    }
  });
});

describe("Sui402 session manager router", () => {
  it("finds a usable owned session through HTTP", async () => {
    const fakeClient = {
      core: {
        listOwnedObjects: async () => ({
          hasNextPage: false,
          cursor: null,
          objects: [
            {
              objectId: SESSION,
              version: "7",
              digest: "digest",
              type: `${PACKAGE}::sessions::AgentPaymentSession<0x2::sui::SUI>`,
              json: {
                id: SESSION,
                payer: OWNER,
                merchant: MERCHANT,
                balance: { value: "5000" },
                spent: "0",
                max_per_request: "2000",
                expires_ms: "4070908800000",
                resource_scope_hash: [...Buffer.from("11".repeat(32), "hex")],
                revoked: false
              }
            }
          ]
        })
      }
    };
    const app = express();
    app.use(
      "/sui402",
      createSui402SessionRouter({
        client: fakeClient as never,
        packageId: PACKAGE,
        merchant: MERCHANT,
        coinType: "0x2::sui::SUI",
        resourceScopeHash: "11".repeat(32)
      })
    );
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/sui402/owners/${OWNER}/sessions/usable?amount=1000`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.usable).toBe(true);
      expect(body.session.id).toBe(SESSION);
    } finally {
      server.close();
    }
  });
});

function serverBaseUrl(server: ReturnType<typeof import("node:http").createServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}
