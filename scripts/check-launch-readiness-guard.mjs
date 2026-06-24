#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "sui402-launch-guard-"));

try {
  const localSeriousEnv = join(tmp, "local-serious.env");
  const hostedSeriousEnv = join(tmp, "hosted-serious.env");

  writeFileSync(localSeriousEnv, buildEnv({ serious: true, hosted: false }));
  writeFileSync(hostedSeriousEnv, buildEnv({ serious: true, hosted: true }));

  const localResult = runLaunchCheck(localSeriousEnv);
  if (localResult.status === 0) {
    fail("local serious launch config unexpectedly passed");
  }

  assertIncludes(localResult.output, "env SUI402_REDIS_URL: missing");
  assertIncludes(localResult.output, "dashboard must point at a public HTTPS console API URL");
  assertIncludes(localResult.output, "env SUI402_CONSOLE_OIDC_ISSUER: missing");

  const hostedResult = runLaunchCheck(hostedSeriousEnv);
  if (hostedResult.status !== 0) {
    fail(`hosted serious launch fixture failed unexpectedly\n${hostedResult.output}`);
  }

  assertIncludes(hostedResult.output, "Launch readiness config checks passed.");
  console.log("launch readiness guard self-test passed.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function runLaunchCheck(envFile) {
  const result = spawnSync("node", ["scripts/launch-readiness-check.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      SUI402_LAUNCH_ENV_FILE: envFile
    },
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`
  };
}

function buildEnv({ serious, hosted }) {
  const operatorKeys = JSON.stringify([
    {
      id: "ops-admin",
      key: "ops_live_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW",
      roles: ["admin"],
      expiresAt: "2026-12-31T00:00:00.000Z"
    }
  ]);

  const lines = [
    "NODE_ENV=production",
    serious ? "SUI402_SERIOUS_LAUNCH=true" : "SUI402_SERIOUS_LAUNCH=false",
    "SUI402_POSTGRES_PASSWORD=pg_live_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW",
    "SUI402_ADMIN_API_KEY=admin_live_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW",
    `SUI402_CONSOLE_OPERATOR_KEYS_JSON=${operatorKeys}`,
    "SUI402_NETWORK=sui:testnet",
    "SUI402_MERCHANT_ADDRESS=0x1111111111111111111111111111111111111111111111111111111111111111",
    "SUI402_SESSION_PACKAGE_ID=0x2222222222222222222222222222222222222222222222222222222222222222",
    "SUI402_COIN_TYPE=0x2::sui::SUI",
    "SUI402_PRICE=1000000"
  ];

  if (hosted) {
    lines.push(
      "SUI402_REDIS_URL=rediss://default:rd_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW@redis.staging.invalid:6379",
      "SUI402_POSTGRES_URL=postgres://sui402:pg_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW@postgres.staging.invalid:5432/sui402",
      "SUI402_CONSOLE_STORAGE_DRIVER=postgres",
      "SUI402_CONSOLE_POSTGRES_URL=postgres://sui402:pg_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW@console-postgres.staging.invalid:5432/sui402",
      "SUI402_INDEXER_POSTGRES_URL=postgres://sui402:pg_6Yk9QvT4mX2cR8nP7zL5aB3dF1hJ0sW@indexer-postgres.staging.invalid:5432/sui402",
      "SUI402_CONSOLE_PROVIDER_BASE_URL=https://console.staging.invalid",
      "SUI402_CONSOLE_CORS_ORIGINS=https://dashboard.staging.invalid",
      "VITE_SUI402_CONSOLE_API_URL=https://console.staging.invalid",
      "SUI402_CONSOLE_OIDC_ISSUER=https://issuer.staging.invalid",
      "SUI402_CONSOLE_OIDC_AUDIENCE=sui402-console-staging",
      "SUI402_CONSOLE_OIDC_JWKS_URL=https://issuer.staging.invalid/.well-known/jwks.json",
      "SUI402_GRPC_URL=https://sui-rpc.staging.invalid",
      "SUI402_RECEIPT_SIGNER_PROVIDER=external",
      "SUI402_RECEIPT_SIGNER_ID=0x3333333333333333333333333333333333333333333333333333333333333333",
      "SUI402_STAGING_EVIDENCE=STAGE-100 2026-06-20 https://deploy.staging.invalid/releases/sui402-1",
      "SUI402_FUNDED_REHEARSAL_EVIDENCE=REHEARSE-101 2026-06-20 file:/evidence/testnet-rehearsal.md",
      "SUI402_EXTERNAL_AUDIT_EVIDENCE=AUDIT-123 2026-06-20 file:/evidence/sui402-audit.pdf",
      "SUI402_MOVE_AUDIT_EVIDENCE=MOVEAUD-124 2026-06-20 file:/evidence/move-audit.pdf",
      "SUI402_BACKEND_SDK_AUDIT_EVIDENCE=BEAUD-125 2026-06-20 file:/evidence/backend-sdk-audit.pdf",
      "SUI402_LEGAL_REVIEW_EVIDENCE=LEGAL-456 2026-06-20 file:/evidence/legal-approval.md",
      "SUI402_SECRET_MANAGEMENT_EVIDENCE=SEC-457 2026-06-20 file:/evidence/secret-manager-review.md",
      "SUI402_OIDC_EVIDENCE=OIDC-458 2026-06-20 file:/evidence/oidc-negative-tests.md",
      "SUI402_ONCALL_EVIDENCE=OPS-789 2026-06-20 file:/evidence/pager-policy.md",
      "SUI402_KMS_EVIDENCE=KMS-321 2026-06-20 sha256:0123456789abcdef",
      "SUI402_MONITORING_EVIDENCE=MON-654 2026-06-20 https://grafana.staging.invalid/d/sui402",
      "SUI402_BACKUP_RESTORE_EVIDENCE=BACKUP-655 2026-06-20 file:/evidence/restore-drill.md",
      "SUI402_RPC_EVIDENCE=RPC-656 2026-06-20 file:/evidence/sui-rpc-owner-quota.md",
      "SUI402_SELLER_INTAKE_EVIDENCE=INTAKE-657 2026-06-20 file:/evidence/seller-intake-controls.md"
    );
  } else {
    lines.push(
      "SUI402_CONSOLE_PROVIDER_BASE_URL=http://localhost:4030",
      "VITE_SUI402_CONSOLE_API_URL=http://localhost:4030"
    );
  }

  return `${lines.join("\n")}\n`;
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    fail(`expected output to include ${JSON.stringify(expected)}\n${value}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
