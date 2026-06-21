import { createChallenge } from "@sui402/protocol";
import { createGatewayManifest, createGatewayMerchantConfig, type GatewayMerchantConfig } from "@sui402/gateway";
import { createListingFromManifest, type Sui402ServiceListing } from "@sui402/registry";
import type { PaymentRecord } from "@sui402/server";

const MERCHANT = "0x3a887b8701c31de6b7e17356a7322391b89f449805f364ad66b51233d6e934f6";
const SESSION_PACKAGE = "0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b";

export function seedMerchants(): GatewayMerchantConfig[] {
  return [
    createGatewayMerchantConfig({
      id: "atlas-api",
      service: "Atlas API",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000000",
      resourceScope: "api:market-feed",
      sessionPackageId: SESSION_PACKAGE
    }),
    createGatewayMerchantConfig({
      id: "signal-mcp",
      service: "Signal MCP",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "250000000",
      resourceScope: "mcp:premium_context",
      sessionPackageId: SESSION_PACKAGE
    })
  ];
}

export function seedListings(providerBaseUrl: string, merchants = seedMerchants()): Sui402ServiceListing[] {
  return merchants.map((merchant) =>
    createListingFromManifest({
      id: merchant.id,
      name: merchant.service,
      providerBaseUrl,
      transport: merchant.resourceScope.startsWith("mcp:") ? "mcp" : "http",
      manifest: createGatewayManifest(merchant),
      tags: merchant.resourceScope.startsWith("mcp:") ? ["mcp", "tools"] : ["api", "data"]
    })
  );
}

export function seedPayments(): PaymentRecord[] {
  return [
    makePayment("atlas-api", "api:market-feed", "digest-atlas-1", "1000000", "0x2::sui::SUI"),
    makePayment("signal-mcp", "mcp:premium_context", "digest-signal-1", "250000000", "0x2::sui::SUI"),
    makePayment("pricing-gateway", "api:quote/*", "digest-pricing-1", "1000000", "0x2::sui::SUI")
  ];
}

function makePayment(
  merchantId: string,
  resource: string,
  digest: string,
  amount: string,
  coinType: string
): PaymentRecord {
  const isSession = resource.startsWith("mcp:");
  const challenge = createChallenge({
    network: "sui:testnet",
    recipient: MERCHANT,
    coinType,
    amount,
    resource,
    expiresAt: "2099-01-01T00:00:00.000Z",
    metadata: { merchantId }
  });

  return {
    id: `sui:testnet:${digest}:${challenge.id}`,
    challenge,
    proof: isSession
      ? {
          version: "sui402-0.1",
          kind: "session",
          challengeId: challenge.id,
          sessionId: "0xsession",
          network: "sui:testnet",
          txDigest: digest,
          spentAt: "2026-05-19T00:00:00.000Z"
        }
      : {
          version: "sui402-0.1",
          kind: "one-shot",
          challengeId: challenge.id,
          network: "sui:testnet",
          txDigest: digest,
          paidAt: "2026-05-19T00:00:00.000Z"
        },
    verification: isSession
      ? { ok: true, digest, sessionId: "0xsession", recipient: MERCHANT, amount, coinType }
      : { ok: true, digest, recipient: MERCHANT, amount, coinType },
    resource,
    createdAt: "2026-05-19T00:00:00.000Z"
  };
}
