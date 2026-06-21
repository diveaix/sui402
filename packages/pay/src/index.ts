#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { decodeSuiPrivateKey, type Keypair, type SignatureScheme } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import type { Transaction } from "@mysten/sui/transactions";
import {
  Sui402Client,
  createAutoSuiSessionPaymentHandler,
  createPolicyGuardedPaymentHandler,
  createSuiPaymentHandler,
  type PaymentHandler,
  type SuiTransactionSigner
} from "@sui402/client";
import { resourceScopeHash, type Sui402Network } from "@sui402/protocol";
import {
  SUI_COIN_TYPE,
  buildCloseSessionTransaction,
  buildFundSessionTransaction,
  buildOpenSessionTransaction,
  parseAgentPaymentSessionObject,
  type AgentPaymentSession,
  type SessionFunding
} from "@sui402/sui";

type CurlOptions = {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  sessionOnly: boolean;
  maxOneShotAmount?: string;
};

type WalletOptions = {
  json: boolean;
  checkBalance: boolean;
};

type ReadinessOptions = WalletOptions & {
  strict: boolean;
};

type SetupOptions = WalletOptions & {
  printEnv: boolean;
  writeEnvPath?: string;
  force: boolean;
  network?: Sui402Network;
  grpcUrl?: string;
  marketplaceUrl?: string;
  sessionPackageId?: string;
  maxOneShotAmount?: string;
};

type SetupProfile = {
  custody: "user-owned";
  path?: string;
  variables: Record<string, string>;
  warnings: string[];
};

type WalletStatus = {
  custody: "user-owned";
  signerConfigured: boolean;
  signerSource?: "SUI_SECRET_KEY" | "SUI_MNEMONIC" | "SUI_CLI_KEYSTORE";
  signerPath?: string;
  address?: string;
  network: Sui402Network;
  grpcUrl: string;
  grpcUrlSource: "SUI_GRPC_URL" | "default";
  sessionPackageId?: string;
  marketplaceUrl?: string;
  balanceCheck: "skipped" | "ok" | "failed";
  funding: WalletFundingGuidance;
  balance?: {
    coinType: "0x2::sui::SUI";
    balance: string;
    coinBalance: string;
    addressBalance: string;
  };
  warnings: string[];
  errors: string[];
  readiness: WalletReadiness;
};

type WalletFundingGuidance = {
  custody: "user-owned";
  purpose: "sui_gas";
  coinType: "0x2::sui::SUI";
  network: Sui402Network;
  address?: string;
  summary: string;
  actions: Array<{
    kind: "web_faucet" | "cli_faucet" | "deposit";
    label: string;
    url?: string;
    command?: string;
    note: string;
  }>;
};

type WalletReadiness = {
  readyForPaidCalls: boolean;
  level: "ready" | "needs_wallet" | "needs_gas_check" | "needs_gas" | "needs_network" | "error";
  summary: string;
  checks: Array<{
    name: "local_signer" | "sui_gas_balance";
    ok: boolean;
    message: string;
  }>;
  nextActions: string[];
};

type SessionInspectOptions = {
  owner?: string;
  packageId?: string;
  coinType?: string;
  merchant?: string;
  resource?: string;
  resourceScopeHash?: string;
  amount?: string;
  limit: number;
  maxPages: number;
  json: boolean;
};

type SessionOpenOptions = {
  packageId?: string;
  merchant?: string;
  coinType: string;
  resource?: string;
  resourceScopeHash?: string;
  maxPerRequest?: string;
  fundingAmount?: string;
  fundingCoinObjectId?: string;
  expiresMs?: string;
  ttlMs?: string;
  yes: boolean;
  json: boolean;
};

type SessionFundOptions = {
  packageId?: string;
  sessionId?: string;
  coinType: string;
  fundingAmount?: string;
  fundingCoinObjectId?: string;
  yes: boolean;
  json: boolean;
};

type SessionCloseOptions = {
  packageId?: string;
  sessionId?: string;
  coinType: string;
  yes: boolean;
  json: boolean;
};

type SessionMutationPlan = {
  action: "open" | "fund" | "close";
  custody: "user-owned";
  packageId: string;
  coinType: string;
  signerRequired: boolean;
  requiresConfirmation: boolean;
  confirmed: boolean;
  warning: string;
  details: Record<string, string>;
};

type SessionExecutionContext = {
  client: SuiGrpcClient;
  signer: Keypair;
  signerAddress: string;
  network: Sui402Network;
  grpcUrl: string;
};

type SessionReadResult = {
  owner: string;
  network: Sui402Network;
  packageId: string;
  sessions: AgentPaymentSession[];
  scannedPages: number;
  reachedLimit: boolean;
  hasMoreObjects: boolean;
};

type SessionReadinessSummary = {
  matchedSessions: number;
  usableSessions: number;
  unusableSessions: number;
  usableBalance: string;
  largestUsableBalance: string;
  canCoverAmount?: boolean;
  fallbackWouldBeOneShot: boolean;
  nextActions: string[];
};

type MarketplaceSearchOptions = {
  query?: string;
  marketplaceUrl?: string;
  network?: Sui402Network;
  transport?: "http" | "mcp";
  tag?: string;
  limit: number;
  json: boolean;
};

type MarketplaceDetailOptions = {
  marketplaceUrl?: string;
  id: string;
  json: boolean;
};

type ScanStatsOptions = {
  marketplaceUrl?: string;
  json: boolean;
};

type ScanLookupOptions = ScanStatsOptions & {
  id: string;
};

const U64_MAX = 18_446_744_073_709_551_615n;
const DEFAULT_SESSION_TTL_MS = "86400000";

type MarketplaceApi = {
  id: string;
  name: string;
  description?: string;
  transport: "http" | "mcp";
  network: Sui402Network;
  merchant: string;
  coinType: string;
  price: string;
  resourceScope: string;
  sessionSupported: boolean;
  protectedResourceUrl?: string;
  sessionManagerUrl?: string;
  tags?: string[];
  status: "active" | "paused";
  readiness?: MarketplaceReadiness;
  commands?: MarketplaceCommands;
  paymentPlan?: MarketplacePaymentPlan;
  stats?: {
    verifiedPayments?: number;
    sessionPayments?: number;
    volume?: string;
  };
  reliability?: MarketplaceReliability;
};

type MarketplaceCommands = {
  curl?: string;
  search?: string;
  scan?: string;
  sessionOnly?: string;
  sessionInspect?: string;
};

type MarketplacePaymentPlan = {
  custody?: string;
  authorizationMode?: string;
  network?: Sui402Network;
  merchant?: string;
  coinType?: string;
  amountAtomic?: string;
  maxOneShotAmount?: string;
  resourceScope?: string;
  resourceScopeHash?: string;
  protectedResourceUrl?: string;
  sessionSupported?: boolean;
  sessionBehavior?: string;
  sessionManagerUrl?: string;
  notes?: string[];
};

type MarketplaceReadiness = {
  ready: boolean;
  level: "ready" | "needs_review" | "paused";
  reasons: string[];
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
};

type MarketplaceSearchResponse = {
  count: number;
  apis: MarketplaceApi[];
};

type MarketplaceDetailResponse = {
  api: MarketplaceApi;
  merchant?: {
    id?: string;
    service?: string;
    network?: Sui402Network;
    merchant?: string;
    coinType?: string;
    price?: string;
    resourceScope?: string;
    status?: "active" | "paused";
    sessionsEnabled?: boolean;
  };
  trust?: {
    listingPublished?: boolean;
    merchantPublished?: boolean;
    upstreamConfigured?: boolean;
    sessionsEnabled?: boolean;
  };
  readiness?: MarketplaceReadiness;
  commands?: MarketplaceCommands;
  paymentPlan?: MarketplacePaymentPlan;
  stats?: {
    verifiedPayments?: number;
    sessionPayments?: number;
    volume?: string;
  };
  reliability?: MarketplaceReliability;
  recentPayments?: Array<{
    digest?: string;
    kind?: string;
    amount?: string;
    coinType?: string;
    resource?: string;
  }>;
  links?: {
    protectedResourceUrl?: string;
    sessionManagerUrl?: string;
    scanMerchantPath?: string;
  };
};

type MarketplaceReliability = {
  paidTestObserved?: boolean;
  verifiedPayments?: number;
  sessionPayments?: number;
  oneShotPayments?: number;
  recentIndexedPayments?: number;
  firstVerifiedPaymentAt?: string;
  lastVerifiedPaymentAt?: string;
  evidenceWindow?: {
    from?: string;
    to?: string;
    payments?: number;
  };
  notes?: string[];
};

type MarketplaceAgentSafety = {
  shouldAutoPay: boolean;
  level: "ready" | "needs_review" | "paused" | "unknown";
  summary: string;
  reasons: string[];
  nextActions: string[];
};

const VERSION = "0.1.0";
const DEFAULT_SESSION_LIMIT = 25;
const DEFAULT_SESSION_MAX_PAGES = 10;
const DEFAULT_MARKETPLACE_LIMIT = 20;
const MAX_MARKETPLACE_LIMIT = 100;
const SESSION_PAGE_SIZE = 50;
const NO_SUI_WALLET_CONFIGURED =
  "No Sui wallet configured. Run `sui402-pay setup`, set SUI_SECRET_KEY/SUI_MNEMONIC, or initialize the Sui CLI wallet.";

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "setup" || command === "init" || command === "onboard") {
    await setupCommand(rest);
    return;
  }

  if (command === "readiness" || command === "ready") {
    await readinessCommand(rest);
    return;
  }

  if (command === "wallet") {
    await walletCommand(rest);
    return;
  }

  if (command === "session" || command === "sessions") {
    await sessionCommand(rest);
    return;
  }

  if (command === "search" || command === "marketplace") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printSearchHelp();
      return;
    }
    if (command === "marketplace" && (rest[0] === "detail" || rest[0] === "api" || rest[0] === "inspect")) {
      await printMarketplaceDetail(parseMarketplaceDetailOptions(rest.slice(1)));
      return;
    }
    await searchMarketplace(parseMarketplaceSearchOptions(rest));
    return;
  }

  if (command === "scan") {
    await scanCommand(rest);
    return;
  }

  if (command === "curl") {
    await payCurl(parseCurlOptions(rest));
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function scanCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "stats") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printScanHelp();
      return;
    }
    await printScanStats(parseScanStatsOptions(rest));
    return;
  }

  if (subcommand === "payment" || subcommand === "payments") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printScanHelp();
      return;
    }
    await printScanLookup("payment", parseScanLookupOptions(rest, "payment digest"));
    return;
  }

  if (subcommand === "merchant" || subcommand === "merchants") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printScanHelp();
      return;
    }
    await printScanLookup("merchant", parseScanLookupOptions(rest, "merchant id"));
    return;
  }

  if (subcommand === "session" || subcommand === "sessions") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printScanHelp();
      return;
    }
    await printScanLookup("session", parseScanLookupOptions(rest, "session id"));
    return;
  }

  if (subcommand === "settlement" || subcommand === "settlements") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printScanHelp();
      return;
    }
    await printScanLookup("settlement", parseScanLookupOptions(rest, "settlement id, tx digest, ledger id, or receipt id"));
    return;
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printScanHelp();
    return;
  }

  throw new Error(`Unknown scan command: ${subcommand}`);
}

async function sessionCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printSessionHelp();
    return;
  }

  if (subcommand === "setup" || subcommand === "onboard") {
    printSessionSetup();
    return;
  }

  if (subcommand === "open") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printSessionHelp();
      return;
    }
    await openSession(parseSessionOpenOptions(rest));
    return;
  }

  if (subcommand === "fund") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printSessionHelp();
      return;
    }
    await fundSession(parseSessionFundOptions(rest));
    return;
  }

  if (subcommand === "close") {
    if (rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h") {
      printSessionHelp();
      return;
    }
    await closeSession(parseSessionCloseOptions(rest));
    return;
  }

  if (subcommand === "inspect" || subcommand === "list" || subcommand === "status") {
    await inspectSessions(parseSessionInspectOptions(rest));
    return;
  }

  throw new Error(`Unknown session command: ${subcommand}`);
}

async function setupCommand(args: string[]): Promise<void> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printWalletHelp();
    return;
  }

  const options = parseSetupOptions(args, {
    json: false,
    checkBalance: false,
    printEnv: false,
    force: false
  });

  if (options.printEnv || options.writeEnvPath) {
    await setupProfileCommand(options);
    return;
  }

  if (options.json || args.includes("--check")) {
    const status = await readWalletStatus({ checkBalance: options.checkBalance });
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    printWalletStatus(status);
    if (!status.signerConfigured) {
      console.log("");
      printSetup();
    }
    return;
  }

  printSetup();
}

