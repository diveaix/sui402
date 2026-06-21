#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const baseUrl = args.url ?? process.env.SUI402_SCAN_BASE_URL ?? process.env.SUI402_CONSOLE_PROVIDER_BASE_URL ?? process.env.VITE_SUI402_CONSOLE_API_URL;
const cliPath = resolve(root, args.cli ?? "packages/pay/dist/index.js");
const checks = [];

if (!baseUrl) {
  fail("scan base URL", "pass --url <console-api-url> or set SUI402_SCAN_BASE_URL");
} else if (!looksLikeUrl(baseUrl)) {
  fail("scan base URL", `invalid URL: ${baseUrl}`);
} else if (!existsSync(cliPath)) {
  fail("sui402-pay CLI", `${relativeToRoot(cliPath)} missing; run npm run build -w @sui402/pay`);
} else {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  try {
    const apiStats = await fetchJson(`${normalizedBaseUrl}/v1/scan/stats`);
    pass("public scan stats JSON", `${normalizedBaseUrl}/v1/scan/stats`);

    const cliStats = await runPayScanStats(cliPath, normalizedBaseUrl);
    pass("sui402-pay scan stats", `sui402-pay scan stats --json --marketplace-url ${normalizedBaseUrl}`);

    compareStats(apiStats, cliStats);
  } catch (error) {
    fail("scan agreement", error instanceof Error ? error.message : String(error));
  }
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
        url: baseUrl,
        checks
      },
      null,
      2
    )
  );
}

if (failures.length > 0) {
  if (!args.json) {
    console.error(`\n${failures.length} scan agreement check(s) failed.`);
  }
  process.exit(1);
}

if (!args.json) {
  console.log("\nPublic scan JSON and CLI scan stats agree.");
}

function parseArgs(argv) {
  const parsed = {
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--url") {
      parsed.url = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--url=")) {
      parsed.url = arg.slice("--url=".length);
    } else if (arg === "--cli") {
      parsed.cli = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--cli=")) {
      parsed.cli = arg.slice("--cli=".length);
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

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function runPayScanStats(cliPath, url) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "scan", "stats", "--json", "--marketplace-url", url], {
    cwd: root,
    encoding: "utf8"
  });

  return JSON.parse(stdout);
}

function compareStats(apiStats, cliStats) {
  cliStats = cliStats?.stats ?? cliStats;
  compareValue("schemaVersion", apiStats.schemaVersion, cliStats.schemaVersion);
  compareValue("dataSource", apiStats.dataSource, cliStats.dataSource);
  compareValue("totals", apiStats.totals, cliStats.totals);
  compareValue("networks", apiStats.networks, cliStats.networks);
  compareValue("transports", apiStats.transports, cliStats.transports);
  compareValue("coins", apiStats.coins, cliStats.coins);
  compareValue("volumeByCoin", apiStats.volumeByCoin, cliStats.volumeByCoin);
  compareRecentPaymentDigests(apiStats.recentPayments, cliStats.recentPayments);
}

function compareValue(name, left, right) {
  const leftJson = stableJson(left);
  const rightJson = stableJson(right);
  if (leftJson === rightJson) {
    pass(name, leftJson);
  } else {
    fail(name, `public JSON ${leftJson} != CLI ${rightJson}`);
  }
}

function compareRecentPaymentDigests(left, right) {
  const leftDigests = Array.isArray(left) ? left.map((payment) => payment?.digest).filter(Boolean) : [];
  const rightDigests = Array.isArray(right) ? right.map((payment) => payment?.digest).filter(Boolean) : [];
  compareValue("recent payment digests", leftDigests, rightDigests);
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
  }

  return value;
}

function looksLikeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function pass(name, details) {
  checks.push({ name, ok: true, details });
}

function fail(name, details) {
  checks.push({ name, ok: false, details });
}

function relativeToRoot(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path;
}

function printHelp() {
  console.log(`Usage: node scripts/check-scan-agreement.mjs --url <console-api-url> [options]

Fetches /v1/scan/stats directly and through the packaged sui402-pay CLI, then
compares the public stats fields that must agree for a deployed environment.

Options:
  --url <url>       Console API base URL. Can also use SUI402_SCAN_BASE_URL.
  --cli <path>      CLI entrypoint. Default packages/pay/dist/index.js.
  --json            Print machine-readable check results.
`);
}
