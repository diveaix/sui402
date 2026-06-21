#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const envFile = args.envFile ?? process.env.SUI402_REHEARSAL_ENV_FILE;
const loadedEnvKeys = [];

if (envFile) {
  loadEnvFile(resolve(root, envFile));
}

const now = new Date();
const date = now.toISOString().slice(0, 10);
const defaultOut = resolve(root, `docs/runbooks/testnet-rehearsal-evidence-${date}.md`);
const outPath = args.out ? resolve(root, args.out) : defaultOut;
const published = readPublishedTestnetPackage();
const consoleState = readConsoleState();
const evidence = buildEvidenceMarkdown({
  generatedAt: now.toISOString(),
  envFile: envFile ? relativeToRoot(resolve(root, envFile)) : "not provided",
  loadedEnvKeys,
  published,
  consoleState
});

if (args.stdout || args.dryRun) {
  process.stdout.write(evidence);
  if (!evidence.endsWith("\n")) {
    process.stdout.write("\n");
  }
} else {
  if (existsSync(outPath) && !args.force) {
    console.error(`${relativeToRoot(outPath)} already exists. Re-run with --force or choose --out <path>.`);
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, evidence);
  console.log(`Created ${relativeToRoot(outPath)}`);
}

function buildEvidenceMarkdown({ generatedAt, envFile, loadedEnvKeys, published, consoleState }) {
  const commands = {
    node: run("node", ["--version"]),
    npm: run("npm", ["--version"]),
    suiVersion: run("sui", ["--version"]),
    suiActiveEnv: run("sui", ["client", "active-env"]),
    suiActiveAddress: run("sui", ["client", "active-address"]),
    suiBalance: run("sui", ["client", "balance"])
  };

  const latestPayment = latest(consoleState?.payments, "createdAt");
  const latestReceipt = latestPayment?.receipt?.receipt;
  const latestReceiptSigner = latestPayment?.receipt?.signer;
  const latestSpend = latest(consoleState?.sessionSpends, "indexedAt");
  const latestSettlement = latest(consoleState?.settlementEvents, "indexedAt");
  const latestCursor = latest(consoleState?.indexerCursors, "updatedAt");
  const paymentLedgerExport = latest(
    consoleState?.exports?.filter((item) => item.kind === "payment-ledger"),
    "createdAt"
  );
  const receiptBundleExport = latest(
    consoleState?.exports?.filter((item) => item.kind === "receipt-bundle"),
    "createdAt"
  );

  const serviceRows = [
    ["network", env("SUI402_NETWORK")],
    ["Sui gRPC URL", env("SUI_GRPC_URL") ?? env("SUI402_GRPC_URL") ?? env("SUI402_INDEXER_GRPC_URL")],
    ["console base URL", env("SUI402_CONSOLE_PROVIDER_BASE_URL") ?? env("SUI402_INDEXER_CONSOLE_URL") ?? "http://127.0.0.1:4030"],
    ["provider base URL", env("SUI402_PROVIDER_BASE_URL") ?? "TODO"],
    ["dashboard URL", env("SUI402_DASHBOARD_URL") ?? "TODO"],
    ["dashboard console API URL", env("VITE_SUI402_CONSOLE_API_URL")],
    ["session endpoint", env("SUI402_SESSION_ENDPOINT")],
    ["payment endpoint", env("SUI402_PAYMENT_ENDPOINT")],
    ["Walrus publisher URL", env("SUI402_WALRUS_PUBLISHER_URL")],
    ["Walrus aggregator URL", env("SUI402_WALRUS_AGGREGATOR_URL")]
  ];

  return `# Testnet Rehearsal Evidence - ${date}

Generated: ${generatedAt}  
Environment file: ${envFile}  
Loaded defaults: ${loadedEnvKeys.length === 0 ? "none" : loadedEnvKeys.join(", ")}

## Operator Summary

- Result: TODO: pass/fail
- Rehearsal window: TODO: start/end time and timezone
- Operator(s): TODO
- Notes link: TODO

## Preflight Snapshot

| Check | Evidence |
| --- | --- |
| Node.js version | ${cell(commands.node)} |
| npm version | ${cell(commands.npm)} |
| Sui CLI version | ${cell(commands.suiVersion)} |
| Sui active env | ${cell(commands.suiActiveEnv)} |
| Sui active address | ${cell(commands.suiActiveAddress)} |
| Sui balance | ${cell(multiline(commands.suiBalance))} |

Expected Sui active env: \`testnet\`.

## Package And Service Configuration

| Field | Value |
| --- | --- |
| session package id | ${cell(env("SUI402_SESSION_PACKAGE_ID") ?? published?.publishedAt)} |
| settlement package id | ${cell(env("SUI402_SETTLEMENT_PACKAGE_ID") ?? env("SUI402_SESSION_PACKAGE_ID") ?? published?.publishedAt)} |
| Published.toml published-at | ${cell(published?.publishedAt)} |
| Published.toml original-id | ${cell(published?.originalId)} |
| merchant address | ${cell(env("SUI402_MERCHANT_ADDRESS"))} |
| coin type | ${cell(env("SUI402_COIN_TYPE"))} |
| price | ${cell(env("SUI402_PRICE"))} |
| resource scope | ${cell(env("SUI402_RESOURCE_SCOPE"))} |
${serviceRows.map(([name, value]) => `| ${name} | ${cell(redactUrl(value))} |`).join("\n")}

## Session Payment Evidence

| Field | Value |
| --- | --- |
| session id | ${cell(latestSpend?.sessionId ?? latestPayment?.proof?.sessionId)} |
| session open tx digest | TODO |
| session spend tx digest | ${cell(latestSpend?.txDigest ?? latestPayment?.proof?.txDigest)} |
| session close tx digest | TODO, if closed |
| HTTP retry response | TODO: status/body snippet |
| payment record id | ${cell(latestPayment?.id)} |
| challenge id | ${cell(latestPayment?.challenge?.id ?? latestSpend?.challengeId)} |

## Receipt Evidence

| Field | Value |
| --- | --- |
| receipt id | ${cell(env("SUI402_RECEIPT_ID") ?? latestReceipt?.id)} |
| signer address | ${cell(env("SUI402_RECEIPT_SIGNER_ADDRESS") ?? latestReceiptSigner ?? env("SUI402_RECEIPT_SIGNER_ID"))} |
| payer | ${cell(latestReceipt?.payer ?? latestSettlement?.payer)} |
| merchant | ${cell(latestReceipt?.merchant ?? latestSettlement?.merchant ?? env("SUI402_MERCHANT_ADDRESS"))} |
| amount | ${cell(env("SUI402_RECEIPT_AMOUNT") ?? latestReceipt?.amount ?? latestSettlement?.amount)} |
| sequence | ${cell(env("SUI402_RECEIPT_SEQUENCE") ?? latestReceipt?.sequence ?? latestSettlement?.sequence)} |
| receipt issued at | ${cell(latestReceipt?.issuedAt)} |

## Settlement Ledger Evidence

| Field | Value |
| --- | --- |
| settlement ledger id | ${cell(env("SUI402_SETTLEMENT_LEDGER_ID") ?? latestSettlement?.ledgerId)} |
| create-ledger tx digest | TODO |
| settlement tx digest | ${cell(latestSettlement?.txDigest)} |
| settled receipt id | ${cell(latestSettlement?.receiptId ?? env("SUI402_RECEIPT_ID") ?? latestReceipt?.id)} |
| inspect-ledger result | TODO: paste \`npm run settlement:inspect-ledger\` summary |

## Indexer Evidence

| Field | Value |
| --- | --- |
| source | ${cell(env("SUI402_INDEXER_SOURCE"))} |
| sink | ${cell(env("SUI402_INDEXER_SINK"))} |
| package id | ${cell(env("SUI402_INDEXER_PACKAGE_ID") ?? env("SUI402_SETTLEMENT_PACKAGE_ID") ?? env("SUI402_SESSION_PACKAGE_ID"))} |
| start checkpoint | ${cell(env("SUI402_INDEXER_GRPC_START_CHECKPOINT"))} |
| cursor key | ${cell(latestCursor?.key)} |
| cursor value | ${cell(latestCursor?.cursor)} |
| cursor updated at | ${cell(latestCursor?.updatedAt)} |
| indexed settlement result | ${cell(formatSettlement(latestSettlement))} |

## Reconciliation Evidence

| Moment | Evidence |
| --- | --- |
| before settlement | TODO: paste \`GET /v1/settlement-reconciliation?limit=20\` summary |
| after settlement | TODO: paste \`GET /v1/settlement-reconciliation?limit=20\` summary |
| dashboard status | TODO: settled/unsettled/exception counts visible in dashboard |

## Walrus Evidence

| Export | Blob ID | Object ID | Created At |
| --- | --- | --- | --- |
| payment ledger | ${cell(paymentLedgerExport?.blobId)} | ${cell(paymentLedgerExport?.objectId)} | ${cell(paymentLedgerExport?.createdAt)} |
| receipt bundle | ${cell(receiptBundleExport?.blobId)} | ${cell(receiptBundleExport?.objectId)} | ${cell(receiptBundleExport?.createdAt)} |

## Failures And Fixes

| Time | Failure | Cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO |

## Commands Run

\`\`\`powershell
npm run rehearsal:check -- --env-file ${envFile === "not provided" ? ".env.testnet-rehearsal" : envFile}
npm run session:demo
npm run settlement:create-ledger
npm run rehearsal:receipt-env
npm run settlement:settle-receipt
npm run indexer:sync -- --max-pages 5 --grpc-max-checkpoints-per-page 25
npm run rehearsal:evidence -- --env-file ${envFile === "not provided" ? ".env.testnet-rehearsal" : envFile}
\`\`\`
`;
}