async function setupProfileCommand(options: SetupOptions): Promise<void> {
  const profile = buildSetupProfile(options);
  const envText = serializeSetupProfile(profile);

  if (options.writeEnvPath) {
    const path = resolve(options.writeEnvPath);
    if (existsSync(path) && !options.force) {
      throw new Error(`Refusing to overwrite ${path}. Pass --force to replace it.`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, envText, { encoding: "utf8", flag: "w" });
    profile.path = path;
  }

  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  if (options.printEnv) {
    console.log(envText.trimEnd());
    if (options.writeEnvPath) {
      console.log("");
      console.log(`# wrote ${profile.path}`);
    }
    return;
  }

  if (options.writeEnvPath) {
    console.log(`Wrote non-secret Sui402 setup profile: ${profile.path}`);
    console.log("Private keys and mnemonics were not written. Keep using SUI_SECRET_KEY, SUI_MNEMONIC, or the Sui CLI keystore locally.");
  }
}

function buildSetupProfile(options: SetupOptions): SetupProfile {
  const network = options.network ?? getNetwork();
  const networkName = network.replace("sui:", "") as "mainnet" | "testnet" | "devnet" | "localnet";
  const grpcUrl = options.grpcUrl ?? process.env.SUI_GRPC_URL ?? grpcUrlForNetwork(networkName);
  const marketplaceUrl = options.marketplaceUrl ?? process.env.SUI402_MARKETPLACE_URL ?? process.env.SUI402_CONSOLE_API_URL;
  const sessionPackageId = options.sessionPackageId ?? process.env.SUI402_SESSION_PACKAGE_ID;
  const maxOneShotAmount = options.maxOneShotAmount ?? process.env.SUI402_MAX_ONE_SHOT_AMOUNT;
  const warnings: string[] = [];
  const variables: Record<string, string> = {
    SUI402_NETWORK: network,
    SUI_GRPC_URL: grpcUrl
  };

  if (marketplaceUrl) {
    variables.SUI402_MARKETPLACE_URL = marketplaceUrl;
  } else {
    warnings.push("No marketplace URL configured; search/scan need SUI402_MARKETPLACE_URL or --marketplace-url.");
  }

  if (sessionPackageId) {
    variables.SUI402_SESSION_PACKAGE_ID = sessionPackageId;
  } else {
    warnings.push("No session package configured; curl can still use one-shot payments, but session-first payments need SUI402_SESSION_PACKAGE_ID.");
  }

  if (maxOneShotAmount) {
    variables.SUI402_MAX_ONE_SHOT_AMOUNT = readU64String(maxOneShotAmount, "SUI402_MAX_ONE_SHOT_AMOUNT/--max-one-shot-amount");
  }

  if (!canDetectLocalSigner()) {
    warnings.push("No local signer detected; configure the Sui CLI wallet, SUI_SECRET_KEY, or SUI_MNEMONIC before paid calls.");
  }

  return {
    custody: "user-owned",
    variables,
    warnings
  };
}

function serializeSetupProfile(profile: SetupProfile): string {
  const lines = [
    "# Sui402 non-secret agent payment profile",
    "# Source this file before running sui402-pay. It intentionally excludes SUI_SECRET_KEY and SUI_MNEMONIC.",
    "# Keep signer material in your local Sui CLI wallet or inject it through your own secret manager."
  ];

  for (const [key, value] of Object.entries(profile.variables)) {
    lines.push(`${key}=${quoteEnvValue(value)}`);
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

function canDetectLocalSigner(): boolean {
  if (process.env.SUI_SECRET_KEY || process.env.SUI_MNEMONIC) {
    return true;
  }

  try {
    return Boolean(resolveSuiCliKeypair([]));
  } catch {
    return false;
  }
}

async function walletCommand(args: string[]): Promise<void> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printWalletHelp();
    return;
  }

  const options = parseWalletOptions(args, {
    json: true,
    checkBalance: false
  });
  const status = await readWalletStatus({ checkBalance: options.checkBalance });
  if (!status.signerConfigured) {
    throw new Error(status.errors[0] ?? NO_SUI_WALLET_CONFIGURED);
  }

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  printWalletStatus(status);
}

async function readinessCommand(args: string[]): Promise<void> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printReadinessHelp();
    return;
  }

  const options = parseReadinessOptions(args, {
    json: false,
    checkBalance: true,
    strict: false
  });
  const status = await readWalletStatus({ checkBalance: options.checkBalance });

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printWalletStatus(status);
  }

  if (options.strict && !status.readiness.readyForPaidCalls) {
    process.exitCode = 1;
  }
}

async function searchMarketplace(options: MarketplaceSearchOptions): Promise<void> {
  const baseUrl = resolveMarketplaceBaseUrl(options.marketplaceUrl);
  const url = new URL("/v1/marketplace/apis", baseUrl);
  if (options.query) {
    url.searchParams.set("q", options.query);
  }
  if (options.network) {
    url.searchParams.set("network", options.network);
  }
  if (options.transport) {
    url.searchParams.set("transport", options.transport);
  }
  if (options.tag) {
    url.searchParams.set("tag", options.tag);
  }
  url.searchParams.set("limit", String(options.limit));

  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Marketplace search failed: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as MarketplaceSearchResponse;
  if (options.json) {
    console.log(JSON.stringify({ marketplaceUrl: baseUrl.toString(), ...result }, null, 2));
    return;
  }

  printMarketplaceSearch(result, baseUrl);
}

async function printMarketplaceDetail(options: MarketplaceDetailOptions): Promise<void> {
  const baseUrl = resolveMarketplaceBaseUrl(options.marketplaceUrl);
  const url = new URL(`/v1/marketplace/apis/${encodeURIComponent(options.id)}`, baseUrl);
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Marketplace API detail failed: ${response.status} ${await response.text()}`);
  }

  const detail = (await response.json()) as MarketplaceDetailResponse;
  const agentSafety = buildMarketplaceAgentSafety(detail);
  if (options.json) {
    console.log(JSON.stringify({ marketplaceUrl: baseUrl.toString(), agentSafety, detail }, null, 2));
    return;
  }

  printHumanMarketplaceDetail(detail, baseUrl, agentSafety);
}

async function printScanStats(options: ScanStatsOptions): Promise<void> {
  const baseUrl = resolveMarketplaceBaseUrl(options.marketplaceUrl);
  const url = new URL("/v1/scan/stats", baseUrl);
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Sui402 scan stats failed: ${response.status} ${await response.text()}`);
  }

  const stats = await response.json();
  if (options.json) {
    console.log(JSON.stringify({ marketplaceUrl: baseUrl.toString(), stats }, null, 2));
    return;
  }

  printHumanScanStats(stats, baseUrl);
}

type ScanLookupKind = "payment" | "merchant" | "session" | "settlement";

