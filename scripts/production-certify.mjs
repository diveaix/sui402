#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const postgresUrl = process.env.SUI402_POSTGRES_URL ?? "postgres://sui402:sui402@localhost:5432/sui402";
const redisUrl = process.env.SUI402_REDIS_URL ?? "redis://localhost:6379";
const env = {
  ...process.env,
  SUI402_REDIS_URL: redisUrl,
  SUI402_POSTGRES_URL: postgresUrl,
  SUI402_CONSOLE_POSTGRES_URL: process.env.SUI402_CONSOLE_POSTGRES_URL ?? postgresUrl,
  SUI402_INDEXER_POSTGRES_URL: process.env.SUI402_INDEXER_POSTGRES_URL ?? postgresUrl
};

const integrationFilePassed = /Test Files\s+1 passed/;

const requiredPassMarkers = [
  {
    name: "storage live integration",
    command: "npm",
    args: ["run", "test:storage:integration"],
    marker: integrationFilePassed
  },
  {
    name: "indexer Postgres integration",
    command: "npm",
    args: ["run", "test:indexer:integration"],
    marker: integrationFilePassed
  },
  {
    name: "console API Postgres integration",
    command: "npm",
    args: ["run", "test:console-api:integration"],
    marker: integrationFilePassed
  }
];

run("docker", ["--version"]);
run("docker", ["compose", "version"]);
run("docker", ["compose", "up", "-d", "redis", "postgres"]);
run("docker", ["compose", "exec", "-T", "redis", "redis-cli", "ping"], { expect: /PONG/ });
run("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "sui402", "-d", "sui402"], {
  expect: /accepting connections/
});
run("npm", ["run", "check"]);
run("npm", ["test"]);
for (const check of requiredPassMarkers) {
  run(check.command, check.args, { name: check.name, expect: check.marker });
}
run("npm", ["run", "build"]);
run("sui", ["move", "test", "--build-env", "testnet"], { cwd: resolve(root, "move/sui402_sessions") });
run("sui", ["move", "build", "--build-env", "testnet"], { cwd: resolve(root, "move/sui402_sessions") });

console.log("\nProduction certification passed.");

function run(command, args, options = {}) {
  const label = options.name ?? `${command} ${args.join(" ")}`;
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env,
    encoding: "utf8",
    shell: true
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output.trim()) {
    process.stdout.write(output);
    if (!output.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.status !== 0) {
    console.error(`\nCertification step failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  if (options.expect && !options.expect.test(output)) {
    console.error(`\nCertification step did not prove the expected condition: ${label}`);
    process.exit(1);
  }
}
