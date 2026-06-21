import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SUI402_CHALLENGE_HEADER,
  SUI402_PAYMENT_HEADER,
  Sui402ChallengeSchema,
  encodeHeader,
  resourceScopeHash,
  type Sui402Challenge,
  type Sui402SessionSpendProof
} from "@sui402/protocol";
import {
  SUI_COIN_TYPE,
  findUsableAgentPaymentSession
} from "@sui402/sui";
import { env, getClient, getNetwork, optionalEnv } from "./env.js";

const execFileAsync = promisify(execFile);

const endpoint = optionalEnv("SUI402_SESSION_ENDPOINT") ?? "http://localhost:4020/v1/entitlements/current";
const packageId = env("SUI402_SESSION_PACKAGE_ID");
const payer = optionalEnv("SUI402_PAYER_ADDRESS") ?? (await getActiveAddress());

const first = await fetchChallenge(endpoint);
const scopeHash = resourceScopeHash(first.resource);
const configuredSessionId = optionalEnv("SUI402_SESSION_ID");
const session =
  configuredSessionId !== undefined
    ? { id: configuredSessionId, source: "env" as const }
    : await findOrOpenSession({
        challenge: first,
        resourceScopeHash: scopeHash,
        payer
      });
const spendDigest = await spendSession({
  challenge: first,
  resourceScopeHash: scopeHash,
  sessionId: session.id
});
const proof: Sui402SessionSpendProof = {
  version: "sui402-0.1",
  kind: "session",
  challengeId: first.id,
  sessionId: session.id,
  network: getNetwork(),
  txDigest: spendDigest,
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
      endpoint,
      session,
      challenge: {
        id: first.id,
        network: first.network,
        recipient: first.recipient,
        coinType: first.coinType,
        amount: first.amount,
        resource: first.resource,
        resourceScopeHash: scopeHash
      },
      proof,
      response: await safeResponseBody(retry)
    },
    null,
    2
  )
);

async function fetchChallenge(url: string): Promise<Sui402Challenge> {
  const response = await fetch(url);
  if (response.status !== 402) {
    console.log(await safeResponseBody(response));
    throw new Error(`Expected 402 challenge, got ${response.status}`);
  }

  const header = response.headers.get(SUI402_CHALLENGE_HEADER);
  if (header) {
    return Sui402ChallengeSchema.parse(JSON.parse(Buffer.from(header, "base64url").toString("utf8")));
  }

  const body = await response.json();
  return Sui402ChallengeSchema.parse(body.challenge);
}

async function findOrOpenSession(input: {
  challenge: Sui402Challenge;
  resourceScopeHash: string;
  payer: string;
}): Promise<{ id: string; source: "discovered" | "opened"; openDigest?: string }> {
  const existing = await findUsableAgentPaymentSession({
    client: getClient(),
    owner: input.payer,
    packageId,
    coinType: input.challenge.coinType,
    merchant: input.challenge.recipient,
    resourceScopeHash: input.resourceScopeHash,
    minBalance: input.challenge.amount
  });
  if (existing) {
    return { id: existing.id, source: "discovered" };
  }

  const coinType = input.challenge.coinType;
  const fundingAmount = optionalEnv("SUI402_SESSION_FUNDING") ?? "10000000";
  const maxPerRequest = optionalEnv("SUI402_MAX_PER_REQUEST") ?? input.challenge.amount;
  const expiresMs =
    optionalEnv("SUI402_SESSION_EXPIRES_MS") ??
    String(Date.now() + Number(optionalEnv("SUI402_SESSION_TTL_MS") ?? 24 * 60 * 60 * 1000));
  const funding =
    coinType === SUI_COIN_TYPE
      ? { kind: "sui" as const, amount: fundingAmount }
      : { kind: "coin" as const, coinObjectId: env("SUI402_FUNDING_COIN_OBJECT_ID") };
  const response = await openSessionWithSuiCli({
    packageId,
    coinType,
    merchant: input.challenge.recipient,
    maxPerRequest,
    expiresMs,
    resourceScopeHash: input.resourceScopeHash,
    funding
  });
  const sessionId = findCreatedSessionId(response);
  if (!sessionId) {
    throw new Error(`Could not find created session id in transaction ${response.digest}`);
  }

  return { id: sessionId, source: "opened", openDigest: String(response.digest) };
}

async function spendSession(input: {
  challenge: Sui402Challenge;
  resourceScopeHash: string;
  sessionId: string;
}): Promise<string> {
  return spendWithSuiCli({
    packageId,
    coinType: input.challenge.coinType,
    sessionId: input.sessionId,
    amount: input.challenge.amount,
    challengeId: input.challenge.id,
    resourceScopeHash: input.resourceScopeHash
  });
}

async function getActiveAddress(): Promise<string> {
  const { stdout } = await execFileAsync("sui", ["client", "active-address"], {
    env: suiEnv()
  });

  return stdout.trim();
}

async function openSessionWithSuiCli(input: {
  packageId: string;
  coinType: string;
  merchant: string;
  maxPerRequest: string;
  expiresMs: string;
  resourceScopeHash: string;
  funding: { kind: "sui"; amount: string } | { kind: "coin"; coinObjectId: string };
}): Promise<Record<string, unknown>> {
  const fundingArgs =
    input.funding.kind === "sui"
      ? ["--split-coins", "gas", `[${input.funding.amount}]`, "--assign", "funding"]
      : ["--assign", "funding", `@${input.funding.coinObjectId}`];
  const args = [
    "client",
    "ptb",
    ...fundingArgs,
    "--make-move-vec",
    "<u8>",
    hexToCliVector(input.resourceScopeHash),
    "--assign",
    "scope",
    "--move-call",
    `${input.packageId}::sessions::open_session`,
    `<${input.coinType}>`,
    `@${input.merchant}`,
    input.maxPerRequest,
    input.expiresMs,
    "scope",
    input.funding.kind === "sui" ? "funding.0" : "funding",
    "--gas-budget",
    optionalEnv("SUI402_GAS_BUDGET") ?? "50000000",
    "--json"
  ];
  const parsed = await suiJson(args);
  if (readStatus(parsed) !== "success") {
    throw new Error(`Session open failed: ${JSON.stringify(asRecord(parsed).effects)}`);
  }

  return parsed;
}

async function spendWithSuiCli(input: {
  packageId: string;
  sessionId: string;
  amount: string;
  challengeId: string;
  resourceScopeHash: string;
  coinType: string;
}): Promise<string> {
  const parsed = await suiJson([
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
  ]);
  if (readStatus(parsed) !== "success") {
    throw new Error(`Session spend failed: ${JSON.stringify(asRecord(parsed).effects)}`);
  }

  return String(asRecord(parsed).digest);
}

async function suiJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("sui", args, {
    env: suiEnv(),
    maxBuffer: 1024 * 1024 * 20
  });

  return JSON.parse(stdout) as Record<string, unknown>;
}

function findCreatedSessionId(response: Record<string, unknown>): string | undefined {
  const changes = asRecordArray(response.objectChanges);
  const change = changes.find((item) => {
    return item.type === "created" && String(item.objectType ?? "").includes("::sessions::AgentPaymentSession");
  });

  return typeof change?.objectId === "string" ? change.objectId : undefined;
}

function readStatus(response: Record<string, unknown>): string | undefined {
  return String(asRecord(asRecord(response.effects).status).status ?? "");
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

function suiEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
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
