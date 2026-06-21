#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const envFile = args.envFile ?? process.env.SUI402_REHEARSAL_ENV_FILE;
const checks = [];

if (envFile) {
  loadEnvFile(resolve(root, envFile));
}

const requiredEnv = [
  "SUI402_NETWORK",
  "SUI402_SESSION_PACKAGE_ID",
  "SUI402_MERCHANT_ADDRESS",
  "SUI402_COIN_TYPE",
  "SUI402_PRICE",
  "SUI402_RESOURCE_SCOPE"
];

const optionalEnv = [
  "SUI_SECRET_KEY",
  "SUI_MNEMONIC",
  "SUI402_REDIS_URL",
  "SUI402_POSTGRES_URL",
  "SUI402_CONSOLE_POSTGRES_URL",
  "SUI402_WALRUS_PUBLISHER_URL",
  "SUI402_WALRUS_AGGREGATOR_URL",
  "SUI402_RECEIPT_SIGNER_ID",
  "SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64"
];

checkCommand("node", ["--version"], "Node.js runtime");
checkCommand("npm", ["--version"], "npm");
checkCommand("sui", ["--version"], "Sui CLI");
checkCommand("sui", ["client", "active-env"], "Sui active environment", { expected: /testnet/i });
checkCommand("sui", ["client", "active-address"], "Sui active address");
checkCommand("sui", ["client", "balance"], "Sui gas balance");

for (const key of requiredEnv) {
  const value = process.env[key];
  const validation = validateRequiredEnv(key, value);
  checks.push({
    name: `env ${key}`,
    ok: validation.ok,
    details: validation.ok && value ? redact(key, value) : validation.details
  });
}

for (const key of optionalEnv) {
  checks.push({
    name: `optional env ${key}`,
    ok: true,
    details: process.env[key] ? redact(key, process.env[key]) : "not set"
  });
}

checkReceiptSigner();
checkPublishedPackage();

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  const marker = check.ok ? "ok" : "fail";
  console.log(`[${marker}] ${check.name}: ${check.details}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} rehearsal readiness check(s) failed.`);
  process.exit(1);
}

console.log("\nAll required rehearsal readiness checks passed.");

function checkCommand(command, args, name, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: true
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const expectedOk = options.expected ? options.expected.test(output) : true;
  checks.push({
    name,
    ok: result.status === 0 && expectedOk,
    details: output.split(/\r?\n/)[0] ?? "no output"
  });
}

function checkPublishedPackage() {
  const publishedPath = resolve(root, "move/sui402_sessions/Published.toml");
  if (!existsSync(publishedPath)) {
    checks.push({
      name: "Published.toml testnet package",
      ok: false,
      details: "move/sui402_sessions/Published.toml missing"
    });
    return;
  }

  const text = readFileSync(publishedPath, "utf8");
  const hasTestnet = /\[published\.testnet\]/.test(text);
  const envPackage = process.env.SUI402_SESSION_PACKAGE_ID;
  const envMatches = envPackage ? text.toLowerCase().includes(envPackage.toLowerCase()) : false;
  checks.push({
    name: "Published.toml testnet package",
    ok: hasTestnet && (!envPackage || envMatches),
    details: hasTestnet
      ? envPackage
        ? envMatches
          ? "env package id found in Published.toml"
          : "env package id not found in Published.toml"
        : "testnet publish metadata present"
      : "missing [published.testnet]"
  });
}

function checkReceiptSigner() {
  const signerId = process.env.SUI402_RECEIPT_SIGNER_ID;
  const privateKey = process.env.SUI402_RECEIPT_PRIVATE_KEY_PEM || process.env.SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64;
  const signerLooksLikeAddress = !signerId || /^0x[a-fA-F0-9]{64}$/.test(signerId);

  checks.push({
    name: "receipt signer config",
    ok: (!signerId || Boolean(privateKey)) && signerLooksLikeAddress,
    details: !signerId
      ? "not set"
      : !privateKey
        ? "signer id set but private key missing"
        : signerLooksLikeAddress
          ? "configured"
          : "signer id should be a Sui address for settlement reconciliation"
  });
}

function redact(key, value) {
  if (key.includes("SECRET") || key.includes("MNEMONIC") || key.includes("URL") || key.includes("KEY")) {
    return value.length <= 12 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  return value;
}

function validateRequiredEnv(key, value) {
  if (!value) {
    return { ok: false, details: "missing" };
  }

  if (key === "SUI402_NETWORK") {
    return value === "sui:testnet" ? { ok: true } : { ok: false, details: "must be sui:testnet for this rehearsal" };
  }

  if (key === "SUI402_SESSION_PACKAGE_ID" || key === "SUI402_MERCHANT_ADDRESS") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
      return { ok: false, details: "must be a 32-byte Sui address" };
    }

    if (key === "SUI402_MERCHANT_ADDRESS" && /^0x0{64}$/.test(value)) {
      return { ok: false, details: "must not be the zero address" };
    }
  }

  if (key === "SUI402_PRICE" && (!/^\d+$/.test(value) || BigInt(value) <= 0n)) {
    return { ok: false, details: "must be a positive integer" };
  }

  return { ok: true };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      parsed.envFile = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--env-file=")) {
      parsed.envFile = arg.slice("--env-file=".length);
    }
  }

  return parsed;
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    checks.push({
      name: "env file",
      ok: false,
      details: `${path} missing`
    });
    return;
  }

  const loadedKeys = [];
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
    loadedKeys.push(key);
  }

  checks.push({
    name: "env file",
    ok: true,
    details: `loaded ${loadedKeys.length} default(s) from ${path}`
  });
}
