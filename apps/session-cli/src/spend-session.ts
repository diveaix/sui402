import { createChallenge, resourceScopeHash } from "@sui402/protocol";
import { buildSpendSessionTransaction } from "@sui402/sui";
import { env, optionalEnv, printResponse, signAndExecute } from "./env.js";

const packageId = env("SUI402_SESSION_PACKAGE_ID");
const sessionId = env("SUI402_SESSION_ID");
const merchant = env("SUI402_MERCHANT_ADDRESS");
const coinType = optionalEnv("SUI402_COIN_TYPE") ?? "0x2::sui::SUI";
const amount = optionalEnv("SUI402_SPEND_AMOUNT") ?? "1000000";
const resourceScope = optionalEnv("SUI402_RESOURCE_SCOPE") ?? "mcp:*";

const challenge =
  optionalEnv("SUI402_CHALLENGE_ID") ??
  createChallenge({
    network: optionalEnv("SUI402_NETWORK") === "sui:mainnet" ? "sui:mainnet" : "sui:testnet",
    recipient: merchant,
    coinType,
    amount,
    resource: resourceScope,
    expiresAt: new Date(Date.now() + 300000).toISOString()
  }).id;

const tx = buildSpendSessionTransaction({
  packageId,
  coinType,
  sessionId,
  amount,
  challengeId: challenge,
  resourceScopeHash: resourceScopeHash(resourceScope)
});

const response = await signAndExecute(tx);
printResponse(response, {
  sessionId,
  challengeId: challenge,
  resourceScope,
  resourceScopeHash: resourceScopeHash(resourceScope)
});
