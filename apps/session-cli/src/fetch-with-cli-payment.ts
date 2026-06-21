import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SUI402_CHALLENGE_HEADER,
  SUI402_PAYMENT_HEADER,
  Sui402ChallengeSchema,
  encodeHeader,
  type Sui402Challenge,
  type Sui402PaymentProof
} from "@sui402/protocol";
import { getNetwork, optionalEnv } from "./env.js";

const execFileAsync = promisify(execFile);

const endpoint = optionalEnv("SUI402_PAYMENT_ENDPOINT") ?? "http://localhost:4020/v1/entitlements/current";

const first = await fetch(endpoint);
if (first.status !== 402) {
  console.log(await safeResponseBody(first));
  throw new Error(`Expected 402 challenge, got ${first.status}`);
}

const challenge = await readChallenge(first);
const payer = optionalEnv("SUI402_PAYER_ADDRESS") ?? (await getActiveAddress());
const txDigest = await payWithSuiCli({
  recipient: challenge.recipient,
  amount: challenge.amount
});

const proof: Sui402PaymentProof = {
  version: "sui402-0.1",
  kind: "one-shot",
  challengeId: challenge.id,
  network: getNetwork(),
  txDigest,
  payer,
  paidAt: new Date().toISOString()
};

const retry = await fetch(endpoint, {
  headers: {
    [SUI402_PAYMENT_HEADER]: encodeHeader(proof)
  }
});

console.log(
  JSON.stringify(
    {
      status: retry.status,
      endpoint,
      challenge: {
        id: challenge.id,
        network: challenge.network,
        recipient: challenge.recipient,
        coinType: challenge.coinType,
        amount: challenge.amount,
        resource: challenge.resource
      },
      proof,
      response: await safeResponseBody(retry)
    },
    null,
    2
  )
);

async function readChallenge(response: Response): Promise<Sui402Challenge> {
  const header = response.headers.get(SUI402_CHALLENGE_HEADER);
  if (header) {
    return Sui402ChallengeSchema.parse(JSON.parse(Buffer.from(header, "base64url").toString("utf8")));
  }

  const body = await response.json();
  return Sui402ChallengeSchema.parse(body.challenge);
}

async function getActiveAddress(): Promise<string> {
  const { stdout } = await execFileAsync("sui", ["client", "active-address"], {
    env: suiEnv()
  });

  return stdout.trim();
}

async function payWithSuiCli(input: { recipient: string; amount: string }): Promise<string> {
  const args = [
    "client",
    "ptb",
    "--split-coins",
    "gas",
    `[${input.amount}]`,
    "--assign",
    "payment",
    "--transfer-objects",
    "[payment.0]",
    `@${input.recipient}`,
    "--gas-budget",
    optionalEnv("SUI402_GAS_BUDGET") ?? "5000000",
    "--json"
  ];
  const { stdout } = await execFileAsync("sui", args, {
    env: suiEnv(),
    maxBuffer: 1024 * 1024 * 20
  });
  const parsed = JSON.parse(stdout);
  if (parsed.effects?.status?.status !== "success") {
    throw new Error(`Sui payment failed: ${JSON.stringify(parsed.effects?.status)}`);
  }

  return String(parsed.digest);
}

function suiEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
  };
}

async function safeResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
