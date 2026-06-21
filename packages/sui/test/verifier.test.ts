import { describe, expect, it } from "vitest";
import { createChallenge, resourceScopeHash } from "@sui402/protocol";
import {
  buildCoinPaymentTransaction,
  buildCreateSettlementLedgerTransaction,
  buildOpenSessionTransaction,
  buildSettleBatchTransaction,
  buildSettleReceiptTransaction,
  buildSpendSessionTransaction,
  findUsableAgentPaymentSession,
  parseAgentPaymentSessionObject,
  selectCoinObjectIdsForAmount,
  selectCoinObjectsForAmount,
  Sui402Verifier,
  verifySessionSpendResponse,
  verifyTransactionResponse
} from "../src/index.js";

const MERCHANT = `0x${"a".repeat(64)}`;
const PAYER = `0x${"b".repeat(64)}`;
const OTHER = `0x${"c".repeat(64)}`;
const COIN = `0x${"d".repeat(64)}`;
const SESSION = `0x${"e".repeat(64)}`;
const PACKAGE = `0x${"f".repeat(64)}`;

describe("Sui payment verifier", () => {
  it("verifies payments through the gRPC-compatible Core API", async () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const calls: unknown[] = [];
    const verifier = new Sui402Verifier({
      network: "sui:testnet",
      client: {
        core: {
          getTransaction: async (input: unknown) => {
            calls.push(input);
            return {
              $kind: "Transaction",
              Transaction: {
                digest: "abc",
                status: { success: true, error: null },
                transaction: { sender: PAYER },
                balanceChanges: [{ address: MERCHANT, coinType: "0x2::sui::SUI", amount: "1000" }],
                effects: { status: { success: true, error: null } }
              }
            };
          }
        }
      } as never
    });

    const result = await verifier.verifyPayment(challenge, {
      version: "sui402-0.1",
      kind: "one-shot",
      challengeId: challenge.id,
      network: "sui:testnet",
      txDigest: "abc",
      payer: PAYER,
      paidAt: "2026-05-18T12:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        digest: "abc",
        include: {
          balanceChanges: true,
          effects: true,
          transaction: true
        }
      }
    ]);
  });

  it("accepts a successful recipient balance change", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifyTransactionResponse(
      challenge,
      {
        version: "sui402-0.1",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "abc",
        payer: PAYER,
        paidAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "abc",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        balanceChanges: [
          {
            owner: { AddressOwner: MERCHANT },
            coinType: "0x2::sui::SUI",
            amount: "1000"
          }
        ]
      } as never
    );

    expect(result.ok).toBe(true);
  });

  it("rejects mismatched recipients", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifyTransactionResponse(
      challenge,
      {
        version: "sui402-0.1",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "abc",
        payer: PAYER,
        paidAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "abc",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        balanceChanges: [
          {
            owner: { AddressOwner: OTHER },
            coinType: "0x2::sui::SUI",
            amount: "1000"
          }
        ]
      } as never
    );

    expect(result.ok).toBe(false);
  });

  it("rejects transaction digest mismatch", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifyTransactionResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "expected",
        payer: PAYER,
        paidAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "actual",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        balanceChanges: []
      } as never
    );

    expect(result.ok).toBe(false);
  });

  it("builds a generic coin payment transaction", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x123::usdc::USDC",
        amount: "1000",
        resource: "GET https://example.com/data",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    expect(() => buildCoinPaymentTransaction(challenge, { coinObjectIds: [COIN] })).not.toThrow();
  });

  it("selects enough non-SUI coin objects for a payment", () => {
    const selection = selectCoinObjectsForAmount({
      owner: PAYER,
      coinType: "0x123::usdc::USDC",
      amount: "2500",
      coins: [
        { objectId: `0x${"1".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "900" },
        { objectId: `0x${"2".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "2000" },
        { objectId: `0x${"3".repeat(64)}`, coinType: "0x123::usdt::USDT", balance: "1000000" },
        { objectId: `0x${"4".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "600" }
      ]
    });

    expect(selection.coinObjectIds).toEqual([`0x${"2".repeat(64)}`, `0x${"1".repeat(64)}`]);
    expect(selection.totalBalance).toBe("2900");
  });

  it("rejects insufficient non-SUI coin balance during selection", () => {
    expect(() =>
      selectCoinObjectsForAmount({
        owner: PAYER,
        coinType: "0x123::usdc::USDC",
        amount: "2500",
        coins: [{ objectId: `0x${"1".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "1200" }]
      })
    ).toThrow("Insufficient 0x123::usdc::USDC coin balance");
  });

  it("selects coin objects from a paginated client", async () => {
    const pages = [
      {
        hasNextPage: true,
        cursor: "next",
        objects: [{ objectId: `0x${"1".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "700" }]
      },
      {
        hasNextPage: false,
        cursor: null,
        objects: [{ objectId: `0x${"2".repeat(64)}`, coinType: "0x123::usdc::USDC", balance: "2200" }]
      }
    ];
    const calls: Array<{ cursor?: string | null }> = [];

    const selection = await selectCoinObjectIdsForAmount({
      client: {
        listCoins: async (input) => {
          calls.push({ cursor: input.cursor });
          return pages[calls.length - 1];
        }
      },
      owner: PAYER,
      coinType: "0x123::usdc::USDC",
      amount: "2500",
      pageSize: 1
    });

    expect(calls).toEqual([{ cursor: undefined }, { cursor: "next" }]);
    expect(selection.coinObjectIds).toEqual([`0x${"2".repeat(64)}`, `0x${"1".repeat(64)}`]);
  });

  it("accepts matching session spend events", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "mcp:premium_tool",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifySessionSpendResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest",
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "digest",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        events: [
          {
            packageId: PACKAGE,
            transactionModule: "sessions",
            parsedJson: {
              session_id: SESSION,
              merchant: MERCHANT,
              coin_type: "0x2::sui::SUI",
              amount: "1000",
              challenge_id: [...Buffer.from(challenge.id, "hex")],
              resource_scope_hash: [...Buffer.from(resourceScopeHash(challenge.resource), "hex")]
            }
          }
        ]
      } as never
    );

    expect(result.ok).toBe(true);
  });

  it("accepts base64 encoded vector fields from CLI-shaped events", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "mcp:premium_tool",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifySessionSpendResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest",
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "digest",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        events: [
          {
            packageId: PACKAGE,
            transactionModule: "sessions",
            type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
            parsedJson: {
              session_id: SESSION,
              merchant: MERCHANT,
              amount: "1000",
              challenge_id: Buffer.from(challenge.id, "hex").toString("base64"),
              resource_scope_hash: Buffer.from(resourceScopeHash(challenge.resource), "hex").toString("base64")
            }
          }
        ]
      } as never,
      { sessionPackageId: PACKAGE }
    );

    expect(result.ok).toBe(true);
  });

  it("accepts zero-padded Sui framework coin type addresses from gRPC-shaped session events", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "mcp:premium_tool",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifySessionSpendResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest",
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "digest",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        events: [
          {
            packageId: PACKAGE,
            transactionModule: "sessions",
            type: `${PACKAGE}::sessions::SessionSpent<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>`,
            parsedJson: {
              session_id: SESSION,
              merchant: MERCHANT,
              amount: "1000",
              challenge_id: Buffer.from(challenge.id, "hex").toString("base64"),
              resource_scope_hash: Buffer.from(resourceScopeHash(challenge.resource), "hex").toString("base64")
            }
          }
        ]
      } as never,
      { sessionPackageId: PACKAGE }
    );

    expect(result.ok).toBe(true);
  });

  it("rejects session spend events from the wrong package", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "mcp:premium_tool",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifySessionSpendResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest",
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "digest",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        events: [
          {
            packageId: OTHER,
            transactionModule: "sessions",
            parsedJson: {
              session_id: SESSION,
              merchant: MERCHANT,
              coin_type: "0x2::sui::SUI",
              amount: "1000",
              challenge_id: Buffer.from(challenge.id, "hex").toString("base64"),
              resource_scope_hash: Buffer.from(resourceScopeHash(challenge.resource), "hex").toString("base64")
            }
          }
        ]
      } as never,
      { sessionPackageId: PACKAGE }
    );

    expect(result.ok).toBe(false);
  });

  it("rejects session spend events with the wrong resource scope", () => {
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "api:allowed",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );

    const result = verifySessionSpendResponse(
      challenge,
      {
        version: "sui402-0.1",
        kind: "session",
        challengeId: challenge.id,
        sessionId: SESSION,
        network: "sui:testnet",
        txDigest: "digest",
        spentAt: "2026-05-18T12:00:00.000Z"
      },
      {
        digest: "digest",
        effects: { status: { status: "success" } },
        transaction: { data: { sender: PAYER } },
        events: [
          {
            packageId: PACKAGE,
            transactionModule: "sessions",
            type: `${PACKAGE}::sessions::SessionSpent<0x2::sui::SUI>`,
            parsedJson: {
              session_id: SESSION,
              merchant: MERCHANT,
              amount: "1000",
              challenge_id: Buffer.from(challenge.id, "hex").toString("base64"),
              resource_scope_hash: Buffer.from(resourceScopeHash("api:other"), "hex").toString("base64")
            }
          }
        ]
      } as never,
      { sessionPackageId: PACKAGE }
    );

    expect(result.ok).toBe(false);
  });

  it("builds session open and spend transactions", () => {
    expect(() =>
      buildOpenSessionTransaction({
        packageId: PACKAGE,
        merchant: MERCHANT,
        maxPerRequest: "1000",
        expiresMs: "1770000000000",
        resourceScopeHash: "00".repeat(32),
        funding: { kind: "sui", amount: "10000" }
      })
    ).not.toThrow();

    expect(() =>
      buildSpendSessionTransaction({
        packageId: PACKAGE,
        sessionId: SESSION,
        amount: "1000",
        challengeId: "11".repeat(32),
        resourceScopeHash: "00".repeat(32)
      })
    ).not.toThrow();
  });

  it("builds settlement ledger and receipt transactions", () => {
    expect(() => buildCreateSettlementLedgerTransaction({ packageId: PACKAGE })).not.toThrow();
    expect(() =>
      buildSettleReceiptTransaction({
        packageId: PACKAGE,
        ledgerId: `0x${"1".repeat(64)}`,
        receiptId: "22".repeat(32),
        payer: PAYER,
        merchant: MERCHANT,
        signer: OTHER,
        amount: "1000",
        sequence: "1",
        resourceScopeHash: "33".repeat(32)
      })
    ).not.toThrow();
    expect(() =>
      buildSettleBatchTransaction({
        packageId: PACKAGE,
        ledgerId: `0x${"1".repeat(64)}`,
        merchant: MERCHANT,
        signer: OTHER,
        receipts: [
          {
            receiptId: "22".repeat(32),
            payer: PAYER,
            amount: "1000",
            sequence: "1",
            resourceScopeHash: "33".repeat(32)
          },
          {
            receiptId: "44".repeat(32),
            payer: OTHER,
            amount: "2500",
            sequence: "2",
            resourceScopeHash: "55".repeat(32)
          }
        ]
      })
    ).not.toThrow();
    expect(() =>
      buildSettleBatchTransaction({
        packageId: PACKAGE,
        ledgerId: `0x${"1".repeat(64)}`,
        merchant: MERCHANT,
        signer: OTHER,
        receipts: []
      })
    ).toThrow("At least one receipt");
  });

  it("parses owned AgentPaymentSession objects", () => {
    const session = parseAgentPaymentSessionObject(
      {
        data: {
          objectId: SESSION,
          version: "7",
          digest: "digest",
          content: {
            dataType: "moveObject",
            hasPublicTransfer: false,
            type: `${PACKAGE}::sessions::AgentPaymentSession<0x2::sui::SUI>`,
            fields: {
              id: { id: SESSION },
              payer: PAYER,
              merchant: MERCHANT,
              balance: { type: "0x2::balance::Balance<0x2::sui::SUI>", fields: { value: "5000" } },
              spent: "1000",
              max_per_request: "2000",
              expires_ms: "4070908800000",
              resource_scope_hash: [...Buffer.from("00".repeat(32), "hex")],
              revoked: false
            }
          }
        }
      } as never,
      PACKAGE
    );

    expect(session?.id).toBe(SESSION);
    expect(session?.balance).toBe("5000");
    expect(session?.resourceScopeHash).toBe("00".repeat(32));
  });

  it("finds a usable funded session for a challenge shape", async () => {
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
                payer: PAYER,
                merchant: MERCHANT,
                balance: { value: "5000" },
                spent: "1000",
                max_per_request: "2000",
                expires_ms: "4070908800000",
                resource_scope_hash: Buffer.from("11".repeat(32), "hex").toString("base64"),
                revoked: false
              }
            }
          ]
        })
      }
    };

    const session = await findUsableAgentPaymentSession({
      client: fakeClient as never,
      owner: PAYER,
      packageId: PACKAGE,
      coinType: "0x2::sui::SUI",
      merchant: MERCHANT,
      resourceScopeHash: "11".repeat(32),
      minBalance: "1000",
      nowMs: "1779129053930"
    });

    expect(session?.id).toBe(SESSION);
  });
});
