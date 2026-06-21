import { describe, expect, it } from "vitest";
import { createChallenge, encodeHeader } from "@sui402/protocol";
import { MemoryChallengeStore, MemoryPaymentRecordStore } from "@sui402/server";
import { checkPaidToolCall, paymentRequiredToolResponse } from "../src/index.js";
import { loadMcpConfig, loadMcpToolDefinitions } from "../src/config.js";
import { createMcpStorage } from "../src/storage.js";

const MERCHANT = `0x${"a".repeat(64)}`;
const PAYER = `0x${"b".repeat(64)}`;

describe("Sui402 MCP payments", () => {
  it("returns a payment-required tool response with challenge metadata", async () => {
    const check = await checkPaidToolCall({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      name: "premium_context",
      description: "Premium context"
    });

    expect(check.paid).toBe(false);
    if (!check.paid) {
      const response = paymentRequiredToolResponse(check);
      const payload = JSON.parse(response.content[0]?.text ?? "{}");

      expect(response.isError).toBe(true);
      expect(payload.error).toBe("payment_required");
      expect(payload.challenge.resource).toBe("mcp:premium_context");
      expect(payload.encodedChallenge).toBe(check.encodedChallenge);
    }
  });

  it("supports explicit MCP resource scopes", async () => {
    const check = await checkPaidToolCall({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      name: "premium_context",
      resource: "mcp:research/premium_context",
      description: "Premium context"
    });

    expect(check.paid).toBe(false);
    if (!check.paid) {
      expect(check.challenge.resource).toBe("mcp:research/premium_context");
    }
  });

  it("records successful paid tool calls", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const challenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "mcp:premium_context",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(challenge);

    const result = await checkPaidToolCall(
      {
        network: "sui:testnet",
        recipient: MERCHANT,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        name: "premium_context",
        store,
        records,
        verifier: {
          verifyPayment: async () =>
            ({
              ok: true,
              digest: "digest-1",
              payer: PAYER,
              recipient: MERCHANT,
              amount: "1000",
              coinType: "0x2::sui::SUI"
            }) as const
        }
      },
      encodeHeader({
        version: "sui402-0.1",
        kind: "one-shot",
        challengeId: challenge.id,
        network: "sui:testnet",
        txDigest: "digest-1",
        payer: PAYER,
        paidAt: "2026-05-19T00:00:00.000Z"
      })
    );

    expect(result.paid).toBe(true);
    const record = await records.getByProof("sui:testnet", "digest-1");
    expect(record?.challenge.id).toBe(challenge.id);
    expect(record?.resource).toBe("mcp:premium_context");
  });

  it("rejects reused transaction digests across MCP challenges", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const firstChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "mcp:premium_context",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const secondChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "mcp:premium_context",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(firstChallenge);
    await store.issue(secondChallenge);

    const options = {
      network: "sui:testnet" as const,
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      name: "premium_context",
      store,
      records,
      verifier: {
        verifyPayment: async () =>
          ({
            ok: true,
            digest: "same-digest",
            payer: PAYER,
            recipient: MERCHANT,
            amount: "1000",
            coinType: "0x2::sui::SUI"
          }) as const
      }
    };

    await expect(
      checkPaidToolCall(
        options,
        encodeHeader({
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: firstChallenge.id,
          network: "sui:testnet",
          txDigest: "same-digest",
          payer: PAYER,
          paidAt: "2026-05-19T00:00:00.000Z"
        })
      )
    ).resolves.toMatchObject({ paid: true });

    await expect(
      checkPaidToolCall(
        options,
        encodeHeader({
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: secondChallenge.id,
          network: "sui:testnet",
          txDigest: "same-digest",
          payer: PAYER,
          paidAt: "2026-05-19T00:00:00.000Z"
        })
      )
    ).rejects.toThrow("already been used");
  });

  it("rejects concurrent transaction digest reuse across MCP challenges", async () => {
    const store = new MemoryChallengeStore();
    const records = new MemoryPaymentRecordStore();
    const firstChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "mcp:premium_context",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const secondChallenge = createChallenge({
      network: "sui:testnet",
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "mcp:premium_context",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await store.issue(firstChallenge);
    await store.issue(secondChallenge);

    let verificationCalls = 0;
    let releaseVerification: () => void = () => {};
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const options = {
      network: "sui:testnet" as const,
      recipient: MERCHANT,
      coinType: "0x2::sui::SUI",
      amount: "1000",
      name: "premium_context",
      store,
      records,
      verifier: {
        verifyPayment: async (_challenge: unknown, proof: { txDigest: string }) => {
          verificationCalls += 1;
          if (verificationCalls === 2) {
            releaseVerification();
          }

          await verificationGate;
          return {
            ok: true,
            digest: proof.txDigest,
            payer: PAYER,
            recipient: MERCHANT,
            amount: "1000",
            coinType: "0x2::sui::SUI"
          } as const;
        }
      }
    };

    const results = await Promise.allSettled([
      checkPaidToolCall(
        options,
        encodeHeader({
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: firstChallenge.id,
          network: "sui:testnet",
          txDigest: "same-racy-mcp-digest",
          payer: PAYER,
          paidAt: "2026-05-19T00:00:00.000Z"
        })
      ),
      checkPaidToolCall(
        options,
        encodeHeader({
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: secondChallenge.id,
          network: "sui:testnet",
          txDigest: "same-racy-mcp-digest",
          payer: PAYER,
          paidAt: "2026-05-19T00:00:00.000Z"
        })
      )
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected as PromiseRejectedResult | undefined)?.reason.message).toContain("already been used");
    expect(await records.listRecent()).toHaveLength(1);
  });
});

