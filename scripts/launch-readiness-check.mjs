#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.env.SUI402_LAUNCH_ENV_FILE ?? ".env.production");
const checks = [];

if (!existsSync(envPath)) {
  fail("env file", `${envPath} does not exist`);
} else {
  const env = parseEnvFile(readFileSync(envPath, "utf8"));
  const evidence = loadEvidence(env);

  requireValue(env, "NODE_ENV", (value) => value === "production", "must be production");
  requireValue(env, "SUI402_POSTGRES_PASSWORD", isStrongSecret, "replace placeholder with a long random password");
  requireValue(env, "SUI402_ADMIN_API_KEY", isStrongSecret, "replace placeholder with a long random provider admin key");
  requireValue(env, "SUI402_CONSOLE_OPERATOR_KEYS_JSON", hasStrongOperatorKeys, "operator keys must be long random non-placeholder values");
  requireValue(env, "SUI402_MERCHANT_ADDRESS", isNonZeroSuiAddress, "must be a real non-zero Sui address");
  requireValue(env, "SUI402_SESSION_PACKAGE_ID", isSuiAddress, "must be a pinned Sui package id");
  requireValue(env, "SUI402_COIN_TYPE", (value) => value.length > 0, "must be set");
  requireValue(env, "SUI402_PRICE", (value) => /^\d+$/.test(value) && BigInt(value) > 0n, "must be a positive integer");
  requireValue(env, "VITE_SUI402_CONSOLE_API_URL", looksLikeUrl, "dashboard needs an explicit console API URL");

  if (env.VITE_SUI402_CONSOLE_ADMIN_API_KEY) {
    fail("dashboard admin key", "VITE_SUI402_CONSOLE_ADMIN_API_KEY would be bundled into browser JavaScript");
  } else {
    pass("dashboard admin key", "not bundled");
  }

  if (env.SUI402_RECEIPT_SIGNER_ID && !env.SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64 && env.SUI402_RECEIPT_SIGNER_PROVIDER !== "external") {
    fail("receipt signer", "local receipt signer id is set but no private key is configured");
  } else if (env.SUI402_RECEIPT_SIGNER_PROVIDER === "external") {
    pass("receipt signer", "external signer selected; verify KMS/HSM smoke tests separately");
  } else {
    pass("receipt signer", env.SUI402_RECEIPT_SIGNER_ID ? "local signer configured" : "not enabled");
  }

  if (env.SUI402_NETWORK === "sui:mainnet" && process.env.SUI402_ALLOW_MAINNET_LAUNCH_CHECK !== "true") {
    fail("mainnet launch gate", "set SUI402_ALLOW_MAINNET_LAUNCH_CHECK=true only after audits/legal/on-call/KMS gates have evidence");
  } else {
    pass("mainnet launch gate", env.SUI402_NETWORK ?? "not set");
  }

  if (requiresSeriousLaunchEvidence(env)) {
    pass("serious launch evidence gate", seriousLaunchReason(env));
    requireEvidence(
      env,
      evidence,
      "external audit evidence",
      ["SUI402_EXTERNAL_AUDIT_EVIDENCE"],
      ["externalAudit", "external_audit", "audit"],
      "provide completed external audit evidence: report URL/path, ticket, dated memo, or digest"
    );
    requireEvidence(
      env,
      evidence,
      "legal review evidence",
      ["SUI402_LEGAL_REVIEW_EVIDENCE"],
      ["legalReview", "legal_review", "legal"],
      "provide counsel/legal review evidence: approval URL/path, ticket, or dated memo"
    );
    requireEvidence(
      env,
      evidence,
      "on-call evidence",
      ["SUI402_ONCALL_EVIDENCE"],
      ["onCall", "on_call", "oncall"],
      "provide production on-call evidence: roster, escalation policy, runbook, or dated drill record"
    );
    requireEvidence(
      env,
      evidence,
      "KMS/signer evidence",
      ["SUI402_KMS_EVIDENCE", "SUI402_RECEIPT_SIGNER_EVIDENCE"],
      ["kms", "receiptSigner", "receipt_signer", "signer"],
      "provide KMS/HSM or receipt signer evidence: smoke-test record, key policy, public-key verification, or risk acceptance"
    );
    requireEvidence(
      env,
      evidence,
      "monitoring evidence",
      ["SUI402_MONITORING_EVIDENCE"],
      ["monitoring", "observability", "alerts"],
      "provide monitoring evidence: dashboard URL/path, alert policy, synthetic check, or dated paging drill"
    );
  } else {
    pass("serious launch evidence gate", "not required for non-mainnet/non-serious launch");
  }
}