async function printScanLookup(kind: ScanLookupKind, options: ScanLookupOptions): Promise<void> {
  const baseUrl = resolveMarketplaceBaseUrl(options.marketplaceUrl);
  const path = scanLookupPath(kind, options.id);
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Sui402 scan ${kind} lookup failed: ${response.status} ${await response.text()}`);
  }

  const record = await response.json();
  if (options.json) {
    console.log(JSON.stringify({ marketplaceUrl: baseUrl.toString(), kind, record }, null, 2));
    return;
  }

  switch (kind) {
    case "payment":
      printHumanScanPayment(record, baseUrl);
      return;
    case "merchant":
      printHumanScanMerchant(record, baseUrl);
      return;
    case "session":
      printHumanScanSession(record, baseUrl);
      return;
    case "settlement":
      printHumanScanSettlement(record, baseUrl);
      return;
  }
}

function scanLookupPath(kind: ScanLookupKind, id: string): string {
  const encoded = encodeURIComponent(id);
  switch (kind) {
    case "payment":
      return `/v1/scan/payments/${encoded}`;
    case "merchant":
      return `/v1/scan/merchants/${encoded}`;
    case "session":
      return `/v1/scan/sessions/${encoded}`;
    case "settlement":
      return `/v1/scan/settlements/${encoded}`;
  }
}

async function payCurl(options: CurlOptions): Promise<void> {
  const keypair = getKeypair();
  const client = getClient();
  const owner = keypair.toSuiAddress();
  const signer = createSigner(client, keypair);
  const paymentHandler = createSessionFirstPaymentHandler(signer, client, owner, {
    sessionOnly: options.sessionOnly,
    maxOneShotAmount: options.maxOneShotAmount
  });
  const sui402 = new Sui402Client({ paymentHandler });
  const response = await sui402.fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body
  });

  await printResponse(response);
}

function createSessionFirstPaymentHandler(
  signer: SuiTransactionSigner,
  client: SuiGrpcClient,
  owner: string,
  options: { sessionOnly: boolean; maxOneShotAmount?: string }
): PaymentHandler {
  const localNetwork = getNetwork();
  const oneShotPaymentHandler = createSuiPaymentHandler(signer, {
    owner,
    coinSelectionClient: client
  });
  const oneShot = createPolicyGuardedPaymentHandler(async (context) => {
    if (!options.maxOneShotAmount) {
      throw new Error(
        [
          "One-shot payments require an explicit spend cap before signing.",
          `Challenge amount: ${context.challenge.amount} ${context.challenge.coinType} on ${context.challenge.network}.`,
          `Recipient: ${context.challenge.recipient}.`,
          "Re-run with --max-one-shot-amount ATOMIC or set SUI402_MAX_ONE_SHOT_AMOUNT.",
          "Use --session-only when fallback one-shot spending must stay disabled."
        ].join(" ")
      );
    }
    return oneShotPaymentHandler(context);
  }, {
    paymentKind: "one-shot",
    policy: {
      allowedNetworks: [localNetwork],
      allowOneShot: true,
      allowSessions: false,
      requireSession: false,
      maxAmount: options.maxOneShotAmount
    }
  });
  const packageId = process.env.SUI402_SESSION_PACKAGE_ID;
  if (!packageId) {
    if (options.sessionOnly) {
      throw new Error("--session-only requires SUI402_SESSION_PACKAGE_ID or a configured session package");
    }
    return oneShot;
  }

  return async (context) => {
    if (context.challenge.network !== localNetwork) {
      throw new Error(
        `Sui402 challenge network ${context.challenge.network} does not match local SUI402_NETWORK ${localNetwork}. Set SUI402_NETWORK to the challenge network or choose a matching marketplace API.`
      );
    }

    const sessionFirst = createAutoSuiSessionPaymentHandler(signer, {
      packageId,
      owner,
      client,
      resourceScopeHash: resourceScopeHash(context.challenge.resource),
      fallback: options.sessionOnly ? undefined : oneShot
    });
    if (!options.sessionOnly) {
      return sessionFirst(context);
    }

    const guardedSession = createPolicyGuardedPaymentHandler(sessionFirst, {
      paymentKind: "session",
      policy: {
        allowedNetworks: [localNetwork],
        allowOneShot: false,
        allowSessions: true,
        requireSession: true
      }
    });
    return guardedSession(context);
  };
}

function createSigner(client: SuiGrpcClient, keypair: Keypair): SuiTransactionSigner {
  return {
    toSuiAddress: () => keypair.toSuiAddress(),
    signAndExecuteTransaction: async ({ transaction }: { transaction: Transaction }) => {
      await preflightSuiTransaction(client, transaction, keypair.toSuiAddress());
      const result = await client.signAndExecuteTransaction({
        transaction,
        signer: keypair,
        include: {
          effects: true
        }
      });
      if (result.$kind === "FailedTransaction") {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
      }

      await waitForSubmittedTransaction(client, result, result.Transaction.digest);
      return { digest: result.Transaction.digest };
    }
  };
}

async function inspectSessions(options: SessionInspectOptions): Promise<void> {
  const owner = options.owner ?? getKeypair().toSuiAddress();
  const packageId = resolveSessionPackageId(options.packageId);
  const scopeHash = options.resourceScopeHash ?? (options.resource ? resourceScopeHash(options.resource) : undefined);
  const result = await readOwnedSessions({
    owner,
    packageId,
    coinType: options.coinType,
    merchant: options.merchant,
    resourceScopeHash: scopeHash,
    limit: options.limit,
    maxPages: options.maxPages
  });
  const nowMs = BigInt(Date.now());
  const sessions = result.sessions.map((session) => ({
    ...session,
    status: describeSessionStatus(session, {
      amount: options.amount,
      merchant: options.merchant,
      resourceScopeHash: scopeHash,
      nowMs
    })
  }));
  const summary = summarizeSessionReadiness(sessions, {
    amount: options.amount,
    merchant: options.merchant,
    resource: options.resource,
    resourceScopeHash: scopeHash,
    hasMoreObjects: result.hasMoreObjects
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          owner: result.owner,
          network: result.network,
          packageId: result.packageId,
          custody: "user-owned",
          query: {
            coinType: options.coinType,
            merchant: options.merchant,
            resource: options.resource,
            resourceScopeHash: scopeHash,
            amount: options.amount
          },
          scan: {
            limit: options.limit,
            maxPages: options.maxPages,
            scannedPages: result.scannedPages,
            reachedLimit: result.reachedLimit,
            hasMoreObjects: result.hasMoreObjects
          },
          summary,
          sessions
        },
        null,
        2
      )
    );
    return;
  }

  printSessionInspection(result, sessions, {
    amount: options.amount,
    merchant: options.merchant,
    resource: options.resource,
    resourceScopeHash: scopeHash,
    summary
  });
}

async function openSession(options: SessionOpenOptions): Promise<void> {
  const packageId = resolveSessionPackageId(options.packageId);
  const merchant = requiredOption(options.merchant, "--merchant");
  if (!options.resource && !options.resourceScopeHash) {
    throw new Error("--resource or --resource-scope-hash is required");
  }
  const resourceScope = options.resource;
  const maxPerRequest = readU64String(requiredOption(options.maxPerRequest, "--max-per-request"), "--max-per-request");
  const funding = readSessionFunding(options);
  const expiresMs = resolveSessionExpiresMs(options);
  const scopeHash = options.resourceScopeHash ? normalizeResourceScopeHash(options.resourceScopeHash) : resourceScopeHash(resourceScope!);
  const plan: SessionMutationPlan = {
    action: "open",
    custody: "user-owned",
    packageId,
    coinType: options.coinType,
    signerRequired: true,
    requiresConfirmation: true,
    confirmed: options.yes,
    warning: "This will sign locally and submit a Sui transaction that locks funds into a user-owned Sui402 session.",
    details: {
      merchant,
      ...(resourceScope ? { resource: resourceScope } : {}),
      resourceScopeHash: scopeHash,
      maxPerRequest,
      expiresMs,
      expiresAt: new Date(Number(BigInt(expiresMs))).toISOString(),
      funding: describeFunding(funding, options.coinType),
      ...describeSessionOpenBudget(funding, options.coinType, maxPerRequest)
    }
  };

  const tx = () =>
    buildOpenSessionTransaction({
      packageId,
      coinType: options.coinType,
      merchant,
      maxPerRequest,
      expiresMs,
      resourceScopeHash: scopeHash,
      funding
    });
  await maybeExecuteSessionMutation(plan, tx, options);
}

async function fundSession(options: SessionFundOptions): Promise<void> {
  const packageId = resolveSessionPackageId(options.packageId);
  const sessionId = requiredOption(options.sessionId, "--session-id");
  const funding = readSessionFunding(options);
  const plan: SessionMutationPlan = {
    action: "fund",
    custody: "user-owned",
    packageId,
    coinType: options.coinType,
    signerRequired: true,
    requiresConfirmation: true,
    confirmed: options.yes,
    warning: "This will sign locally and submit a Sui transaction that adds funds to an existing user-owned Sui402 session.",
    details: {
      sessionId,
      funding: describeFunding(funding, options.coinType),
      ...describeSessionFundBudget(funding, options.coinType)
    }
  };

  const tx = () =>
    buildFundSessionTransaction({
      packageId,
      coinType: options.coinType,
      sessionId,
      funding
    });
  await maybeExecuteSessionMutation(plan, tx, options);
}

async function closeSession(options: SessionCloseOptions): Promise<void> {
  const packageId = resolveSessionPackageId(options.packageId);
  const sessionId = requiredOption(options.sessionId, "--session-id");
  const plan: SessionMutationPlan = {
    action: "close",
    custody: "user-owned",
    packageId,
    coinType: options.coinType,
    signerRequired: true,
    requiresConfirmation: true,
    confirmed: options.yes,
    warning: "This will sign locally and submit a Sui transaction that closes the session and returns remaining funds according to the Move module.",
    details: {
      sessionId
    }
  };

  const tx = () =>
    buildCloseSessionTransaction({
      packageId,
      coinType: options.coinType,
      sessionId
    });
  await maybeExecuteSessionMutation(plan, tx, options);
}

async function maybeExecuteSessionMutation(
  plan: SessionMutationPlan,
  buildTransaction: () => Transaction,
  options: { yes: boolean; json: boolean }
): Promise<void> {
  if (!options.yes) {
    printSessionMutationPlan(plan, options.json);
    return;
  }

  const executionContext = createSessionExecutionContext();
  const executionPlan = addExecutionDetails(plan, executionContext);

  if (!options.json) {
    printSessionMutationPlan(executionPlan, false, {
      stream: "stderr",
      showRerunHint: false
    });
  }

  const response = await signAndExecuteSessionTransaction(buildTransaction(), executionContext);
  const output = {
    ...executionPlan,
    digest: response.digest,
    status: response.status,
    sessionId: plan.action === "open" ? findCreatedSessionId(response) : plan.details.sessionId
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printSessionMutationResult(output);
}

function createSessionExecutionContext(): SessionExecutionContext {
  const grpc = getGrpcConfig();
  const signer = getKeypair();
  return {
    client: new SuiGrpcClient({
      network: grpc.networkName,
      baseUrl: grpc.grpcUrl
    }),
    signer,
    signerAddress: signer.toSuiAddress(),
    network: grpc.network,
    grpcUrl: grpc.grpcUrl
  };
}

function addExecutionDetails(plan: SessionMutationPlan, context: SessionExecutionContext): SessionMutationPlan {
  return {
    ...plan,
    details: {
      ...plan.details,
      signer: context.signerAddress,
      network: context.network,
      grpcUrl: context.grpcUrl
    }
  };
}

async function signAndExecuteSessionTransaction(transaction: Transaction, context: SessionExecutionContext): Promise<{
  digest?: string;
  status?: unknown;
  effects?: { changedObjects?: Array<{ idOperation?: string; objectId?: string }> };
  objectTypes?: Record<string, string>;
}> {
  await preflightSuiTransaction(context.client, transaction, context.signerAddress);
  const result = await context.client.signAndExecuteTransaction({
    transaction,
    signer: context.signer,
    include: {
      effects: true,
      events: true,
      objectTypes: true,
      balanceChanges: true
    }
  });
  if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }
  await waitForSubmittedTransaction(context.client, result, result.Transaction.digest);
  return result.Transaction;
}

async function preflightSuiTransaction(client: SuiGrpcClient, transaction: Transaction, signerAddress: string): Promise<void> {
  transaction.setSenderIfNotSet(signerAddress);
  try {
    const result = await client.simulateTransaction({
      transaction,
      include: {
        effects: true,
        balanceChanges: true
      }
    });
    if (result.$kind === "FailedTransaction") {
      throw new Error(result.FailedTransaction.status.error?.message ?? "simulation returned a failed transaction");
    }
  } catch (error) {
    throw new Error(
      `Sui transaction preflight failed before signing: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function waitForSubmittedTransaction(
  client: SuiGrpcClient,
  result: Awaited<ReturnType<SuiGrpcClient["signAndExecuteTransaction"]>>,
  digest: string
): Promise<void> {
  try {
    await client.waitForTransaction({ result });
  } catch (error) {
    throw new Error(
      `Sui transaction ${digest} was submitted, but waiting for transaction finality/indexing failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function findCreatedSessionId(response: {
  effects?: { changedObjects?: Array<{ idOperation?: string; objectId?: string }> };
  objectTypes?: Record<string, string>;
}): string | undefined {
  return response.effects?.changedObjects?.find(
    (change) =>
      change.idOperation === "Created" &&
      change.objectId &&
      response.objectTypes?.[change.objectId]?.includes("::sessions::AgentPaymentSession")
  )?.objectId;
}

async function readOwnedSessions(options: {
  owner: string;
  packageId: string;
  coinType?: string;
  merchant?: string;
  resourceScopeHash?: string;
  limit: number;
  maxPages: number;
}): Promise<SessionReadResult> {
  const client = getClient();
  const sessions: AgentPaymentSession[] = [];
  let cursor: string | null | undefined;
  let scannedPages = 0;
  let hasMoreObjects = false;

  while (scannedPages < options.maxPages) {
    const page = await client.core.listOwnedObjects({
      owner: options.owner,
      cursor,
      limit: SESSION_PAGE_SIZE,
      include: {
        json: true
      }
    });
    scannedPages += 1;

    for (const object of page.objects) {
      const session = parseAgentPaymentSessionObject(object, options.packageId);
      if (!session || !sessionMatches(session, options)) {
        continue;
      }

      sessions.push(session);
      if (sessions.length >= options.limit) {
        return {
          owner: options.owner,
          network: getNetwork(),
          packageId: options.packageId,
          sessions,
          scannedPages,
          reachedLimit: true,
          hasMoreObjects: Boolean(page.hasNextPage)
        };
      }
    }

    hasMoreObjects = Boolean(page.hasNextPage);
    cursor = page.hasNextPage ? page.cursor : null;
    if (!cursor) {
      break;
    }
  }

  return {
    owner: options.owner,
    network: getNetwork(),
    packageId: options.packageId,
    sessions,
    scannedPages,
    reachedLimit: false,
    hasMoreObjects
  };
}

function sessionMatches(
  session: AgentPaymentSession,
  options: {
    coinType?: string;
    merchant?: string;
    resourceScopeHash?: string;
  }
): boolean {
  if (options.coinType && normalizeComparable(session.coinType) !== normalizeComparable(options.coinType)) {
    return false;
  }

  if (options.merchant && normalizeComparable(session.merchant) !== normalizeComparable(options.merchant)) {
    return false;
  }

  if (
    options.resourceScopeHash &&
    stripHexPrefix(session.resourceScopeHash).toLowerCase() !== stripHexPrefix(options.resourceScopeHash).toLowerCase()
  ) {
    return false;
  }

  return true;
}

function describeSessionStatus(
  session: AgentPaymentSession,
  options: {
    amount?: string;
    merchant?: string;
    resourceScopeHash?: string;
    nowMs: bigint;
  }
): { usable: boolean; reasons: string[]; expiresAt: string } {
  const reasons: string[] = [];
  const expiresMs = BigInt(session.expiresMs);

  if (session.revoked) {
    reasons.push("revoked");
  }

  if (expiresMs <= options.nowMs) {
    reasons.push("expired");
  }

  if (options.amount) {
    const amount = BigInt(options.amount);
    if (BigInt(session.balance) < amount) {
      reasons.push("balance below requested amount");
    }
    if (BigInt(session.maxPerRequest) < amount) {
      reasons.push("max_per_request below requested amount");
    }
  }

  if (options.merchant && normalizeComparable(session.merchant) !== normalizeComparable(options.merchant)) {
    reasons.push("merchant mismatch");
  }

  if (
    options.resourceScopeHash &&
    stripHexPrefix(session.resourceScopeHash).toLowerCase() !== stripHexPrefix(options.resourceScopeHash).toLowerCase()
  ) {
    reasons.push("resource scope mismatch");
  }

  return {
    usable: reasons.length === 0,
    reasons,
    expiresAt: new Date(Number(expiresMs)).toISOString()
  };
}

function summarizeSessionReadiness(
  sessions: Array<AgentPaymentSession & { status: { usable: boolean; reasons: string[]; expiresAt: string } }>,
  query: {
    amount?: string;
    merchant?: string;
    resource?: string;
    resourceScopeHash?: string;
    hasMoreObjects: boolean;
  }
): SessionReadinessSummary {
  const usable = sessions.filter((session) => session.status.usable);
  const usableBalances = usable.map((session) => BigInt(session.balance));
  const usableBalance = usableBalances.reduce((total, balance) => total + balance, 0n);
  const largestUsableBalance = usableBalances.reduce((largest, balance) => (balance > largest ? balance : largest), 0n);
  const canCoverAmount = query.amount ? usable.some((session) => BigInt(session.balance) >= BigInt(query.amount!)) : undefined;
  const nextActions: string[] = [];

  if (sessions.length === 0) {
    nextActions.push("Open a user-owned session with `sui402-pay session open ...` or allow bounded one-shot fallback with `--max-one-shot-amount`.");
  } else if (usable.length === 0) {
    nextActions.push("No matching session is currently usable. Inspect the reason lines, then fund/open a matching session or use bounded one-shot fallback.");
  } else if (query.amount && canCoverAmount === false) {
    nextActions.push("A matching session exists, but none can cover the requested amount. Fund the session or lower the request amount.");
  } else {
    nextActions.push("A matching user-owned session is usable; `sui402-pay curl` will prefer it before one-shot fallback.");
  }

  if (query.hasMoreObjects) {
    nextActions.push("More owned objects may exist. Increase --max-pages before treating this scan as complete.");
  }

  if (query.resource && !query.resourceScopeHash) {
    nextActions.push("Resource scope hash could not be derived; pass --resource-scope-hash explicitly.");
  }

  return {
    matchedSessions: sessions.length,
    usableSessions: usable.length,
    unusableSessions: sessions.length - usable.length,
    usableBalance: usableBalance.toString(),
    largestUsableBalance: largestUsableBalance.toString(),
    ...(canCoverAmount === undefined ? {} : { canCoverAmount }),
    fallbackWouldBeOneShot: usable.length === 0 || canCoverAmount === false,
    nextActions
  };
}

function parseCurlOptions(args: string[]): CurlOptions {
  const headers = new Headers();
  let method = "GET";
  let body: string | undefined;
  let url: string | undefined;
  let sessionOnly = false;
  let maxOneShotAmount = process.env.SUI402_MAX_ONE_SHOT_AMOUNT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "-X" || arg === "--method") {
      method = readNext(args, ++index, arg).toUpperCase();
    } else if (arg === "-H" || arg === "--header") {
      const header = readNext(args, ++index, arg);
      const separator = header.indexOf(":");
      if (separator <= 0) {
        throw new Error(`Invalid header "${header}". Use "Name: value".`);
      }
      headers.append(header.slice(0, separator).trim(), header.slice(separator + 1).trim());
    } else if (arg === "-d" || arg === "--data" || arg === "--body") {
      body = readNext(args, ++index, arg);
      if (method === "GET") {
        method = "POST";
      }
    } else if (arg === "--session-only") {
      sessionOnly = true;
    } else if (arg === "--max-one-shot-amount") {
      maxOneShotAmount = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported curl option: ${arg}`);
    } else if (!url) {
      url = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!url) {
    throw new Error(
      "Usage: sui402-pay curl <url> [-X METHOD] [-H 'Name: value'] [--body data] [--session-only] [--max-one-shot-amount ATOMIC]"
    );
  }

  if (maxOneShotAmount !== undefined) {
    maxOneShotAmount = readU64String(maxOneShotAmount, "SUI402_MAX_ONE_SHOT_AMOUNT/--max-one-shot-amount");
  }

  return { url, method, headers, body, sessionOnly, maxOneShotAmount };
}

function parseWalletOptions(args: string[], defaults: WalletOptions): WalletOptions {
  const options = { ...defaults };

  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--human") {
      options.json = false;
    } else if (arg === "--balance" || arg === "--check-balance") {
      options.checkBalance = true;
    } else if (arg === "--no-balance") {
      options.checkBalance = false;
    } else if (arg === "--check") {
      // handled by setupCommand; accepted here so setup --check composes with --json/--balance.
    } else {
      throw new Error(`Unsupported wallet/setup option: ${arg}`);
    }
  }

  return options;
}

function parseReadinessOptions(args: string[], defaults: ReadinessOptions): ReadinessOptions {
  const options = { ...defaults };

  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--human") {
      options.json = false;
    } else if (arg === "--balance" || arg === "--check-balance") {
      options.checkBalance = true;
    } else if (arg === "--no-balance") {
      options.checkBalance = false;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--no-strict") {
      options.strict = false;
    } else {
      throw new Error(`Unsupported readiness option: ${arg}`);
    }
  }

  return options;
}

