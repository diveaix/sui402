import { resourceScopeHash } from "@sui402/protocol";
import { SUI_COIN_TYPE, buildOpenSessionTransaction } from "@sui402/sui";
import { env, findCreatedSessionId, optionalEnv, printResponse, signAndExecute } from "./env.js";

const packageId = env("SUI402_SESSION_PACKAGE_ID");
const merchant = env("SUI402_MERCHANT_ADDRESS");
const coinType = optionalEnv("SUI402_COIN_TYPE") ?? "0x2::sui::SUI";
const resourceScope = optionalEnv("SUI402_RESOURCE_SCOPE") ?? "mcp:*";
const maxPerRequest = optionalEnv("SUI402_MAX_PER_REQUEST") ?? "1000000";
const fundingMist = optionalEnv("SUI402_SESSION_FUNDING") ?? "10000000";
const expiresMs =
  optionalEnv("SUI402_SESSION_EXPIRES_MS") ?? String(Date.now() + Number(optionalEnv("SUI402_SESSION_TTL_MS") ?? 86400000));
const funding =
  coinType === SUI_COIN_TYPE
    ? { kind: "sui" as const, amount: fundingMist }
    : { kind: "coin" as const, coinObjectId: env("SUI402_FUNDING_COIN_OBJECT_ID") };

const tx = buildOpenSessionTransaction({
  packageId,
  coinType,
  merchant,
  maxPerRequest,
  expiresMs,
  resourceScopeHash: resourceScopeHash(resourceScope),
  funding
});

const response = await signAndExecute(tx);
printResponse(response, {
  sessionId: findCreatedSessionId(response),
  resourceScope,
  resourceScopeHash: resourceScopeHash(resourceScope)
});