for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.details}`);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} launch readiness check(s) failed.`);
  process.exit(1);
}

console.log("\nLaunch readiness config checks passed.");

function requireValue(env, key, predicate, message) {
  const value = env[key];
  if (!value) {
    fail(`env ${key}`, "missing");
    return;
  }

  if (!predicate(value)) {
    fail(`env ${key}`, message);
    return;
  }

  pass(`env ${key}`, redact(key, value));
}

function pass(name, details) {
  checks.push({ name, ok: true, details });
}

function fail(name, details) {
  checks.push({ name, ok: false, details });
}

function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadEvidence(env) {
  const evidencePath = env.SUI402_LAUNCH_EVIDENCE_FILE ?? process.env.SUI402_LAUNCH_EVIDENCE_FILE;
  if (!evidencePath) {
    return {};
  }

  const resolvedPath = resolve(evidencePath);
  if (!existsSync(resolvedPath)) {
    fail("launch evidence file", `${resolvedPath} does not exist`);
    return {};
  }

  try {
    const evidence = JSON.parse(readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, ""));
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      fail("launch evidence file", "must be a JSON object");
      return {};
    }

    pass("launch evidence file", resolvedPath);
    return evidence;
  } catch (error) {
    fail("launch evidence file", `must be valid JSON: ${error.message}`);
    return {};
  }
}

function requiresSeriousLaunchEvidence(env) {
  return env.SUI402_NETWORK === "sui:mainnet" || isTrue(env.SUI402_SERIOUS_LAUNCH) || isTrue(process.env.SUI402_SERIOUS_LAUNCH);
}

function seriousLaunchReason(env) {
  if (env.SUI402_NETWORK === "sui:mainnet") {
    return "required because SUI402_NETWORK=sui:mainnet";
  }

  return "required because SUI402_SERIOUS_LAUNCH=true";
}

function requireEvidence(env, evidence, name, envKeys, evidenceKeys, message) {
  const envKey = envKeys.find((key) => env[key] || process.env[key]);
  if (envKey) {
    checkEvidence(name, env[envKey] ?? process.env[envKey], `${envKey}`, message);
    return;
  }

  const evidenceKey = evidenceKeys.find((key) => evidence[key] !== undefined);
  if (evidenceKey) {
    checkEvidence(name, evidence[evidenceKey], `evidence file field ${evidenceKey}`, message);
    return;
  }

  fail(name, `${message}; set ${envKeys.join(" or ")} or SUI402_LAUNCH_EVIDENCE_FILE`);
}

function checkEvidence(name, value, source, message) {
  const normalized = normalizeEvidence(value);
  if (!isEvidenceReference(normalized)) {
    fail(name, `${source} is not concrete evidence; ${message}`);
    return;
  }

  pass(name, source);
}

function normalizeEvidence(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return "";
}

function isEvidenceReference(value) {
  return (
    value.length >= 16 &&
    !/^(true|false|yes|no|y|n|done|ok|pass|passed|complete|completed)$/i.test(value) &&
    !/todo|tbd|placeholder|replace|example|sample|none|n\/a|not applicable|later|pending|unknown/i.test(value) &&
    /(\b[A-Z][A-Z0-9]+-\d+\b|https?:\/\/|s3:\/\/|gs:\/\/|file:|sha256:[a-fA-F0-9]{16,}|\b20\d{2}-\d{2}-\d{2}\b|[/\\]|#\d+)/.test(
      value
    )
  );
}

function isTrue(value) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function isStrongSecret(value) {
  return (
    value.length >= 24 &&
    !/replace|change-this|password|secret|example|default|localhost|local-|admin-key|provider-admin|console-admin|merchant-key|viewer-key|indexer-key/i.test(
      value
    )
  );
}

function hasStrongOperatorKeys(value) {
  try {
    const operators = JSON.parse(value);
    return (
      Array.isArray(operators) &&
      operators.length > 0 &&
      operators.every((operator) => typeof operator.key === "string" && isStrongSecret(operator.key))
    );
  } catch {
    return false;
  }
}

function isSuiAddress(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isNonZeroSuiAddress(value) {
  return isSuiAddress(value) && !/^0x0{64}$/.test(value);
}

function looksLikeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function redact(key, value) {
  if (/KEY|PASSWORD|SECRET|MNEMONIC|URL/i.test(key)) {
    return value.length <= 12 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  return value;
}