function parseSetupOptions(args: string[], defaults: SetupOptions): SetupOptions {
  const options = { ...defaults };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--human") {
      options.json = false;
    } else if (arg === "--balance" || arg === "--check-balance") {
      options.checkBalance = true;
    } else if (arg === "--no-balance") {
      options.checkBalance = false;
    } else if (arg === "--check") {
      // accepted so setup --check composes with --json/--balance.
    } else if (arg === "--print-env") {
      options.printEnv = true;
    } else if (arg === "--write-env") {
      options.writeEnvPath = readNext(args, ++index, arg);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--network") {
      options.network = readSui402Network(readNext(args, ++index, arg));
    } else if (arg === "--grpc-url") {
      options.grpcUrl = readUrlOption(readNext(args, ++index, arg), arg);
    } else if (arg === "--marketplace-url") {
      options.marketplaceUrl = readUrlOption(readNext(args, ++index, arg), arg);
    } else if (arg === "--session-package-id") {
      options.sessionPackageId = readNext(args, ++index, arg);
    } else if (arg === "--max-one-shot-amount") {
      options.maxOneShotAmount = readU64String(readNext(args, ++index, arg), arg);
    } else {
      throw new Error(`Unsupported setup option: ${arg}`);
    }
  }

  return options;
}

function parseSessionInspectOptions(args: string[]): SessionInspectOptions {
  const options: SessionInspectOptions = {
    limit: DEFAULT_SESSION_LIMIT,
    maxPages: DEFAULT_SESSION_MAX_PAGES,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--owner") {
      options.owner = readNext(args, ++index, arg);
    } else if (arg === "--package-id") {
      options.packageId = readNext(args, ++index, arg);
    } else if (arg === "--coin-type") {
      options.coinType = readNext(args, ++index, arg);
    } else if (arg === "--merchant") {
      options.merchant = readNext(args, ++index, arg);
    } else if (arg === "--resource") {
      options.resource = readNext(args, ++index, arg);
    } else if (arg === "--resource-scope-hash") {
      options.resourceScopeHash = normalizeResourceScopeHash(readNext(args, ++index, arg));
    } else if (arg === "--amount") {
      options.amount = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--limit") {
      options.limit = readPositiveInteger(readNext(args, ++index, arg), arg);
    } else if (arg === "--max-pages") {
      options.maxPages = readPositiveInteger(readNext(args, ++index, arg), arg);
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unsupported session inspect option: ${arg}`);
    }
  }

  if (options.resource && options.resourceScopeHash) {
    throw new Error("Use either --resource or --resource-scope-hash, not both");
  }

  return options;
}

function parseSessionOpenOptions(args: string[]): SessionOpenOptions {
  const options: SessionOpenOptions = {
    coinType: SUI_COIN_TYPE,
    yes: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--package-id") {
      options.packageId = readNext(args, ++index, arg);
    } else if (arg === "--merchant") {
      options.merchant = readNext(args, ++index, arg);
    } else if (arg === "--coin-type") {
      options.coinType = readNext(args, ++index, arg);
    } else if (arg === "--resource") {
      options.resource = readNext(args, ++index, arg);
    } else if (arg === "--resource-scope-hash") {
      options.resourceScopeHash = normalizeResourceScopeHash(readNext(args, ++index, arg));
    } else if (arg === "--max-per-request") {
      options.maxPerRequest = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--funding" || arg === "--amount") {
      options.fundingAmount = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--coin-object-id") {
      options.fundingCoinObjectId = readNext(args, ++index, arg);
    } else if (arg === "--expires-ms") {
      options.expiresMs = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--ttl-ms") {
      options.ttlMs = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unsupported session open option: ${arg}`);
    }
  }

  assertResourceScopeOptions(options.resource, options.resourceScopeHash);
  return options;
}

function parseSessionFundOptions(args: string[]): SessionFundOptions {
  const options: SessionFundOptions = {
    coinType: SUI_COIN_TYPE,
    yes: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--package-id") {
      options.packageId = readNext(args, ++index, arg);
    } else if (arg === "--session-id") {
      options.sessionId = readNext(args, ++index, arg);
    } else if (arg === "--coin-type") {
      options.coinType = readNext(args, ++index, arg);
    } else if (arg === "--funding" || arg === "--amount") {
      options.fundingAmount = readU64String(readNext(args, ++index, arg), arg);
    } else if (arg === "--coin-object-id") {
      options.fundingCoinObjectId = readNext(args, ++index, arg);
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unsupported session fund option: ${arg}`);
    }
  }

  return options;
}

function parseSessionCloseOptions(args: string[]): SessionCloseOptions {
  const options: SessionCloseOptions = {
    coinType: SUI_COIN_TYPE,
    yes: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--package-id") {
      options.packageId = readNext(args, ++index, arg);
    } else if (arg === "--session-id") {
      options.sessionId = readNext(args, ++index, arg);
    } else if (arg === "--coin-type") {
      options.coinType = readNext(args, ++index, arg);
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unsupported session close option: ${arg}`);
    }
  }

  return options;
}

function parseMarketplaceSearchOptions(args: string[]): MarketplaceSearchOptions {
  const options: MarketplaceSearchOptions = {
    limit: DEFAULT_MARKETPLACE_LIMIT,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--marketplace-url" || arg === "--console-url" || arg === "--api-url") {
      options.marketplaceUrl = readNext(args, ++index, arg);
    } else if (arg === "--q" || arg === "--query") {
      options.query = readNext(args, ++index, arg);
    } else if (arg === "--network") {
      options.network = readSui402Network(readNext(args, ++index, arg));
    } else if (arg === "--transport") {
      options.transport = readTransport(readNext(args, ++index, arg));
    } else if (arg === "--tag") {
      options.tag = readNext(args, ++index, arg);
    } else if (arg === "--limit") {
      options.limit = readPositiveInteger(readNext(args, ++index, arg), arg, MAX_MARKETPLACE_LIMIT);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported search option: ${arg}`);
    } else if (!options.query) {
      options.query = arg;
    } else {
      options.query = `${options.query} ${arg}`;
    }
  }

  return options;
}

function parseMarketplaceDetailOptions(args: string[]): MarketplaceDetailOptions {
  const options: Partial<MarketplaceDetailOptions> & { json: boolean } = {
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--marketplace-url" || arg === "--console-url" || arg === "--api-url") {
      options.marketplaceUrl = readNext(args, ++index, arg);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported marketplace detail option: ${arg}`);
    } else if (!options.id) {
      options.id = arg;
    } else {
      throw new Error(`Unexpected marketplace detail argument: ${arg}`);
    }
  }

  if (!options.id) {
    throw new Error("marketplace detail requires an API id");
  }

  return options as MarketplaceDetailOptions;
}

function parseScanStatsOptions(args: string[]): ScanStatsOptions {
  const options: ScanStatsOptions = {
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--marketplace-url" || arg === "--console-url" || arg === "--api-url") {
      options.marketplaceUrl = readNext(args, ++index, arg);
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unsupported scan stats option: ${arg}`);
    }
  }

  return options;
}

function parseScanLookupOptions(args: string[], label: string): ScanLookupOptions {
  const options: Partial<ScanLookupOptions> & { json: boolean } = {
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      throw new Error("Unexpected empty argument");
    }

    if (arg === "--marketplace-url" || arg === "--console-url" || arg === "--api-url") {
      options.marketplaceUrl = readNext(args, ++index, arg);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported scan lookup option: ${arg}`);
    } else if (!options.id) {
      options.id = arg;
    } else {
      throw new Error(`Unexpected scan lookup argument: ${arg}`);
    }
  }

  if (!options.id) {
    throw new Error(`scan lookup requires a ${label}`);
  }

  return options as ScanLookupOptions;
}

async function printResponse(response: Response): Promise<void> {
  console.error(`HTTP/${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!body) {
    return;
  }

  if (contentType.includes("application/json")) {
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
      return;
    } catch {
      // Fall through and print the raw body.
    }
  }

  console.log(body);
}

async function readWalletStatus(options: { checkBalance: boolean }): Promise<WalletStatus> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const grpc = getGrpcConfig();
  const marketplaceUrl = process.env.SUI402_MARKETPLACE_URL ?? process.env.SUI402_CONSOLE_API_URL;
  let signer: ReturnType<typeof resolveKeypair> | undefined;

  try {
    signer = resolveKeypair(warnings);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unable to read local signer");
  }

  const status: WalletStatus = {
    custody: "user-owned",
    signerConfigured: Boolean(signer),
    signerSource: signer?.source,
    signerPath: signer?.path,
    address: signer?.keypair.toSuiAddress(),
    network: grpc.network,
    grpcUrl: grpc.grpcUrl,
    grpcUrlSource: grpc.grpcUrlSource,
    sessionPackageId: process.env.SUI402_SESSION_PACKAGE_ID || undefined,
    marketplaceUrl,
    balanceCheck: "skipped",
    funding: buildFundingGuidance(grpc.network, signer?.keypair.toSuiAddress()),
    warnings,
    errors,
    readiness: {
      readyForPaidCalls: false,
      level: "error",
      summary: "Wallet readiness has not been evaluated yet.",
      checks: [],
      nextActions: []
    }
  };

  if (!options.checkBalance || !signer) {
    status.readiness = buildWalletReadiness(status);
    return status;
  }

  try {
    const { balance } = await getClient().core.getBalance({
      owner: signer.keypair.toSuiAddress(),
      coinType: "0x2::sui::SUI"
    });
    status.balanceCheck = "ok";
    status.balance = {
      coinType: "0x2::sui::SUI",
      balance: balance.balance.toString(),
      coinBalance: balance.coinBalance.toString(),
      addressBalance: balance.addressBalance.toString()
    };
  } catch (error) {
    status.balanceCheck = "failed";
    status.errors.push(error instanceof Error ? `Balance check failed: ${error.message}` : "Balance check failed");
  }

  status.readiness = buildWalletReadiness(status);
  return status;
}

function buildWalletReadiness(status: WalletStatus): WalletReadiness {
  const signerOk = status.signerConfigured;
  const balance = status.balance ? BigInt(status.balance.balance) : undefined;
  const gasOk = status.balanceCheck === "ok" && balance !== undefined && balance > 0n;
  const balanceFailed = status.balanceCheck === "failed" && signerOk;
  const signerCheck = {
    name: "local_signer" as const,
    ok: signerOk,
    message: signerOk
      ? `Local ${status.signerSource} signer detected for ${status.address}.`
      : "No local Sui signer detected."
  };
  const gasCheck = {
    name: "sui_gas_balance" as const,
    ok: gasOk,
    message:
      status.balanceCheck === "skipped"
        ? "Gas balance was not checked. Run with --balance before paid calls."
        : balanceFailed
          ? "Gas balance check failed against the configured Sui gRPC endpoint."
          : gasOk
            ? `SUI gas balance is ${status.balance!.balance} MIST.`
            : "SUI gas balance is zero; paid calls need SUI for gas even when paying with another coin."
  };

  if (!signerOk) {
    return {
      readyForPaidCalls: false,
      level: "needs_wallet",
      summary: "Configure a user-owned Sui signer before paid calls.",
      checks: [signerCheck, gasCheck],
      nextActions: [
        "Initialize or select a Sui CLI wallet: run `sui client -y`, save the recovery phrase, then rerun `sui402-pay wallet --human --balance`.",
        "Or inject SUI_SECRET_KEY/SUI_MNEMONIC from your own secret manager; Sui402 will not write those secrets to setup profiles.",
        status.funding.summary
      ]
    };
  }

  if (status.balanceCheck === "skipped") {
    return {
      readyForPaidCalls: false,
      level: "needs_gas_check",
      summary: "Signer is configured; gas readiness is unverified.",
      checks: [signerCheck, gasCheck],
      nextActions: [`Run \`sui402-pay wallet --balance\` to verify SUI gas for ${status.address}.`, status.funding.summary]
    };
  }

  if (balanceFailed) {
    return {
      readyForPaidCalls: false,
      level: "needs_network",
      summary: "Signer is configured, but Sui gRPC balance lookup failed.",
      checks: [signerCheck, gasCheck],
      nextActions: [
        "Check SUI402_NETWORK and SUI_GRPC_URL, then rerun `sui402-pay wallet --balance`.",
        "If you use a private fullnode, confirm it supports the configured network and gRPC endpoint."
      ]
    };
  }

  if (!gasOk) {
    return {
      readyForPaidCalls: false,
      level: "needs_gas",
      summary: "Signer is configured, but the wallet needs SUI gas before paid calls.",
      checks: [signerCheck, gasCheck],
      nextActions: [status.funding.summary, "After funding, rerun `sui402-pay wallet --balance`."]
    };
  }

  return {
    readyForPaidCalls: true,
    level: "ready",
    summary: "Wallet signer and SUI gas are ready for local paid calls.",
    checks: [signerCheck, gasCheck],
    nextActions: [
      status.marketplaceUrl
        ? "Discover an API with `sui402-pay search <query>` or inspect one with `sui402-pay marketplace detail <api-id>`."
        : "Set SUI402_MARKETPLACE_URL or pass --marketplace-url to discover APIs.",
      "Use `sui402-pay curl <protected-url> --max-one-shot-amount <atomic>` to keep one-shot fallback bounded."
    ]
  };
}

function gasFundingGuidance(status: Pick<WalletStatus, "network" | "address">): string {
  return buildFundingGuidance(status.network, status.address).summary;
}

function buildFundingGuidance(network: Sui402Network, address: string | undefined): WalletFundingGuidance {
  const target = address ?? "your Sui address";
  if (network === "sui:testnet") {
    return {
      custody: "user-owned",
      purpose: "sui_gas",
      coinType: "0x2::sui::SUI",
      network,
      address,
      summary: `For Testnet gas, request SUI at https://faucet.sui.io for ${target}; do not rely on \`sui client faucet\` for Testnet.`,
      actions: [
        {
          kind: "web_faucet",
          label: "Request Testnet SUI",
          url: "https://faucet.sui.io",
          note: "Use the web faucet for Testnet gas. Faucets are rate limited and never require sharing your private key."
        }
      ]
    };
  }

  if (network === "sui:devnet" || network === "sui:localnet") {
    const networkName = network.replace("sui:", "");
    return {
      custody: "user-owned",
      purpose: "sui_gas",
      coinType: "0x2::sui::SUI",
      network,
      address,
      summary: `For ${networkName} gas, use the matching faucet flow, such as \`sui client faucet\` where supported, then rerun \`sui402-pay wallet --balance\`.`,
      actions: [
        {
          kind: "cli_faucet",
          label: `Request ${networkName} SUI`,
          command: address ? `sui client faucet --address ${address}` : "sui client faucet",
          note: "Run this against a Sui CLI environment configured for the same network. Faucets are for gas only and may be rate limited."
        }
      ]
    };
  }

  return {
    custody: "user-owned",
    purpose: "sui_gas",
    coinType: "0x2::sui::SUI",
    network,
    address,
    summary: `For Mainnet gas, fund ${target} with enough SUI for transaction fees before paid calls.`,
    actions: [
      {
        kind: "deposit",
        label: "Deposit Mainnet SUI",
        note: "Send SUI to the user-owned wallet address from an exchange or another wallet. Sui402 does not custody or sponsor Mainnet gas."
      }
    ]
  };
}

