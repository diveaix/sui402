#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const packageRoot = join(root, "packages");
const failures = [];

for (const directory of readdirSync(packageRoot, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;

  const packageDir = join(packageRoot, directory.name);
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (packageJson.private) continue;

  checkPackageMetadata(packageJson, packageJsonPath, packageDir);
  checkPackContents(packageJson);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[fail] ${failure}`);
  }
  console.error(`\n${failures.length} npm package readiness check(s) failed.`);
  process.exit(1);
}

console.log("npm package dry-run checks passed.");

function checkPackageMetadata(packageJson, packageJsonPath, packageDir) {
  const label = packageJson.name ?? packageJsonPath;
  requireField(label, packageJson, "name");
  requireField(label, packageJson, "version");
  requireField(label, packageJson, "description");
  requireField(label, packageJson, "main");
  requireField(label, packageJson, "types");
  requireField(label, packageJson, "exports");
  requireField(label, packageJson, "files");
  requireField(label, packageJson, "publishConfig");
  requireField(label, packageJson, "engines");

  if (packageJson.license) {
    failures.push(`${label}: license must be decided at the repo level, not guessed per package`);
  }

  if (packageJson.publishConfig?.access !== "public") {
    failures.push(`${label}: publishConfig.access must be "public" for scoped npm packages`);
  }

  for (const target of [packageJson.main, packageJson.types]) {
    if (typeof target === "string" && !existsSync(join(packageDir, target))) {
      failures.push(`${label}: ${target} does not exist; run npm run build first`);
    }
  }

  if (packageJson.bin) {
    for (const [binName, target] of Object.entries(packageJson.bin)) {
      if (typeof target !== "string" || !existsSync(join(packageDir, target))) {
        failures.push(`${label}: bin ${binName} target ${target} does not exist`);
      }
    }
  }
}

function checkPackContents(packageJson) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "-w", packageJson.name], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    failures.push(`${packageJson.name}: npm pack failed\n${result.stderr || result.stdout}`);
    return;
  }

  let packs;
  try {
    packs = JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`${packageJson.name}: npm pack did not return JSON: ${error.message}`);
    return;
  }

  const pack = packs[0];
  const files = pack?.files?.map((file) => file.path) ?? [];
  if (files.length === 0) {
    failures.push(`${packageJson.name}: npm pack reported no files`);
    return;
  }

  const forbidden = files.filter(isForbiddenPackPath);
  if (forbidden.length > 0) {
    failures.push(`${packageJson.name}: package would include forbidden files: ${forbidden.join(", ")}`);
  }

  for (const expected of ["package.json", normalizePackPath(packageJson.main), normalizePackPath(packageJson.types)]) {
    if (expected && !files.includes(expected)) {
      failures.push(`${packageJson.name}: package is missing ${expected}`);
    }
  }

  if (packageJson.bin) {
    for (const target of Object.values(packageJson.bin)) {
      const normalized = normalizePackPath(target);
      if (!files.includes(normalized)) {
        failures.push(`${packageJson.name}: package is missing bin target ${normalized}`);
      }
    }
  }

  const packageDir = join(root, "packages", packageJson.name.replace("@sui402/", ""));
  const relativePackageDir = normalizePackPath(relative(root, packageDir));
  const leakedLocalState = files.filter((file) => file.startsWith(`${relativePackageDir}/`));
  if (leakedLocalState.length > 0) {
    failures.push(`${packageJson.name}: package paths should be relative to package root, got ${leakedLocalState.join(", ")}`);
  }
}

function requireField(label, packageJson, key) {
  if (packageJson[key] === undefined || packageJson[key] === "" || packageJson[key] === null) {
    failures.push(`${label}: missing ${key}`);
  }
}

function isForbiddenPackPath(file) {
  const normalized = normalizePackPath(file);
  return (
    normalized.startsWith("src/") ||
    normalized.startsWith("test/") ||
    normalized.startsWith("tests/") ||
    normalized.startsWith(".sui402/") ||
    normalized.includes("/.sui402/") ||
    normalized.endsWith(".env") ||
    normalized.includes(".env.") ||
    normalized.endsWith(".log") ||
    normalized.endsWith(".tsbuildinfo") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/")
  );
}

function normalizePackPath(value) {
  if (!value || typeof value !== "string") return value;
  return value.replace(/^\.\//, "").split(sep).join(posix.sep);
}
