import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSpendReceipt, signSpendReceipt } from "@sui402/receipts";
import {
  assertWalrusArtifactId,
  createAgentMemorySnapshotArtifact,
  createReceiptBundleArtifact,
  parseWalrusStoreResponse,
  publishWalrusArtifact,
  readWalrusArtifact
} from "../src/index.js";

const OWNER = `0x${"a".repeat(64)}`;

describe("Sui402 Walrus artifacts", () => {
  it("creates content-addressed receipt bundle artifacts", () => {
    const receipt = signedReceipt();
    const artifact = createReceiptBundleArtifact({
      owner: OWNER,
      network: "sui:testnet",
      receipts: [receipt],
      createdAt: "2026-05-19T00:00:00.000Z"
    });

    expect(artifact.kind).toBe("receipt-bundle");
    expect(artifact.payloadHash).toHaveLength(64);
    expect(artifact.id).toHaveLength(64);
    expect(() => assertWalrusArtifactId(artifact)).not.toThrow();
  });

  it("rejects tampered artifact payloads", () => {
    const artifact = createAgentMemorySnapshotArtifact({
      owner: OWNER,
      network: "sui:testnet",
      createdAt: "2026-05-19T00:00:00.000Z",
      payload: {
        subject: "agent:researcher",
        scope: "merchant:atlas-api",
        entries: [
          {
            id: "entry-1",
            role: "summary",
            content: "User prefers low-slippage routes.",
            createdAt: "2026-05-19T00:00:00.000Z"
          }
        ],
        redactions: []
      }
    });
    const tampered = {
      ...artifact,
      payload: {
        ...artifact.payload,
        scope: "merchant:other"
      }
    };

    expect(() => assertWalrusArtifactId(tampered)).toThrow("Invalid Sui402 Walrus artifact payload hash");
  });

  it("parses Walrus publisher responses", () => {
    expect(
      parseWalrusStoreResponse({
        newlyCreated: {
          blobObject: {
            id: "0xobject",
            blobId: "blob-1",
            storage: { endEpoch: 42 }
          }
        }
      })
    ).toMatchObject({
      blobId: "blob-1",
      objectId: "0xobject",
      endEpoch: 42
    });

    expect(parseWalrusStoreResponse({ alreadyCertified: { blobId: "blob-2" } })).toMatchObject({
      blobId: "blob-2"
    });
  });

  it("publishes and reads artifacts through Walrus HTTP endpoints", async () => {
    const artifact = createAgentMemorySnapshotArtifact({
      owner: OWNER,
      createdAt: "2026-05-19T00:00:00.000Z",
      payload: {
        subject: "agent:ops",
        scope: "merchant:atlas-api",
        entries: [],
        redactions: []
      }
    });
    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ newlyCreated: { blobObject: { blobId: "blob-1" } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify(artifact), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    await expect(
      publishWalrusArtifact({
        publisherUrl: "https://publisher.example",
        artifact,
        epochs: 5,
        fetch: mockFetch
      })
    ).resolves.toMatchObject({ blobId: "blob-1" });
    await expect(
      readWalrusArtifact({
        aggregatorUrl: "https://aggregator.example",
        blobId: "blob-1",
        fetch: mockFetch
      })
    ).resolves.toMatchObject({ id: artifact.id });
    expect(calls).toEqual([
      "PUT https://publisher.example/v1/blobs?epochs=5",
      "GET https://aggregator.example/v1/blobs/blob-1"
    ]);
  });
});

function signedReceipt() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const receipt = createSpendReceipt(
    {
      network: "sui:testnet",
      sessionId: `0x${"b".repeat(64)}`,
      payer: `0x${"c".repeat(64)}`,
      merchant: OWNER,
      coinType: "0x2::sui::SUI",
      amount: "100",
      resource: "api:market-feed",
      sequence: "1",
      issuedAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z"
    },
    "nonce-with-enough-entropy"
  );

  return signSpendReceipt({
    receipt,
    signer: OWNER,
    privateKey
  });
}