function getKeypair(): Keypair {
  return resolveKeypair().keypair;
}

function resolveKeypair(warnings: string[] = []): {
  keypair: Keypair;
  source: "SUI_SECRET_KEY" | "SUI_MNEMONIC" | "SUI_CLI_KEYSTORE";
  path?: string;
} {
  const secretKey = process.env.SUI_SECRET_KEY;
  const mnemonic = process.env.SUI_MNEMONIC;

  if (secretKey) {
    if (mnemonic) {
      warnings.push("Both SUI_SECRET_KEY and SUI_MNEMONIC are set; using SUI_SECRET_KEY.");
    }
    const decoded = decodeSuiSecretKey(secretKey);
    let keypair: Keypair;
    try {
      keypair = keypairFromSecretKey(decoded.scheme, decoded.secretKey);
    } catch {
      throw new Error("Invalid SUI_SECRET_KEY: expected a supported Sui private key exported as suiprivkey...");
    }
    return {
      keypair,
      source: "SUI_SECRET_KEY"
    };
  }

  if (mnemonic) {
    let keypair: Ed25519Keypair;
    try {
      keypair = Ed25519Keypair.deriveKeypair(mnemonic);
    } catch {
      throw new Error("Invalid SUI_MNEMONIC: expected a valid BIP-39 mnemonic phrase.");
    }
    return {
      keypair,
      source: "SUI_MNEMONIC"
    };
  }

  const cliKeypair = resolveSuiCliKeypair(warnings);
  if (cliKeypair) {
    return cliKeypair;
  }

  throw new Error(NO_SUI_WALLET_CONFIGURED);
}

function resolveSuiCliKeypair(warnings: string[]): {
  keypair: Keypair;
  source: "SUI_CLI_KEYSTORE";
  path: string;
} | undefined {
  const configPath = resolveSuiClientConfigPath();
  const activeAddress = process.env.SUI_ADDRESS ?? readActiveAddress(configPath);
  const keystorePath = resolveSuiKeystorePath(configPath);
  if (!keystorePath || !existsSync(keystorePath)) {
    return undefined;
  }

  const keys = readSuiCliKeystore(keystorePath, warnings);
  if (keys.length === 0) {
    throw new Error(`Sui CLI keystore ${keystorePath} does not contain a supported Sui key.`);
  }

  const selected = activeAddress ? keys.find((entry) => entry.keypair.toSuiAddress().toLowerCase() === activeAddress.toLowerCase()) : keys[0];
  if (!selected) {
    throw new Error(`Sui CLI keystore ${keystorePath} does not contain active address ${activeAddress}.`);
  }

  if (!activeAddress && keys.length > 1) {
    warnings.push("Sui CLI keystore has multiple supported keys; using the first key. Set SUI_ADDRESS to choose one.");
  }

  return {
    keypair: selected.keypair,
    source: "SUI_CLI_KEYSTORE",
    path: keystorePath
  };
}

function readSuiCliKeystore(path: string, warnings: string[]): Array<{ keypair: Keypair }> {
  let entries: unknown;
  try {
    entries = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Unable to read Sui CLI keystore at ${path}.`);
  }

  if (!Array.isArray(entries)) {
    throw new Error(`Sui CLI keystore ${path} must be a JSON array.`);
  }

  const keypairs: Array<{ keypair: Keypair }> = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }

    const decoded = decodeSuiCliKeystoreEntry(entry);
    if (!decoded) {
      continue;
    }

    if (!isSupportedLocalKeyScheme(decoded.scheme)) {
      warnings.push(`Skipping ${decoded.scheme} key from Sui CLI keystore; @sui402/pay supports ED25519, Secp256k1, and Secp256r1.`);
      continue;
    }

    try {
      keypairs.push({ keypair: keypairFromSecretKey(decoded.scheme, decoded.secretKey) });
    } catch {
      warnings.push(`Skipping invalid ${decoded.scheme} key from Sui CLI keystore.`);
    }
  }

  return keypairs;
}

function decodeSuiCliKeystoreEntry(entry: string): { scheme: "ED25519" | "Secp256k1" | "Secp256r1" | "unknown"; secretKey: Uint8Array } | undefined {
  const trimmed = entry.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("suiprivkey")) {
    const decoded = decodeSuiSecretKey(trimmed);
    return {
      scheme: decoded.scheme === "ED25519" || decoded.scheme === "Secp256k1" || decoded.scheme === "Secp256r1" ? decoded.scheme : "unknown",
      secretKey: decoded.secretKey
    };
  }

  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.length < 33) {
    return undefined;
  }

  const flag = bytes[0];
  if (flag === undefined) {
    return undefined;
  }

  return {
    scheme: suiSignatureSchemeForFlag(flag),
    secretKey: new Uint8Array(bytes.slice(1, 33))
  };
}

function keypairFromSecretKey(scheme: SignatureScheme | "unknown", secretKey: Uint8Array): Keypair {
  switch (scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(secretKey);
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(secretKey);
    default:
      throw new Error(`Unsupported Sui key scheme: ${scheme}`);
  }
}

function isSupportedLocalKeyScheme(scheme: string): scheme is "ED25519" | "Secp256k1" | "Secp256r1" {
  return scheme === "ED25519" || scheme === "Secp256k1" || scheme === "Secp256r1";
}

function suiSignatureSchemeForFlag(flag: number): "ED25519" | "Secp256k1" | "Secp256r1" | "unknown" {
  if (flag === 0) {
    return "ED25519";
  }
  if (flag === 1) {
    return "Secp256k1";
  }
  if (flag === 2) {
    return "Secp256r1";
  }

  return "unknown";
}

function resolveSuiClientConfigPath(): string {
  const explicit = process.env.SUI_CLIENT_CONFIG;
  return explicit ? resolve(explicit) : join(homedir(), ".sui", "sui_config", "client.yaml");
}

function resolveSuiKeystorePath(configPath: string): string | undefined {
  const explicit = process.env.SUI_KEYSTORE_PATH;
  if (explicit) {
    return resolve(explicit);
  }

  const configured = readKeystorePath(configPath);
  return configured ? resolve(dirname(configPath), configured) : join(homedir(), ".sui", "sui_config", "sui.keystore");
}

function readActiveAddress(configPath: string): string | undefined {
  const config = readOptionalText(configPath);
  if (!config) {
    return undefined;
  }

  return readYamlScalar(config, "active_address");
}

function readKeystorePath(configPath: string): string | undefined {
  const config = readOptionalText(configPath);
  if (!config) {
    return undefined;
  }

  const value = readYamlScalar(config, "keystore");
  if (!value) {
    return undefined;
  }

  const fileMatch = value.match(/^File:\s*(.+)$/i);
  return fileMatch?.[1]?.trim() ?? value;
}

function readOptionalText(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return readFileSync(path, "utf8");
}

function readYamlScalar(source: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
  const match = source.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].replace(/^["']|["']$/g, "").trim();
}

function getClient(): SuiGrpcClient {
  const { networkName: network, grpcUrl } = getGrpcConfig();
  return new SuiGrpcClient({
    network,
    baseUrl: grpcUrl
  });
}

function decodeSuiSecretKey(secretKey: string): ReturnType<typeof decodeSuiPrivateKey> {
  try {
    return decodeSuiPrivateKey(secretKey);
  } catch {
    throw new Error("Invalid SUI_SECRET_KEY: expected a Sui private key exported as suiprivkey...");
  }
}

function getGrpcConfig(): {
  network: Sui402Network;
  networkName: "mainnet" | "testnet" | "devnet" | "localnet";
  grpcUrl: string;
  grpcUrlSource: "SUI_GRPC_URL" | "default";
} {
  const network = getNetwork();
  const networkName = network.replace("sui:", "") as "mainnet" | "testnet" | "devnet" | "localnet";
  const customGrpcUrl = process.env.SUI_GRPC_URL;
  return {
    network,
    networkName,
    grpcUrl: customGrpcUrl ?? grpcUrlForNetwork(networkName),
    grpcUrlSource: customGrpcUrl ? "SUI_GRPC_URL" : "default"
  };
}

function getNetwork(): Sui402Network {
  const network = process.env.SUI402_NETWORK ?? "sui:testnet";
  if (!["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"].includes(network)) {
    throw new Error(`Unsupported SUI402_NETWORK: ${network}`);
  }

  return network as Sui402Network;
}

function resolveSessionPackageId(packageId?: string): string {
  const resolved = packageId ?? process.env.SUI402_SESSION_PACKAGE_ID;
  if (!resolved) {
    throw new Error(
      "No session package configured. Set SUI402_SESSION_PACKAGE_ID or pass --package-id. Run `sui402-pay session setup` for guidance."
    );
  }

  return resolved;
}

function grpcUrlForNetwork(network: "mainnet" | "testnet" | "devnet" | "localnet"): string {
  switch (network) {
    case "mainnet":
      return "https://fullnode.mainnet.sui.io:443";
    case "testnet":
      return "https://fullnode.testnet.sui.io:443";
    case "devnet":
      return "https://fullnode.devnet.sui.io:443";
    case "localnet":
      return "http://127.0.0.1:9000";
  }
}

function readNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function readPositiveInteger(value: string, flag: string, max?: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${flag} must be ${max} or less`);
  }

  return parsed;
}

function readPositiveIntegerString(value: string, flag: string): string {
  return readU64String(value, flag);
}

function readU64String(value: string, flag: string): string {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error();
    }
    if (parsed > U64_MAX) {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new Error(`${flag} must be a positive u64 integer in atomic units (${U64_MAX.toString()} or less)`);
  }
}

function requiredOption(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`${flag} is required`);
  }

  return value;
}

function assertResourceScopeOptions(resource?: string, scopeHash?: string): void {
  if (resource && scopeHash) {
    throw new Error("Use either --resource or --resource-scope-hash, not both");
  }
}

function normalizeResourceScopeHash(value: string): string {
  const normalized = stripHexPrefix(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("--resource-scope-hash must be a 32-byte SHA-256 hash as 64 hex characters, with optional 0x prefix");
  }

  return normalized;
}

function readSessionFunding(options: {
  coinType: string;
  fundingAmount?: string;
  fundingCoinObjectId?: string;
}): SessionFunding {
  if (options.fundingAmount && options.fundingCoinObjectId) {
    throw new Error("Use either --funding/--amount or --coin-object-id, not both");
  }

  if (options.coinType === SUI_COIN_TYPE) {
    return {
      kind: "sui",
      amount: readU64String(requiredOption(options.fundingAmount, "--funding"), "--funding")
    };
  }

  return {
    kind: "coin",
    coinObjectId: requiredOption(options.fundingCoinObjectId, "--coin-object-id")
  };
}

function resolveSessionExpiresMs(options: { expiresMs?: string; ttlMs?: string }): string {
  if (options.expiresMs && options.ttlMs) {
    throw new Error("Use either --expires-ms or --ttl-ms, not both");
  }

  if (options.expiresMs) {
    return assertFutureSessionExpiry(readU64String(options.expiresMs, "--expires-ms"), "--expires-ms");
  }

  const ttlMs = BigInt(readU64String(options.ttlMs ?? DEFAULT_SESSION_TTL_MS, "--ttl-ms"));
  const expiresMs = BigInt(Date.now()) + ttlMs;
  if (expiresMs > U64_MAX) {
    throw new Error(`--ttl-ms produces an expiry above u64 max (${U64_MAX.toString()})`);
  }

  return assertFutureSessionExpiry(expiresMs.toString(), "--ttl-ms");
}

function assertFutureSessionExpiry(expiresMs: string, flag: string): string {
  if (BigInt(expiresMs) <= BigInt(Date.now())) {
    throw new Error(`${flag} must resolve to a future Unix timestamp in milliseconds`);
  }

  return expiresMs;
}

function describeFunding(funding: SessionFunding, coinType: string): string {
  return funding.kind === "sui" ? `${funding.amount} ${shortCoinType(coinType)}` : `coin object ${funding.coinObjectId}`;
}

function describeSessionOpenBudget(funding: SessionFunding, coinType: string, maxPerRequest: string): Record<string, string> {
  if (funding.kind !== "sui") {
    return {
      budget: `funded by coin object; inspect the ${shortCoinType(coinType)} coin object balance before signing`
    };
  }

  const fundingAmount = BigInt(funding.amount);
  const perRequest = BigInt(maxPerRequest);
  const maxFullRequests = perRequest === 0n ? 0n : fundingAmount / perRequest;
  return {
    budget: `${funding.amount} ${shortCoinType(coinType)} locked in this user-owned session`,
    maxFullRequestsAtCap: maxFullRequests.toString(),
    unusedRemainderAtCap: perRequest === 0n ? String(funding.amount) : (fundingAmount % perRequest).toString()
  };
}

function describeSessionFundBudget(funding: SessionFunding, coinType: string): Record<string, string> {
  if (funding.kind !== "sui") {
    return {
      budgetDelta: `adds the selected ${shortCoinType(coinType)} coin object balance`
    };
  }

  return {
    budgetDelta: `adds ${funding.amount} ${shortCoinType(coinType)} to the session`
  };
}

function readSui402Network(value: string): Sui402Network {
  if (!["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"].includes(value)) {
    throw new Error("--network must be sui:mainnet, sui:testnet, sui:devnet, or sui:localnet");
  }

  return value as Sui402Network;
}

