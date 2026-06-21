import { buildCloseSessionTransaction } from "@sui402/sui";
import { env, optionalEnv, printResponse, signAndExecute } from "./env.js";

const tx = buildCloseSessionTransaction({
  packageId: env("SUI402_SESSION_PACKAGE_ID"),
  coinType: optionalEnv("SUI402_COIN_TYPE") ?? "0x2::sui::SUI",
  sessionId: env("SUI402_SESSION_ID")
});

const response = await signAndExecute(tx);
printResponse(response, {
  sessionId: env("SUI402_SESSION_ID")
});