describe("Sui402 MCP configuration", () => {
  it("loads production MCP tool config", () => {
    const config = loadMcpConfig({
      NODE_ENV: "production",
      SUI402_NETWORK: "sui:testnet",
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000",
      SUI402_MCP_TOOL_NAME: "premium_context",
      SUI402_REDIS_URL: "redis://localhost:6379",
      SUI402_POSTGRES_URL: "postgres://sui402:sui402@localhost:5432/sui402"
    });

    expect(config.SUI402_MCP_TOOL_NAME).toBe("premium_context");
    expect(config.SUI402_COIN_TYPE).toBe("0x2::sui::SUI");
  });

  it("loads multiple MCP paid tool definitions", () => {
    const config = loadMcpConfig({
      NODE_ENV: "production",
      SUI402_NETWORK: "sui:testnet",
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000",
      SUI402_MCP_TOOL_DESCRIPTION: "Default paid tool",
      SUI402_MCP_TOOLS_JSON: JSON.stringify([
        {
          name: "premium_context",
          title: "Premium Context",
          description: "Premium market context",
          amount: "1500",
          responseJson: { answer: "context" }
        },
        {
          name: "portfolio_snapshot",
          resource: "mcp:wallet/portfolio_snapshot",
          responseJson: { answer: "portfolio" }
        }
      ]),
      SUI402_REDIS_URL: "redis://localhost:6379",
      SUI402_POSTGRES_URL: "postgres://sui402:sui402@localhost:5432/sui402"
    });

    const tools = loadMcpToolDefinitions(config);

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: "premium_context",
      amount: "1500",
      coinType: "0x2::sui::SUI",
      description: "Premium market context",
      responseJson: { answer: "context" }
    });
    expect(tools[1]).toMatchObject({
      name: "portfolio_snapshot",
      amount: "1000",
      resource: "mcp:wallet/portfolio_snapshot",
      description: "Default paid tool",
      responseJson: { answer: "portfolio" }
    });
  });

  it("keeps single MCP tool env compatibility", () => {
    const config = loadMcpConfig({
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000",
      SUI402_MCP_TOOL_NAME: "legacy_tool",
      SUI402_MCP_RESPONSE_JSON: '{"legacy":true}'
    });

    expect(loadMcpToolDefinitions(config)).toEqual([
      {
        name: "legacy_tool",
        title: undefined,
        description: "Sui402 protected MCP tool",
        amount: "1000",
        coinType: "0x2::sui::SUI",
        responseJson: { legacy: true }
      }
    ]);
  });

  it("rejects duplicate MCP tool names", () => {
    const config = loadMcpConfig({
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000",
      SUI402_MCP_TOOLS_JSON: JSON.stringify([
        { name: "premium_context" },
        { name: "premium_context" }
      ])
    });

    expect(() => loadMcpToolDefinitions(config)).toThrow("Duplicate MCP tool name");
  });

  it("rejects unsafe MCP tool names", () => {
    expect(() =>
      loadMcpConfig({
        SUI402_MERCHANT_ADDRESS: MERCHANT,
        SUI402_PRICE: "1000",
        SUI402_MCP_TOOL_NAME: "premium context"
      })
    ).toThrow();
  });

  it("requires durable MCP storage in production", async () => {
    const config = loadMcpConfig({
      NODE_ENV: "production",
      SUI402_MERCHANT_ADDRESS: MERCHANT,
      SUI402_PRICE: "1000"
    });

    await expect(createMcpStorage(config)).rejects.toThrow("requires durable storage");
  });
});