function readTransport(value: string): "http" | "mcp" {
  if (value !== "http" && value !== "mcp") {
    throw new Error("--transport must be http or mcp");
  }

  return value;
}

function readUrlOption(value: string, flag: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${flag} must be a valid URL`);
  }
}

function resolveMarketplaceBaseUrl(value: string | undefined): URL {
  const resolved = value ?? process.env.SUI402_MARKETPLACE_URL ?? process.env.SUI402_CONSOLE_API_URL;
  if (!resolved) {
    throw new Error(
      "No marketplace URL configured. Set SUI402_MARKETPLACE_URL or SUI402_CONSOLE_API_URL, or pass --marketplace-url."
    );
  }

  return new URL(resolved);
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/0x[0-9a-f]+(?=::)/g, normalizeTypeAddress);
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function normalizeTypeAddress(address: string): string {
  const trimmed = stripHexPrefix(address).replace(/^0+/, "") || "0";
  return `0x${trimmed}`;
}

function printSessionInspection(
  result: SessionReadResult,
  sessions: Array<AgentPaymentSession & { status: { usable: boolean; reasons: string[]; expiresAt: string } }>,
  query: {
    amount?: string;
    merchant?: string;
    resource?: string;
    resourceScopeHash?: string;
    summary: SessionReadinessSummary;
  }
): void {
  console.log(`Sui402 sessions for ${result.owner}`);
  console.log(`Network: ${result.network}`);
  console.log(`Package: ${result.packageId}`);
  console.log("Custody: user-owned wallet; this command is read-only and never handles private keys unless --owner is omitted.");

  if (query.merchant || query.resource || query.resourceScopeHash || query.amount) {
    console.log("");
    console.log("Readiness filter:");
    if (query.merchant) {
      console.log(`  merchant: ${query.merchant}`);
    }
    if (query.resource) {
      console.log(`  resource: ${query.resource}`);
    }
    if (query.resourceScopeHash) {
      console.log(`  resource scope hash: ${query.resourceScopeHash}`);
    }
    if (query.amount) {
      console.log(`  amount: ${query.amount}`);
    }
  }

  console.log("");
  console.log("Readiness summary:");
  console.log(`  matched sessions: ${query.summary.matchedSessions}`);
  console.log(`  usable sessions: ${query.summary.usableSessions}`);
  console.log(`  usable balance: ${query.summary.usableBalance}`);
  console.log(`  largest usable balance: ${query.summary.largestUsableBalance}`);
  if (query.summary.canCoverAmount !== undefined) {
    console.log(`  can cover amount: ${query.summary.canCoverAmount ? "yes" : "no"}`);
  }
  console.log(`  fallback would be one-shot: ${query.summary.fallbackWouldBeOneShot ? "yes" : "no"}`);
  if (query.summary.nextActions.length > 0) {
    console.log("  next actions:");
    for (const action of query.summary.nextActions) {
      console.log(`    - ${action}`);
    }
  }

  console.log("");
  if (sessions.length === 0) {
    console.log("No matching AgentPaymentSession objects found.");
  } else {
    for (const session of sessions) {
      console.log(`${session.status.usable ? "usable" : "not usable"}  ${session.id}`);
      console.log(`  coin: ${session.coinType}`);
      console.log(`  merchant: ${session.merchant}`);
      console.log(`  balance: ${session.balance}`);
      console.log(`  spent: ${session.spent}`);
      console.log(`  max/request: ${session.maxPerRequest}`);
      console.log(`  expires: ${session.status.expiresAt}`);
      console.log(`  scope hash: ${session.resourceScopeHash}`);
      if (session.status.reasons.length > 0) {
        console.log(`  reason: ${session.status.reasons.join("; ")}`);
      }
      console.log("");
    }
  }

  console.log(
    `Scan: ${result.scannedPages} page(s), ${sessions.length} session(s)` +
      (result.reachedLimit ? `, stopped at --limit ${sessions.length}` : "") +
      (result.hasMoreObjects ? ", more owned objects may exist; increase --max-pages if needed" : "")
  );
}

function printSessionMutationPlan(
  plan: SessionMutationPlan,
  json: boolean,
  options: { stream?: "stdout" | "stderr"; showRerunHint?: boolean } = {}
): void {
  if (json) {
    console.log(JSON.stringify({ mode: "plan", ...plan }, null, 2));
    return;
  }

  const write = options.stream === "stderr" ? console.error : console.log;
  write(`Sui402 session ${plan.action} plan`);
  write(`custody: ${plan.custody}`);
  write(`package: ${plan.packageId}`);
  write(`coin: ${plan.coinType}`);
  write(`confirmed: ${plan.confirmed ? "yes" : "no"}`);
  write("");
  for (const [key, value] of Object.entries(plan.details)) {
    write(`${key}: ${value}`);
  }
  write("");
  write(plan.warning);
  if (options.showRerunHint ?? true) {
    write(`Rerun with --yes to submit this transaction.`);
  } else {
    write("Submitting now because --yes was provided.");
  }
}

function printSessionMutationResult(result: SessionMutationPlan & { digest?: string; status?: unknown; sessionId?: string }): void {
  console.log(`Sui402 session ${result.action} submitted`);
  if (result.digest) {
    console.log(`digest: ${result.digest}`);
  }
  if (result.sessionId) {
    console.log(`session: ${result.sessionId}`);
  }
  if (result.status) {
    console.log(`status: ${JSON.stringify(result.status)}`);
  }
}

function printMarketplaceSearch(result: MarketplaceSearchResponse, baseUrl: URL): void {
  console.log(`Sui402 marketplace: ${baseUrl.toString()}`);
  console.log(`${result.count} API(s) found`);
  console.log("");

  if (result.apis.length === 0) {
    console.log("No matching APIs found.");
    return;
  }

  for (const api of result.apis) {
    console.log(`${api.id}  ${api.name}`);
    if (api.description) {
      console.log(`  ${api.description}`);
    }
    console.log(`  ${api.transport.toUpperCase()} ${api.network} ${api.price} ${shortCoinType(api.coinType)}`);
    console.log(`  resource: ${api.resourceScope}`);
    console.log(`  merchant: ${api.merchant}`);
    console.log(`  sessions: ${api.sessionSupported ? "yes" : "no"}`);
    if (api.readiness) {
      console.log(`  readiness: ${api.readiness.ready ? "ready" : api.readiness.level}`);
      if (!api.readiness.ready && api.readiness.reasons.length > 0) {
        console.log(`  readiness reason: ${api.readiness.reasons.slice(0, 2).join("; ")}`);
      }
    }
    const callCommand = api.commands?.curl ?? (api.protectedResourceUrl ? `sui402-pay curl ${api.protectedResourceUrl}` : undefined);
    if (callCommand) {
      console.log(`  call: ${callCommand}`);
    }
    if (api.commands?.sessionOnly) {
      console.log(`  session-only: ${api.commands.sessionOnly}`);
    }
    if (api.commands?.sessionInspect) {
      console.log(`  session inspect: ${api.commands.sessionInspect}`);
    }
    if (api.paymentPlan) {
      console.log(`  max one-shot: ${api.paymentPlan.maxOneShotAmount ?? api.price}`);
      console.log(`  session behavior: ${api.paymentPlan.sessionBehavior ?? (api.sessionSupported ? "session_first" : "capped_one_shot")}`);
    }
    if (api.sessionManagerUrl) {
      console.log(`  session manager: ${api.sessionManagerUrl}`);
    }
    if (api.tags && api.tags.length > 0) {
      console.log(`  tags: ${api.tags.join(", ")}`);
    }
    if (api.stats) {
      console.log(
        `  stats: ${api.stats.verifiedPayments ?? 0} verified, ${api.stats.sessionPayments ?? 0} session, volume ${
          api.stats.volume ?? "0"
        }`
      );
    }
    console.log("");
  }
}

function buildMarketplaceAgentSafety(detail: MarketplaceDetailResponse): MarketplaceAgentSafety {
  const api = detail.api;
  const readiness = detail.readiness ?? api.readiness;
  const stats = detail.stats ?? api.stats;
  const reliability = detail.reliability ?? api.reliability;
  const protectedUrl = detail.links?.protectedResourceUrl ?? api.protectedResourceUrl;
  const reasons: string[] = [];
  const nextActions: string[] = [];

  if (api.status !== "active") {
    reasons.push(`Listing status is ${api.status}; agents should not auto-pay paused or inactive listings.`);
  }

  if (!protectedUrl) {
    reasons.push("No protected resource URL is published for direct paid calls.");
  }

  if (!readiness) {
    reasons.push("Marketplace did not provide a readiness verdict; fail closed for autonomous payments.");
    nextActions.push(`Inspect the listing manually with \`sui402-pay marketplace detail ${api.id}\` and verify publisher readiness before paying.`);
  } else if (!readiness.ready) {
    reasons.push(...readiness.reasons);
    if (readiness.checks.length > 0) {
      for (const check of readiness.checks.filter((check) => !check.ok).slice(0, 3)) {
        reasons.push(`${check.name}: ${check.message}`);
      }
    }
    nextActions.push("Do not run autonomous paid calls until marketplace readiness is ready.");
  }

  if ((stats?.verifiedPayments ?? 0) <= 0) {
    reasons.push("No verified paid-call evidence is indexed for this listing yet.");
  }

  if (reliability?.paidTestObserved === false) {
    reasons.push("Marketplace reliability says no verified paid-test evidence is indexed for this listing yet.");
  }

  if (detail.trust) {
    if (detail.trust.listingPublished === false) {
      reasons.push("Listing is not published.");
    }
    if (detail.trust.merchantPublished === false) {
      reasons.push("Gateway merchant is not indexed.");
    }
    if (detail.trust.upstreamConfigured === false) {
      reasons.push("Protected upstream access is not configured.");
    }
  }

  const shouldAutoPay =
    api.status === "active" && Boolean(protectedUrl) && readiness?.ready === true && reliability?.paidTestObserved !== false;
  if (shouldAutoPay) {
    return {
      shouldAutoPay: true,
      level: "ready",
      summary: "Marketplace readiness is ready; agents may pay with their own wallet policy and max-spend limits.",
      reasons: [],
      nextActions: [
        `Run \`sui402-pay readiness --strict\` before paying.`,
        `Use \`sui402-pay curl ${protectedUrl} --max-one-shot-amount ${api.price}\` or a matching funded session.`
      ]
    };
  }

  const level: MarketplaceAgentSafety["level"] =
    api.status === "paused" || readiness?.level === "paused" ? "paused" : readiness ? "needs_review" : "unknown";

  return {
    shouldAutoPay: false,
    level,
    summary:
      level === "paused"
        ? "Listing is paused or readiness is paused; agents should not pay automatically."
        : "Marketplace readiness is not proven; agents should not pay automatically.",
    reasons: [...new Set(reasons)],
    nextActions:
      nextActions.length > 0
        ? [...new Set(nextActions)]
        : ["Inspect readiness reasons, scan merchant evidence, and wait for verified paid-test evidence before enabling autonomous payments."]
  };
}

