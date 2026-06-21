#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const checks = [];

await checkDemoDocs();
await checkLocalScanAgreement();
if (!args.skipEvidence) {
  await checkRehearsalEvidence();
}

for (const check of checks) {
  console.log(`[${check.ok ? "ok" : "fail"}] ${check.name}: ${check.details}`);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} demo submission check(s) failed.`);
  process.exit(1);
}

console.log("\nDemo submission checks passed.");

async function checkDemoDocs() {
  const required = ["DEMO_SUBMISSION_PLAN.md", "docs/demo-submission.md", "docs/runbooks/testnet-rehearsal-evidence-2026-06-18.md"];
  for (const relativePath of required) {
    const path = resolve(root, relativePath);
    if (existsSync(path)) {
      pass(`doc ${relativePath}`, "present");
    } else {
      fail(`doc ${relativePath}`, "missing");
    }
  }
}

async function checkLocalScanAgreement() {
  const appPath = resolve(root, "apps/console-api/dist/app.js");
  const configPath = resolve(root, "apps/console-api/dist/config.js");
  const payPath = resolve(root, "packages/pay/dist/index.js");

  if (!existsSync(appPath) || !existsSync(configPath) || !existsSync(payPath)) {
    fail("local scan agreement", "built console/pay artifacts missing; run npm run build -w @sui402/console-api && npm run build -w @sui402/pay");
    return;
  }

  const { createConsoleApp } = await import(`file:///${appPath.replace(/\\/g, "/")}`);
  const { loadConsoleConfig } = await import(`file:///${configPath.replace(/\\/g, "/")}`);
  const config = loadConsoleConfig({
    NODE_ENV: "test",
    PORT: "4030",
    SUI402_CONSOLE_PROVIDER_BASE_URL: "http://localhost:4030"
  });
  const app = createConsoleApp(config);
  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const { stdout } = await execFileAsync(process.execPath, ["scripts/check-scan-agreement.mjs", "--url", `http://127.0.0.1:${port}`], {
      cwd: root,
      encoding: "utf8"
    });
    pass("local scan agreement", firstSuccessLine(stdout) ?? "public scan JSON and CLI agree");
  } catch (error) {
    fail("local scan agreement", childErrorOutput(error));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkRehearsalEvidence() {
  const evidenceFile = args.evidenceFile ?? findLatestEvidenceFile();
  if (!evidenceFile) {
    fail("rehearsal evidence", "no evidence file found; pass --evidence-file <path> or --skip-evidence");
    return;
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/check-rehearsal-evidence.mjs", "--file", evidenceFile], {
      cwd: root,
      encoding: "utf8"
    });
    pass("rehearsal evidence", firstSuccessLine(stdout) ?? evidenceFile);
  } catch (error) {
    fail("rehearsal evidence", childErrorOutput(error));
  }
}

function findLatestEvidenceFile() {
  const directory = resolve(root, "docs/runbooks");
  if (!existsSync(directory)) {
    return undefined;
  }

  return readdirSync(directory)
    .filter((name) => /^testnet-rehearsal-evidence-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .map((name) => `docs/runbooks/${name}`)
    .at(-1);
}

function parseArgs(argv) {
  const parsed = {
    skipEvidence: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-evidence") {
      parsed.skipEvidence = true;
    } else if (arg === "--evidence-file") {
      parsed.evidenceFile = argv[index + 1];
      index += 1;
    } else if (arg?.startsWith("--evidence-file=")) {
      parsed.evidenceFile = arg.slice("--evidence-file=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail("argument", `unsupported argument: ${arg}`);
    }
  }

  return parsed;
}

function firstSuccessLine(text) {
  return text
    .split(/\r?\n/)
    .find((line) => line.includes("passed") || line.includes("agree") || line.startsWith("[ok]"));
}

function childErrorOutput(error) {
  if (error && typeof error === "object") {
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout.trim() : "";
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    return [stdout, stderr].filter(Boolean).join("\n").slice(0, 2000) || String(error);
  }

  return String(error);
}

function pass(name, details) {
  checks.push({ name, ok: true, details });
}

function fail(name, details) {
  checks.push({ name, ok: false, details });
}

function printHelp() {
  console.log(`Usage: node scripts/check-demo-submission.mjs [options]

Runs fast demo-submission checks:
- required demo docs exist
- a temporary seeded console API agrees with sui402-pay scan stats
- the latest funded Testnet rehearsal evidence file passes machine checks

Options:
  --evidence-file <path>  Rehearsal evidence file. Defaults to latest docs/runbooks/testnet-rehearsal-evidence-YYYY-MM-DD.md.
  --skip-evidence         Skip rehearsal evidence check for offline UI-only rehearsals.
`);
}