function readConsoleState() {
  const configuredPath = env("SUI402_CONSOLE_FILE_STORE_PATH") ?? ".sui402/testnet-rehearsal-console-store.json";
  const path = resolve(root, configuredPath);
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readPublishedTestnetPackage() {
  const path = resolve(root, "move/sui402_sessions/Published.toml");
  if (!existsSync(path)) {
    return undefined;
  }

  const text = readFileSync(path, "utf8");
  const section = text.match(/\[published\.testnet\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (!section) {
    return undefined;
  }

  return {
    publishedAt: section.match(/published-at\s*=\s*"([^"]+)"/)?.[1],
    originalId: section.match(/original-id\s*=\s*"([^"]+)"/)?.[1]
  };
}

function latest(items, dateKey) {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left?.[dateKey] ?? "");
    const rightTime = Date.parse(right?.[dateKey] ?? "");
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  })[0];
}

function formatSettlement(record) {
  if (!record) {
    return undefined;
  }

  return `${record.kind ?? "settlement"} ${record.txDigest ?? "unknown tx"} receipt=${record.receiptId ?? "n/a"} ledger=${record.ledgerId ?? "n/a"}`;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: true
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return output ? `FAILED: ${output}` : "FAILED";
  }

  return output || "no output";
}

function cell(value) {
  const normalized = value === undefined || value === null || value === "" ? "TODO" : String(value);
  return normalized.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function multiline(value) {
  return String(value ?? "").split(/\r?\n/).slice(0, 5).join("\n");
}

function env(key) {
  return process.env[key];
}

function redactUrl(value) {
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function relativeToRoot(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replaceAll("\\", "/") : path;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    force: false,
    stdout: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      parsed.envFile = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--env-file=")) {
      parsed.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--out") {
      parsed.out = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--stdout") {
      parsed.stdout = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/create-rehearsal-evidence.mjs [options]

Creates a dated Testnet rehearsal evidence markdown template.

Options:
  --env-file <path>  Load defaults from an env file without overriding current env.
  --out <path>       Output path. Defaults to docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md.
  --force            Overwrite the output path if it already exists.
  --stdout           Print the template instead of writing a file.
  --dry-run          Alias for --stdout.
  --help             Show this help.
`);
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    console.error(`Env file missing: ${relativeToRoot(path)}`);
    process.exit(1);
  }

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (process.env[key]) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
    loadedEnvKeys.push(key);
  }
}