function printHumanMarketplaceDetail(detail: MarketplaceDetailResponse, baseUrl: URL, agentSafety: MarketplaceAgentSafety): void {
  const api = detail.api;
  const stats = detail.stats ?? api.stats;
  const reliability = detail.reliability ?? api.reliability;

  console.log(`Sui402 marketplace API: ${baseUrl.toString()}`);
  console.log(`${api.id}  ${api.name}`);
  if (api.description) {
    console.log(api.description);
  }
  console.log("");
  console.log(`transport: ${api.transport}`);
  console.log(`network: ${api.network}`);
  console.log(`price: ${api.price} ${shortCoinType(api.coinType)}`);
  console.log(`resource: ${api.resourceScope}`);
  console.log(`merchant: ${api.merchant}`);
  console.log(`sessions: ${api.sessionSupported ? "yes" : "no"}`);
  console.log(`status: ${api.status}`);
  const readiness = detail.readiness ?? api.readiness;
  if (readiness) {
    console.log(`readiness: ${readiness.ready ? "ready" : readiness.level}`);
    if (readiness.reasons.length > 0) {
      console.log(`readiness reasons: ${readiness.reasons.join("; ")}`);
    }
  }
  if (api.tags && api.tags.length > 0) {
    console.log(`tags: ${api.tags.join(", ")}`);
  }
  if (stats) {
    console.log(`stats: ${stats.verifiedPayments ?? 0} verified, ${stats.sessionPayments ?? 0} session, volume ${stats.volume ?? "0"}`);
  }
  if (reliability) {
    console.log(
      `reliability: ${reliability.paidTestObserved ? "paid evidence observed" : "no paid evidence"}, ${
        reliability.recentIndexedPayments ?? 0
      } recent public record(s)`
    );
    if (reliability.lastVerifiedPaymentAt) {
      console.log(`last verified payment: ${reliability.lastVerifiedPaymentAt}`);
    }
  }

  console.log("");
  console.log("Agent safety");
  console.log(`  verdict: ${agentSafety.shouldAutoPay ? "ready for bounded paid calls" : "do not auto-pay"}`);
  console.log(`  level: ${agentSafety.level}`);
  console.log(`  summary: ${agentSafety.summary}`);
  if (agentSafety.reasons.length > 0) {
    console.log("  reasons:");
    for (const reason of agentSafety.reasons) {
      console.log(`    - ${reason}`);
    }
  }
  if (agentSafety.nextActions.length > 0) {
    console.log("  next actions:");
    for (const action of agentSafety.nextActions) {
      console.log(`    - ${action}`);
    }
  }

  if (detail.trust) {
    console.log("");
    console.log("Trust checks");
    console.log(`  listing published: ${detail.trust.listingPublished ? "yes" : "no"}`);
    console.log(`  merchant indexed: ${detail.trust.merchantPublished ? "yes" : "no"}`);
    console.log(`  protected access configured: ${detail.trust.upstreamConfigured ? "yes" : "no"}`);
    console.log(`  sessions enabled: ${detail.trust.sessionsEnabled ? "yes" : "no"}`);
  }

  console.log("");
  console.log("Agent commands");
  console.log(`  call: ${detail.commands?.curl ?? (api.protectedResourceUrl ? `sui402-pay curl ${api.protectedResourceUrl}` : `sui402-pay search ${api.name}`)}`);
  console.log(`  search: ${detail.commands?.search ?? `sui402-pay search ${api.name}`}`);
  console.log(`  scan: ${detail.commands?.scan ?? `sui402-pay scan merchant ${api.id}`}`);
  if (detail.commands?.sessionOnly) {
    console.log(`  session-only: ${detail.commands.sessionOnly}`);
  }
  if (detail.commands?.sessionInspect) {
    console.log(`  session inspect: ${detail.commands.sessionInspect}`);
  }

  const paymentPlan = detail.paymentPlan ?? api.paymentPlan;
  if (paymentPlan) {
    console.log("");
    console.log("Payment plan");
    console.log(`  custody: ${paymentPlan.custody ?? "user_owned"}`);
    console.log(`  authorization mode: ${paymentPlan.authorizationMode ?? "live_402_challenge_plus_local_policy"}`);
    console.log(`  network: ${paymentPlan.network ?? api.network}`);
    console.log(`  merchant: ${paymentPlan.merchant ?? api.merchant}`);
    console.log(`  coin: ${paymentPlan.coinType ?? api.coinType}`);
    console.log(`  amount: ${paymentPlan.amountAtomic ?? api.price}`);
    console.log(`  max one-shot: ${paymentPlan.maxOneShotAmount ?? api.price}`);
    console.log(`  resource: ${paymentPlan.resourceScope ?? api.resourceScope}`);
    console.log(`  session behavior: ${paymentPlan.sessionBehavior ?? (api.sessionSupported ? "session_first" : "capped_one_shot")}`);
    if (paymentPlan.notes && paymentPlan.notes.length > 0) {
      console.log("  notes:");
      for (const note of paymentPlan.notes.slice(0, 3)) {
        console.log(`    - ${note}`);
      }
    }
  }

  const protectedUrl = detail.links?.protectedResourceUrl ?? api.protectedResourceUrl;
  if (protectedUrl) {
    console.log(`protected URL: ${protectedUrl}`);
  }
  const sessionManagerUrl = detail.links?.sessionManagerUrl ?? api.sessionManagerUrl;
  if (sessionManagerUrl) {
    console.log(`session manager: ${sessionManagerUrl}`);
  }

  if (detail.recentPayments && detail.recentPayments.length > 0) {
    console.log("");
    console.log("Recent payments");
    for (const payment of detail.recentPayments.slice(0, 5)) {
      console.log(
        `  ${payment.digest ?? "unknown"}  ${payment.kind ?? "payment"}  ${payment.amount ?? "0"} ${
          payment.coinType ? shortCoinType(payment.coinType) : ""
        }  ${payment.resource ?? ""}`.trim()
      );
    }
  }
}

function printHumanScanStats(stats: unknown, baseUrl: URL): void {
  const summary = stats as {
    generatedAt?: string;
    totals?: Record<string, unknown>;
    networks?: Record<string, number>;
    transports?: Record<string, number>;
    coins?: Record<string, number>;
    volumeByCoin?: Record<string, string>;
  };

  console.log(`Sui402 scan: ${baseUrl.toString()}`);
  if (summary.generatedAt) {
    console.log(`Generated: ${summary.generatedAt}`);
  }
  console.log("");

  if (summary.totals) {
    console.log("Totals");
    for (const [key, value] of Object.entries(summary.totals)) {
      console.log(`  ${key}: ${String(value)}`);
    }
    console.log("");
  }

  printRecordSection("Networks", summary.networks);
  printRecordSection("Transports", summary.transports);
  printRecordSection("Coins", summary.coins);
  printRecordSection("Volume by coin", summary.volumeByCoin);
}

function printHumanScanPayment(record: unknown, baseUrl: URL): void {
  const payment = record as {
    id?: string;
    digest?: string;
    network?: string;
    kind?: string;
    merchantId?: string;
    recipient?: string;
    coinType?: string;
    amount?: string;
    resource?: string;
    createdAt?: string;
    sessionId?: string;
    receipt?: { id?: string; signer?: string; sequence?: string; expiresAt?: string };
  };

  console.log(`Sui402 scan payment: ${baseUrl.toString()}`);
  console.log(`digest: ${payment.digest ?? "unknown"}`);
  console.log(`network: ${payment.network ?? "unknown"}`);
  console.log(`kind: ${payment.kind ?? "unknown"}`);
  if (payment.merchantId) {
    console.log(`merchant id: ${payment.merchantId}`);
  }
  if (payment.recipient) {
    console.log(`recipient: ${payment.recipient}`);
  }
  if (payment.amount || payment.coinType) {
    console.log(`amount: ${payment.amount ?? "0"} ${payment.coinType ? shortCoinType(payment.coinType) : ""}`.trim());
  }
  if (payment.resource) {
    console.log(`resource: ${payment.resource}`);
  }
  if (payment.sessionId) {
    console.log(`session: ${payment.sessionId}`);
  }
  if (payment.receipt?.id) {
    console.log(`receipt: ${payment.receipt.id}`);
  }
  if (payment.createdAt) {
    console.log(`seen: ${payment.createdAt}`);
  }
}

function printHumanScanMerchant(record: unknown, baseUrl: URL): void {
  const page = record as {
    merchant?: {
      id?: string;
      service?: string;
      network?: string;
      merchant?: string;
      coinType?: string;
      price?: string;
      resourceScope?: string;
      sessionsEnabled?: boolean;
      status?: string;
    };
    listing?: {
      protectedResourceUrl?: string;
      sessionManagerUrl?: string;
      transport?: string;
      tags?: string[];
    };
    stats?: {
      verifiedPayments?: number;
      sessionPayments?: number;
      volume?: string;
    };
    recentPayments?: Array<{ digest?: string; amount?: string; kind?: string; resource?: string }>;
  };

  console.log(`Sui402 scan merchant: ${baseUrl.toString()}`);
  console.log(`${page.merchant?.id ?? "unknown"}  ${page.merchant?.service ?? "Unknown merchant"}`);
  if (page.merchant?.network) {
    console.log(`network: ${page.merchant.network}`);
  }
  if (page.merchant?.merchant) {
    console.log(`wallet: ${page.merchant.merchant}`);
  }
  if (page.merchant?.price || page.merchant?.coinType) {
    console.log(`price: ${page.merchant.price ?? "0"} ${page.merchant.coinType ? shortCoinType(page.merchant.coinType) : ""}`.trim());
  }
  if (page.merchant?.resourceScope) {
    console.log(`resource: ${page.merchant.resourceScope}`);
  }
  console.log(`sessions: ${page.merchant?.sessionsEnabled ? "yes" : "no"}`);
  if (page.listing?.protectedResourceUrl) {
    console.log(`call: sui402-pay curl ${page.listing.protectedResourceUrl}`);
  }
  if (page.listing?.sessionManagerUrl) {
    console.log(`session manager: ${page.listing.sessionManagerUrl}`);
  }
  if (page.stats) {
    console.log(
      `stats: ${page.stats.verifiedPayments ?? 0} verified, ${page.stats.sessionPayments ?? 0} session, volume ${
        page.stats.volume ?? "0"
      }`
    );
  }
  if (page.recentPayments && page.recentPayments.length > 0) {
    console.log("");
    console.log("Recent payments");
    for (const payment of page.recentPayments.slice(0, 5)) {
      console.log(`  ${payment.digest ?? "unknown"}  ${payment.kind ?? "payment"}  ${payment.amount ?? "0"}  ${payment.resource ?? ""}`.trim());
    }
  }
}

function printHumanScanSession(record: unknown, baseUrl: URL): void {
  const session = record as {
    sessionId?: string;
    network?: string;
    packageId?: string;
    coinType?: string;
    payer?: string;
    payerHash?: string;
    merchant?: string;
    spendCount?: number;
    spentAmount?: string;
    spentTotal?: string;
    resourceScopeHashes?: string[];
    firstSeenAt?: string;
    lastSeenAt?: string;
    lastTxDigest?: string;
    indexerProgress?: {
      cursor?: string;
      checkpoint?: string;
      eventOffset?: number;
      label?: string;
      updatedAt?: string;
    };
    spends?: Array<{ txDigest?: string; amount?: string; challengeId?: string; indexedAt?: string }>;
  };

  console.log(`Sui402 scan session: ${baseUrl.toString()}`);
  console.log(`session: ${session.sessionId ?? "unknown"}`);
  if (session.network) {
    console.log(`network: ${session.network}`);
  }
  if (session.payer) {
    console.log(`payer: ${session.payer}`);
  } else if (session.payerHash) {
    console.log(`payer hash: ${session.payerHash}`);
  }
  if (session.merchant) {
    console.log(`merchant: ${session.merchant}`);
  }
  if (session.spentAmount || session.coinType) {
    console.log(`spent: ${session.spentAmount ?? "0"} ${session.coinType ? shortCoinType(session.coinType) : ""}`.trim());
  }
  if (session.spentTotal) {
    console.log(`chain spent total: ${session.spentTotal}`);
  }
  console.log(`spends: ${session.spendCount ?? session.spends?.length ?? 0}`);
  if (session.lastTxDigest) {
    console.log(`last tx: ${session.lastTxDigest}`);
  }
  if (session.resourceScopeHashes && session.resourceScopeHashes.length > 0) {
    console.log(`resource hashes: ${session.resourceScopeHashes.slice(0, 3).join(", ")}`);
  }
  if (session.firstSeenAt || session.lastSeenAt) {
    console.log(`seen: ${session.firstSeenAt ?? "unknown"} -> ${session.lastSeenAt ?? "unknown"}`);
  }
  printHumanIndexerProgress(session.indexerProgress);
  if (session.spends && session.spends.length > 0) {
    console.log("");
    console.log("Recent spends");
    for (const spend of session.spends.slice(0, 5)) {
      console.log(`  ${spend.txDigest ?? "unknown"}  ${spend.amount ?? "0"}  ${spend.challengeId ?? ""}`.trim());
    }
  }
}

function printHumanScanSettlement(record: unknown, baseUrl: URL): void {
  const settlement = record as {
    id?: string;
    network?: string;
    txDigest?: string;
    kind?: string;
    ledgerId?: string;
    receiptId?: string;
    payer?: string;
    merchant?: string;
    signer?: string;
    amount?: string;
    sequence?: string;
    submitter?: string;
    receiptCount?: string;
    totalAmount?: string;
    resourceScopeHash?: string;
    indexedAt?: string;
    indexerProgress?: {
      cursor?: string;
      checkpoint?: string;
      eventOffset?: number;
      label?: string;
      updatedAt?: string;
    };
  };

  console.log(`Sui402 scan settlement: ${baseUrl.toString()}`);
  console.log(`id: ${settlement.id ?? "unknown"}`);
  if (settlement.txDigest) {
    console.log(`tx: ${settlement.txDigest}`);
  }
  if (settlement.network) {
    console.log(`network: ${settlement.network}`);
  }
  if (settlement.kind) {
    console.log(`kind: ${settlement.kind}`);
  }
  if (settlement.ledgerId) {
    console.log(`ledger: ${settlement.ledgerId}`);
  }
  if (settlement.receiptId) {
    console.log(`receipt: ${settlement.receiptId}`);
  }
  if (settlement.merchant) {
    console.log(`merchant: ${settlement.merchant}`);
  }
  if (settlement.payer) {
    console.log(`payer: ${settlement.payer}`);
  }
  if (settlement.amount || settlement.totalAmount) {
    console.log(`amount: ${settlement.amount ?? settlement.totalAmount}`);
  }
  if (settlement.receiptCount) {
    console.log(`receipt count: ${settlement.receiptCount}`);
  }
  if (settlement.submitter) {
    console.log(`submitter: ${settlement.submitter}`);
  }
  if (settlement.resourceScopeHash) {
    console.log(`resource hash: ${settlement.resourceScopeHash}`);
  }
  if (settlement.indexedAt) {
    console.log(`indexed: ${settlement.indexedAt}`);
  }
  printHumanIndexerProgress(settlement.indexerProgress);
}

function printHumanIndexerProgress(progress: {
  cursor?: string;
  checkpoint?: string;
  eventOffset?: number;
  label?: string;
  updatedAt?: string;
} | undefined): void {
  if (!progress) {
    return;
  }

  if (progress.cursor) {
    console.log(`indexer cursor: ${progress.cursor}`);
  }
  if (progress.checkpoint) {
    console.log(`checkpoint: ${progress.checkpoint}`);
  }
  if (progress.eventOffset !== undefined) {
    console.log(`event offset: ${progress.eventOffset}`);
  }
  if (progress.label) {
    console.log(`cursor label: ${progress.label}`);
  }
  if (progress.updatedAt) {
    console.log(`cursor updated: ${progress.updatedAt}`);
  }
}

function printRecordSection(title: string, record: Record<string, unknown> | undefined): void {
  if (!record || Object.keys(record).length === 0) {
    return;
  }

  console.log(title);
  for (const [key, value] of Object.entries(record)) {
    console.log(`  ${key}: ${String(value)}`);
  }
  console.log("");
}

function shortCoinType(coinType: string): string {
  return coinType.split("::").at(-1) ?? coinType;
}

