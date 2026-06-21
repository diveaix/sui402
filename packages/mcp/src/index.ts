import {
  SUI402_PAYMENT_HEADER,
  Sui402AnyPaymentProofSchema,
  createChallenge,
  decodeHeader,
  encodeHeader,
  type Sui402Challenge,
  type Sui402Network,
  type Sui402SessionSpendProof
} from "@sui402/protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MemoryChallengeStore, type ChallengeStore, type PaymentRecordStore, type PaymentVerifier } from "@sui402/server";
import { Sui402Verifier, type SessionSpendVerificationResult } from "@sui402/sui";

export type PaidToolOptions = {
  network?: Sui402Network;
  recipient: string;
  coinType: string;
  amount: string;
  name: string;
  resource?: string;
  description?: string;
  ttlSeconds?: number;
  store?: ChallengeStore;
  records?: PaymentRecordStore;
  verifier?: PaymentVerifier;
};

export type PaidToolCheck =
  | {
      paid: true;
      challenge: Sui402Challenge;
    }
  | {
      paid: false;
      challenge: Sui402Challenge;
      encodedChallenge: string;
    };

export type PaidMcpToolHandler = () => CallToolResult | Promise<CallToolResult>;

export type RegisterPaidMcpToolOptions = PaidToolOptions & {
  server: McpServer;
  title?: string;
  handler: PaidMcpToolHandler;
};

export type PaidMcpServerOptions = {
  name: string;
  version?: string;
  tools: Array<Omit<RegisterPaidMcpToolOptions, "server">>;
};

export function createPaidMcpServer(options: PaidMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name,
    version: options.version ?? "0.1.0"
  });

  for (const tool of options.tools) {
    registerPaidMcpTool({
      ...tool,
      server
    });
  }

  return server;
}

export function registerPaidMcpTool(options: RegisterPaidMcpToolOptions): void {
  options.server.registerTool(
    options.name,
    {
      title: options.title,
      description: options.description,
      inputSchema: {
        paymentProof: z.string().optional().describe("Base64url encoded Sui402 payment proof")
      }
    },
    async ({ paymentProof }) => {
      const paid = await checkPaidToolCall(options, paymentProof);
      if (!paid.paid) {
        return paymentRequiredToolResponse(paid);
      }

      return options.handler();
    }
  );
}

export async function checkPaidToolCall(options: PaidToolOptions, paymentProof?: string): Promise<PaidToolCheck> {
  const store = options.store ?? defaultStore;
  const records = options.records;
  const verifier = options.verifier ?? new Sui402Verifier({ network: options.network ?? "sui:testnet" });

  if (!paymentProof) {
    const challenge = createChallenge({
      network: options.network ?? "sui:testnet",
      recipient: options.recipient,
      coinType: options.coinType,
      amount: options.amount,
      resource: options.resource ?? `mcp:${options.name}`,
      description: options.description,
      expiresAt: new Date(Date.now() + (options.ttlSeconds ?? 300) * 1000).toISOString()
    });

    await store.issue(challenge);
    return {
      paid: false,
      challenge,
      encodedChallenge: encodeHeader(challenge)
    };
  }

  const proof = decodeHeader(paymentProof, Sui402AnyPaymentProofSchema);
  const challenge = await store.get(proof.challengeId);
  if (!challenge) {
    throw new Error("Unknown or expired Sui402 MCP payment challenge");
  }

  if (records?.getByProof) {
    const existingPayment = await records.getByProof(proof.network, proof.txDigest);
    if (existingPayment) {
      throw new Error("Sui402 MCP payment proof transaction has already been used");
    }
  }

  const verification =
    proof.kind === "session"
      ? await verifySessionPayment(verifier, challenge, proof)
      : await verifier.verifyPayment(challenge, proof);
  if (!verification.ok) {
    throw new Error(verification.reason);
  }

  const consumed = await store.consume(challenge.id);
  if (!consumed) {
    throw new Error("Sui402 MCP payment challenge already consumed");
  }

  const recorded = (await records?.record({
    id: `${proof.network}:${proof.txDigest}:${challenge.id}`,
    challenge,
    proof,
    verification,
    resource: challenge.resource,
    createdAt: new Date().toISOString()
  })) ?? true;
  if (!recorded) {
    throw new Error("Sui402 MCP payment proof transaction has already been used");
  }

  return {
    paid: true,
    challenge
  };
}

export function paymentRequiredToolResponse(check: Extract<PaidToolCheck, { paid: false }>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: "payment_required",
            paymentHeader: SUI402_PAYMENT_HEADER,
            challengeHeader: "sui402-challenge",
            challenge: check.challenge,
            encodedChallenge: check.encodedChallenge
          },
          null,
          2
        )
      }
    ],
    isError: true
  };
}

const defaultStore = new MemoryChallengeStore();

async function verifySessionPayment(
  verifier: PaymentVerifier,
  challenge: Sui402Challenge,
  proof: Sui402SessionSpendProof
): Promise<SessionSpendVerificationResult> {
  if (!verifier.verifySessionSpend) {
    return { ok: false, reason: "Session payments are not configured for this MCP tool" };
  }

  return verifier.verifySessionSpend(challenge, proof);
}
