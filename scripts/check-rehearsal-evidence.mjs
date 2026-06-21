#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const evidencePath = args.file === "-" ? "-" : args.file ? resolve(root, args.file) : findLatestEvidenceFile();
const checks = [];

if (!evidencePath) {
  fail("evidence file", "no docs/runbooks/testnet-rehearsal-evidence-*.md file found; pass --file <path>");
} else if (evidencePath === "-") {
  const text = readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  checkEvidenceText(text, "stdin");
} else if (!existsSync(evidencePath)) {
  fail("evidence file", `${evidencePath} does not exist`);
} else {
  const text = readFileSync(evidencePath, "utf8").replace(/^\uFEFF/, "");
  checkEvidenceText(text, relativeToRoot(evidencePath));
}

for (const check of checks) {
  if (!args.json) {
    console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.details}`);
  }
}

const failures = checks.filter((check) => !check.ok);
if (args.json) {
  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        file: evidencePath ? relativeToRoot(evidencePath) : undefined,
        checks
      },
      null,
      2
    )
  );
}

if (failures.length > 0) {
  if (!args.json) {
    console.error(`\n${failures.length} rehearsal evidence check(s) failed.`);
  }
  process.exit(1);
}

if (!args.json) {
  console.log("\nRehearsal evidence checks passed.");
}

function parseArgs(argv) {
  const parsed = {
    requireDashboard: false,
    requireWalrus: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      parsed.file = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--file=")) {
      parsed.file = arg.slice("--file=".length);
    } else if (arg === "--require-dashboard") {
      parsed.requireDashboard = true;
    } else if (arg === "--require-walrus") {
      parsed.requireWalrus = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail("argument", `unsupported argument: ${arg}`);
    }
  }

  return parsed;
}

function checkEvidenceText(text, sourceLabel) {
  const rows = parseMarkdownRows(text);
  pass("evidence file", sourceLabel);

  requireText(text, "operator result", /-\s*Result:\s*PASS\b/i, "Operator Summary must explicitly say PASS");
  requireText(text, "rehearsal window", /-\s*Rehearsal window:\s*(?!TODO\b).{16,}/i, "Rehearsal window must be concrete");
  requireText(text, "operator", /-\s*Operator\(s\):\s*(?!TODO\b).{3,}/i, "Operator(s) must be recorded");

  requireRow(rows, "Sui active env", (value) => /\btestnet\b/i.test(value), "must be testnet");
  requireRow(rows, "Sui active address", isSuiAddress, "must be a 32-byte Sui address");
  requireRow(rows, "Sui balance", isConcrete, "must show funded balance evidence or a concrete funding note");

  requireRow(rows, "session package id", isSuiAddress, "must be a pinned testnet package id");
  requireRow(rows, "Published.toml published-at", isSuiAddress, "must match published testnet metadata");
  requireRow(rows, "merchant address", isNonZeroSuiAddress, "must be a non-zero Sui address");
  requireRow(rows, "coin type", isConcrete, "must be set");
  requireRow(rows, "price", isPositiveInteger, "must be a positive integer");
  requireRow(rows, "resource scope", isConcrete, "must be set");
  requireRow(rows, "network", (value) => value === "sui:testnet", "must be sui:testnet");

  requireRow(rows, "session id", isSuiAddress, "must be the paid session object id");
  requireRow(rows, "session open tx digest", isSuiDigest, "must be a Sui transaction digest");
  requireRow(rows, "session spend tx digest", isSuiDigest, "must be a Sui transaction digest");
  requireRow(rows, "HTTP retry response", (value) => /status\s*200/i.test(value), "must prove retry returned HTTP 200");
  requireRow(rows, "payment record id", isConcrete, "must identify the console payment record");
  requireRow(rows, "challenge id", isHexLike, "must identify the paid challenge");

  requireRow(rows, "receipt id", isHexLike, "must identify the signed receipt");
  requireRow(rows, "signer address", isSuiAddress, "must be the receipt signer Sui address");
  requireRow(rows, "payer", isSuiAddress, "must identify payer address used in the receipt");
  requireRow(rows, "merchant", isNonZeroSuiAddress, "must identify merchant address used in the receipt");
  requireRow(rows, "amount", isPositiveInteger, "must be a positive integer");
  requireRow(rows, "sequence", isPositiveInteger, "must be a positive integer");
  requireRow(rows, "receipt issued at", isIsoDateish, "must be timestamped");

  requireRow(rows, "settlement ledger id", isSuiAddress, "must identify the settlement ledger object");
  requireRow(rows, "create-ledger tx digest", isSuiDigest, "must be a Sui transaction digest");
  requireRow(rows, "settlement tx digest", isSuiDigest, "must be a Sui transaction digest");
  requireRow(rows, "settled receipt id", isHexLike, "must identify the settled receipt");
  requireRow(rows, "inspect-ledger result", hasSettlementLedgerSummary, "must include receiptCount and totalAmount");

  requireRow(rows, "source", isConcrete, "must identify indexer source");
  requireRow(rows, "sink", isConcrete, "must identify indexer sink");
  requireRow(rows, "package id", isSuiAddress, "must identify indexed package id");
  requireRow(rows, "start checkpoint", isNonNegativeInteger, "must identify the indexer start checkpoint");
  requireRow(rows, "cursor key", (value) => value.includes("settlement:") && value.includes("0x2::sui::SUI"), "must be the settlement cursor key");
  requireRow(rows, "cursor value", isCheckpointCursor, "must be a checkpoint cursor like 349913688:0");
  requireRow(rows, "cursor updated at", isIsoDateish, "must be timestamped");
  requireRow(rows, "indexed settlement result", (value) => isConcrete(value) && /receipt|batch/i.test(value), "must summarize indexed settlement");

  requireRow(rows, "before settlement", hasBeforeSettlementSummary, "must prove one unsettled receipt before settlement");
  requireRow(rows, "after settlement", hasAfterSettlementSummary, "must prove settlement reconciled cleanly");

  requireCommand(text, "npm run rehearsal:check");
  requireCommand(text, "npm run session:demo");
  requireCommand(text, "npm run settlement:create-ledger");
  requireCommand(text, "npm run settlement:settle-receipt");
  requireCommand(text, "npm run indexer:sync");
  requireCommand(text, "npm run settlement:inspect-ledger");
  requireCommand(text, "npm run rehearsal:evidence");

  if (args.requireDashboard) {
    requireRow(rows, "dashboard status", (value) => isConcrete(value) && !/not started|not run/i.test(value), "dashboard evidence is required");
  }

  if (args.requireWalrus) {
    requireRow(rows, "payment ledger", hasWalrusExport, "payment-ledger Walrus export is required");
    requireRow(rows, "receipt bundle", hasWalrusExport, "receipt-bundle Walrus export is required");
  }
}

function findLatestEvidenceFile() {
  const directory = resolve(root, "docs/runbooks");
  if (!existsSync(directory)) {
    return undefined;
  }

  const names = readdirSync(directory)
    .filter((name) => /^testnet-rehearsal-evidence-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();

  const latest = names.at(-1);
  return latest ? resolve(directory, latest) : undefined;
}

function parseMarkdownRows(text) {
  const rows = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) {
      continue;
    }

    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim().replace(/`/g, ""));

    if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      continue;
    }

    const key = normalizeKey(cells[0]);
    if (!key || ["check", "field", "moment", "export", "time"].includes(key)) {
      continue;
    }

    rows.set(key, cells.slice(1).join(" | "));
  }

  return rows;
}