function printWalletStatus(status: WalletStatus): void {
  console.log("Sui402 wallet");
  console.log(`custody: ${status.custody}`);
  console.log(`network: ${status.network}`);
  console.log(`gRPC: ${status.grpcUrl} (${status.grpcUrlSource})`);
  console.log(`signer: ${status.signerConfigured ? status.signerSource : "not configured"}`);
  if (status.signerPath) {
    console.log(`signer path: ${status.signerPath}`);
  }
  if (status.address) {
    console.log(`address: ${status.address}`);
  }
  console.log(`session package: ${status.sessionPackageId ?? "not configured"}`);
  console.log(`marketplace: ${status.marketplaceUrl ?? "not configured"}`);
  console.log(`balance check: ${status.balanceCheck}`);
  if (status.balance) {
    console.log(
      `SUI balance: ${status.balance.balance} MIST ` +
        `(coins ${status.balance.coinBalance}, address balance ${status.balance.addressBalance})`
    );
  }
  console.log("funding:");
  console.log(`  purpose: ${status.funding.purpose}`);
  console.log(`  summary: ${status.funding.summary}`);
  for (const action of status.funding.actions) {
    const target = action.url ?? action.command;
    console.log(`  - ${action.label}${target ? `: ${target}` : ""}`);
    console.log(`    ${action.note}`);
  }
  console.log("");
  console.log(`readiness: ${status.readiness.level}`);
  console.log(`ready for paid calls: ${status.readiness.readyForPaidCalls ? "yes" : "no"}`);
  console.log(`summary: ${status.readiness.summary}`);
  if (status.readiness.checks.length > 0) {
    console.log("checks:");
    for (const check of status.readiness.checks) {
      console.log(`  - ${check.ok ? "ok" : "todo"} ${check.name}: ${check.message}`);
    }
  }
  if (status.readiness.nextActions.length > 0) {
    console.log("next actions:");
    for (const action of status.readiness.nextActions) {
      console.log(`  - ${action}`);
    }
  }
  if (status.warnings.length > 0) {
    console.log("");
    console.log("Warnings");
    for (const warning of status.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  if (status.errors.length > 0) {
    console.log("");
    console.log("Errors");
    for (const error of status.errors) {
      console.log(`  - ${error}`);
    }
  }
}

function printSetup(): void {
  console.log(`Sui402 wallet setup is non-custodial.

Choose one local wallet mode:

1. Sui private key
   export SUI_SECRET_KEY=suiprivkey...

2. Sui mnemonic
   export SUI_MNEMONIC="word word word ..."

3. Existing Sui CLI wallet
   sui client active-address
   # optional override when you have multiple local addresses:
   export SUI_ADDRESS=0x...

Optional:
   export SUI402_NETWORK=sui:testnet
   export SUI_GRPC_URL=https://fullnode.testnet.sui.io:443
   export SUI_KEYSTORE_PATH=/path/to/sui.keystore
   export SUI_CLIENT_CONFIG=/path/to/client.yaml
   export SUI402_SESSION_PACKAGE_ID=0x...

Then verify:
   sui402-pay readiness
   sui402-pay readiness --strict --json
   sui402-pay wallet
   sui402-pay wallet --human
   sui402-pay wallet --balance

The readiness/wallet views print a verdict, checks, and next actions. For
Testnet gas it points to https://faucet.sui.io instead of suggesting the Devnet/
Localnet-only sui client faucet path.

Create a non-secret agent profile:
   sui402-pay setup --print-env --marketplace-url https://console.example.com
   sui402-pay setup --write-env .sui402/agent.env --marketplace-url https://console.example.com

Inspect user-owned payment sessions:
   sui402-pay session inspect
   sui402-pay session inspect --resource https://api.example.com/weather --merchant 0x... --amount 1000

Discover paid APIs:
   export SUI402_MARKETPLACE_URL=https://console.example.com
   sui402-pay search weather
   sui402-pay scan stats

Call a paid API:
   sui402-pay curl https://gateway.example.com/gateway/merchants/weather/pay?q=sf --session-only
   sui402-pay curl https://gateway.example.com/gateway/merchants/weather/pay?q=sf --max-one-shot-amount 1000

Session behavior:
   - session inspect is read-only and scans your owned AgentPaymentSession objects over Sui gRPC
    - curl uses a matching owned session first when SUI402_SESSION_PACKAGE_ID is set
    - if no usable session exists, curl can fall back to a one-shot Sui payment
      only when SUI402_MAX_ONE_SHOT_AMOUNT or --max-one-shot-amount sets a cap
    - use --session-only to fail closed instead of falling back to one-shot
    - use --max-one-shot-amount to enable and cap fallback one-shot spend in atomic units

This CLI signs locally. Sui402 does not custody payer funds or receive your private key.`);
}

function printWalletHelp(): void {
  console.log(`sui402-pay wallet

Usage:
  sui402-pay wallet [--json] [--human] [--balance]
  sui402-pay readiness [--json] [--human] [--balance] [--strict]
  sui402-pay setup --check [--json] [--balance]
  sui402-pay setup --print-env [options]
  sui402-pay setup --write-env PATH [options]

Options:
  --json       print machine-readable wallet readiness (default for wallet)
  --human      print human-readable wallet readiness
  --balance    query Sui gRPC for the local wallet's SUI gas balance
  --no-balance skip the Sui gRPC balance query
  --strict     for readiness, exit non-zero when paid-call readiness is not ready
  --print-env  print a non-secret env profile for agents
  --write-env  write the non-secret env profile to PATH
  --force      allow --write-env to overwrite PATH

Environment:
  SUI_SECRET_KEY or SUI_MNEMONIC   user-owned local signer; explicit env wins
  SUI_KEYSTORE_PATH               optional Sui CLI keystore override
  SUI_CLIENT_CONFIG               optional Sui CLI client.yaml override
  SUI_ADDRESS                     optional address selector for Sui CLI keystore
  SUI402_NETWORK                  sui:testnet | sui:mainnet | sui:devnet | sui:localnet
  SUI_GRPC_URL                    optional custom Sui gRPC URL
  SUI402_SESSION_PACKAGE_ID       optional session-first payments
  SUI402_MARKETPLACE_URL          marketplace/console URL for search and scan

The command never prints or writes private keys. It reports only derived address,
configuration readiness, gas-check status, and next actions. Setup profile files
intentionally exclude signer secrets; keep keys in the Sui CLI wallet or your
own secret manager.`);
}

function printReadinessHelp(): void {
  console.log(`sui402-pay readiness

Usage:
  sui402-pay readiness [--human] [--json] [--balance] [--no-balance] [--strict]
  sui402-pay ready [options]

Options:
  --human      print human-readable wallet readiness (default)
  --json       print machine-readable wallet readiness
  --balance    query Sui gRPC for SUI gas balance (default)
  --no-balance only inspect local config; do not query Sui gRPC
  --strict     exit non-zero when signer/gas readiness is not ready

This is a non-custodial preflight: it derives the local address from
SUI_SECRET_KEY, SUI_MNEMONIC, or the Sui CLI keystore, but never prints or writes
signer secrets. Unlike \`wallet\`, it reports missing-wallet blockers instead of
failing before printing the readiness checklist.`);
}

function printSessionSetup(): void {
  console.log(`Sui402 session setup is non-custodial.

Sessions are user-owned Sui objects. This CLI can inspect and spend matching
sessions locally; it does not custody funds and does not upload private keys.

Required:
   export SUI402_SESSION_PACKAGE_ID=0x...
   export SUI402_NETWORK=sui:testnet

Signer, only needed when --owner is omitted or when paying:
   export SUI_SECRET_KEY=suiprivkey...
   # or
   export SUI_MNEMONIC="word word word ..."

Inspect sessions:
   sui402-pay session inspect
   sui402-pay session inspect --owner 0x... --json
   sui402-pay session inspect --resource https://api.example.com/weather --merchant 0x... --amount 1000

Open/fund/close sessions:
   sui402-pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000
   sui402-pay session fund --package-id 0x... --session-id 0x... --funding 10000
   sui402-pay session close --package-id 0x... --session-id 0x...

These commands print a plan first. Add --yes to submit the transaction.

Pay with session-first behavior:
   sui402-pay curl https://api.example.com/weather
   sui402-pay curl https://api.example.com/weather --session-only
   sui402-pay curl https://api.example.com/weather --max-one-shot-amount 1000

If no owned session matches the merchant, resource scope, coin type, balance,
max_per_request, and expiry checks, curl falls back to a one-shot payment unless
--session-only is set. Use --max-one-shot-amount to cap fallback one-shot spend.`);
}

function printSessionHelp(): void {
  console.log(`sui402-pay session

Usage:
  sui402-pay session setup
  sui402-pay session inspect [options]
  sui402-pay session open [options]
  sui402-pay session fund [options]
  sui402-pay session close [options]

Inspect options:
  --owner ADDRESS              inspect this owner; avoids loading a local signer
  --package-id ID              session package id; defaults to SUI402_SESSION_PACKAGE_ID
  --coin-type TYPE             filter by coin type
  --merchant ADDRESS           filter by merchant and check readiness
  --resource RESOURCE          derive and check resource scope hash
  --resource-scope-hash HASH   filter by an existing resource scope hash
  --amount ATOMIC              check balance and max_per_request in atomic units
  --limit N                    max matching sessions to print (default ${DEFAULT_SESSION_LIMIT})
  --max-pages N                max owned-object pages to scan (default ${DEFAULT_SESSION_MAX_PAGES})
  --json                       print machine-readable output

Mutation options:
  --package-id ID              session package id; defaults to SUI402_SESSION_PACKAGE_ID
  --coin-type TYPE             coin type; defaults to 0x2::sui::SUI
  --merchant ADDRESS           merchant address for session open
  --resource RESOURCE          resource scope string for session open
  --resource-scope-hash HASH   precomputed resource scope hash for session open
  --max-per-request ATOMIC     max spend per request for session open
  --funding ATOMIC             SUI funding amount in atomic units
  --coin-object-id ID          non-SUI funding coin object id
  --expires-ms MS              absolute expiry timestamp for session open
  --ttl-ms MS                  relative expiry from now for session open (default 86400000)
  --session-id ID              session object id for fund/close
  --yes, -y                    submit the transaction; without this, only prints a plan
  --json                       print machine-readable plan/result

Examples:
  sui402-pay session inspect
  sui402-pay session inspect --owner 0x... --json
  sui402-pay session inspect --resource https://api.example.com/weather --merchant 0x... --amount 1000
  sui402-pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000
  sui402-pay session open --package-id 0x... --merchant 0x... --resource https://api.example.com/weather --max-per-request 1000 --funding 10000 --yes
  sui402-pay session fund --package-id 0x... --session-id 0x... --funding 10000
  sui402-pay session close --package-id 0x... --session-id 0x...
`);
}

function printSearchHelp(): void {
  console.log(`sui402-pay search

Usage:
  sui402-pay search [query] [options]
  sui402-pay marketplace detail <api-id> [options]

Options:
  --marketplace-url URL   console/marketplace base URL; defaults to SUI402_MARKETPLACE_URL or SUI402_CONSOLE_API_URL
  --network NETWORK       filter: sui:mainnet | sui:testnet | sui:devnet | sui:localnet
  --transport KIND        filter: http | mcp
  --tag TAG               filter by marketplace tag
  --limit N               max API cards to return (default ${DEFAULT_MARKETPLACE_LIMIT}, max ${MAX_MARKETPLACE_LIMIT})
  --json                  print machine-readable output

Examples:
  sui402-pay search weather
  sui402-pay marketplace detail atlas-api
  sui402-pay search image --network sui:mainnet --json
  sui402-pay search --tag mcp --transport mcp
`);
}

function printScanHelp(): void {
  console.log(`sui402-pay scan

Usage:
  sui402-pay scan stats [options]
  sui402-pay scan payment <digest> [options]
  sui402-pay scan merchant <id> [options]
  sui402-pay scan session <id> [options]
  sui402-pay scan settlement <id|digest|ledger|receipt> [options]

Options:
  --marketplace-url URL   console/marketplace base URL; defaults to SUI402_MARKETPLACE_URL or SUI402_CONSOLE_API_URL
  --json                  print machine-readable output

Examples:
  sui402-pay scan stats
  sui402-pay scan stats --marketplace-url https://console.example.com --json
  sui402-pay scan payment digest-atlas-1
  sui402-pay scan merchant atlas-api --json
  sui402-pay scan session 0x...
  sui402-pay scan settlement settlement-digest-1
`);
}

function printHelp(): void {
  console.log(`sui402-pay ${VERSION}

Usage:
  sui402-pay init
  sui402-pay setup
  sui402-pay readiness [--strict] [--json]
  sui402-pay setup --check [--json] [--balance]
  sui402-pay setup --print-env [--marketplace-url URL]
  sui402-pay setup --write-env .sui402/agent.env [--marketplace-url URL] [--force]
  sui402-pay wallet
  sui402-pay wallet --human [--balance]
  sui402-pay search [query] [options]
  sui402-pay marketplace detail <api-id> [options]
  sui402-pay scan stats [options]
  sui402-pay scan payment <digest> [options]
  sui402-pay scan merchant <id> [options]
  sui402-pay scan session <id> [options]
  sui402-pay scan settlement <id|digest|ledger|receipt> [options]
  sui402-pay session setup
  sui402-pay session inspect [options]
  sui402-pay session open [options]
  sui402-pay session fund [options]
  sui402-pay session close [options]
  sui402-pay curl <url> [-X METHOD] [-H "Name: value"] [--body data] [--session-only] [--max-one-shot-amount ATOMIC]

Environment:
  SUI_SECRET_KEY or SUI_MNEMONIC   user-owned Sui wallet signer
  SUI_KEYSTORE_PATH / SUI_CLIENT_CONFIG optional Sui CLI wallet discovery overrides
  SUI_ADDRESS                     optional address selector for Sui CLI keystore
  SUI402_NETWORK                  sui:testnet | sui:mainnet | sui:devnet | sui:localnet
  SUI_GRPC_URL                    optional custom Sui gRPC URL
  SUI402_SESSION_PACKAGE_ID       optional session-first payments
   SUI402_MAX_ONE_SHOT_AMOUNT      enables and caps fallback one-shot spend in atomic units
  SUI402_MARKETPLACE_URL          optional marketplace/console URL for search and scan
  SUI402_CONSOLE_API_URL          fallback marketplace/console URL

Run "sui402-pay readiness --help" for preflight options.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
