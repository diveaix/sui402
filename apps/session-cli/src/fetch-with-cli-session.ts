import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SUI402_CHALLENGE_HEADER, SUI402_PAYMENT_HEADER, Sui402ChallengeSchema, encodeHeader, resourceScopeHash } from "@sui402/protocol";
import type { Sui402Challenge, Sui402SessionSpendProof } from "@sui402/protocol";
import { findUsableAgentPaymentSession } from "@sui402/sui";
import { env, getClient, getNetwork, optionalEnv } from "./env.js";

const execFileAsync = promisify(execFile);

const endpoint = optionalEnv("SUI402_SESSION_ENDPOINT") ?? "http://localhost:4020/v1/entitlements/current";
const packageId = env("SUI402_SESSION_PACKAGE_ID");
const resourceScope = optionalEnv("SUI402_RESOURCE_SCOPE") ?? "mcp:*";
const scopeHash = resourceScopeHash(resourceScope);

const first = await fetch(endpoint);
if (first.status !== 402) {
  console.log(await first.text());
  throw new Error(`Expected 402 challenge, got ${first.status}`);
}

const challenge = await readChallenge(first);
const payer = optionalEnv("SUI402_PAYER_ADDRESS") ?? (await getActiveAddress());
const sessionId =
  optionalEnv("SUI402_SESSION_ID") ??
  (await discoverSession({
    challenge,
    payer,
    packageId,
    resourceScopeHash: scopeHash
  }));
const txDigest = await spendWithSuiCli({
  packageId,
  sessionId,
  amount: challenge.amount,
  challengeId: challenge.id,
  resourceScopeHash: scopeHash,
  coinType: challenge.coinType
});

const proof: Sui402SessionSpendProof = {
  version: "sui402-0.1",
  kind: "session",
  challengeId: challenge.id,
  sessionId,
  network: getNetwork(),
  txDigest,
  payer,
  spentAt: new Date().toISOString()
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
      challenge,
      challengeId: challenge.id,
      txDigest,
      response: await retry.json()
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

async function discoverSession(input: {
  challenge: Sui402Challenge;
  payer: string;
  packageId: string;
  resourceScopeHash: string;
}): Promise<string> {
  const session = await findUsableAgentPaymentSession({
    client: getClient(),
    owner: input.payer,
    packageId: input.packageId,
    coinType: input.challenge.coinType,
    merchant: input.challenge.recipient,
    resourceScopeHash: input.resourceScopeHash,
    minBalance: input.challenge.amount
  });

  if (!session) {
    throw new Error(
      "No usable session found. Run npm run session:open or set SUI402_SESSION_ID to a funded session object."
    );
  }

  return session.id;
}

async function getActiveAddress(): Promise<string> {
  const { stdout } = await execFileAsync("sui", ["client", "active-address"], {
    env: {
      ...process.env,
      PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
    }
  });

  return stdout.trim();
}

async function spendWithSuiCli(input: {
  packageId: string;
  sessionId: string;
  amount: string;
  challengeId: string;
  resourceScopeHash: string;
  coinType: string;
}): Promise<string> {
  const args = [
    "client",
    "ptb",
    "--make-move-vec",
    "<u8>",
    hexToCliVector(input.challengeId),
    "--assign",
    "challenge",
    "--make-move-vec",
    "<u8>",
    hexToCliVector(input.resourceScopeHash),
    "--assign",
    "scope",
    "--move-call",
    `${input.packageId}::sessions::spend`,
    `<${input.coinType}>`,
    `@${input.sessionId}`,
    input.amount,
    "challenge",
    "scope",
    "@0x6",
    "--gas-budget",
    optionalEnv("SUI402_GAS_BUDGET") ?? "50000000",
    "--json"
  ];

  const { stdout } = await execFileAsync("sui", args, {
    env: {
      ...process.env,
      PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
    },
    maxBuffer: 1024 * 1024 * 20
  });

  const parsed = JSON.parse(stdout);
  if (parsed.effects?.status?.status !== "success") {
    throw new Error(`Session spend failed: ${JSON.stringify(parsed.effects?.status)}`);
  }

  return String(parsed.digest);
}

function hexToCliVector(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new Error(`Expected even-length hex string, got ${hex}`);
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }

  return `[${bytes.join(",")}]`;
}