function requireText(text, name, pattern, message) {
  if (pattern.test(text)) {
    pass(name, "present");
  } else {
    fail(name, message);
  }
}

function requireRow(rows, key, predicate, message) {
  const normalized = normalizeKey(key);
  const value = rows.get(normalized);
  if (value === undefined) {
    fail(key, "missing");
    return;
  }

  if (!isConcrete(value)) {
    fail(key, `placeholder value: ${value}`);
    return;
  }

  if (!predicate(value)) {
    fail(key, message);
    return;
  }

  pass(key, value);
}

function requireCommand(text, command) {
  if (text.includes(command)) {
    pass(`command ${command}`, "recorded");
  } else {
    fail(`command ${command}`, "missing from Commands Run");
  }
}

function pass(name, details) {
  checks.push({ name, ok: true, details });
}

function fail(name, details) {
  checks.push({ name, ok: false, details });
}

function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/\s+/g, " ");
}

function isConcrete(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/^\s*(TODO|TBD|unknown|n\/a|none|not provided)\s*$/i.test(value) &&
    !/\bTODO\b/i.test(value)
  );
}

function isSuiAddress(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

function isNonZeroSuiAddress(value) {
  return isSuiAddress(value) && !/^0x0{64}$/i.test(value.trim());
}

function isSuiDigest(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value.trim());
}

function isHexLike(value) {
  return /^(0x)?[a-fA-F0-9]{32,}$/.test(value.trim());
}

function isPositiveInteger(value) {
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

function isNonNegativeInteger(value) {
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) >= 0n;
}

function isCheckpointCursor(value) {
  return /^\d+:\d+$/.test(value.trim());
}

function isIsoDateish(value) {
  return /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function hasSettlementLedgerSummary(value) {
  return /receiptCount=\d+/i.test(value) && /totalAmount=\d+/i.test(value);
}

function hasBeforeSettlementSummary(value) {
  return /receiptPaymentCount=1/i.test(value) && /unsettledCount=1/i.test(value);
}

function hasAfterSettlementSummary(value) {
  return (
    /receiptPaymentCount=1/i.test(value) &&
    /settledCount=1/i.test(value) &&
    /unsettledCount=0/i.test(value) &&
    /mismatchedCount=0/i.test(value) &&
    /duplicateCount=0/i.test(value) &&
    /orphanedEventCount=0/i.test(value)
  );
}

function hasWalrusExport(value) {
  return /blob|object|walrus/i.test(value) && !/not run|not configured/i.test(value);
}

function relativeToRoot(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path;
}

function printHelp() {
  console.log(`Usage: node scripts/check-rehearsal-evidence.mjs [options]

Checks a Testnet rehearsal evidence markdown file for concrete funded paid-call,
receipt, settlement, indexer, and reconciliation proof.

Options:
  --file <path>          Evidence markdown file. Defaults to latest docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md.
  --require-dashboard    Require dashboard status evidence instead of allowing API-only rehearsal evidence.
  --require-walrus       Require Walrus payment-ledger and receipt-bundle export evidence.
  --json                 Print machine-readable check results.
`);
}
