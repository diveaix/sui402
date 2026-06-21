#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(".");
const packagesToPack = ["@sui402/protocol", "@sui402/policy", "@sui402/sui", "@sui402/client", "@sui402/pay"];
const packageDirs = new Map([
  ["@sui402/protocol", "packages/protocol"],
  ["@sui402/policy", "packages/policy"],
  ["@sui402/sui", "packages/sui"],
  ["@sui402/client", "packages/client"],
  ["@sui402/pay", "packages/pay"]
]);

const tempRoot = await mkdtemp(join(tmpdir(), "sui402-pay-clean-install-"));
const packDir = join(tempRoot, "packed");
const projectDir = join(tempRoot, "project");
const homeDir = join(tempRoot, "home");
const keepTemp = process.env.SUI402_KEEP_CLEAN_INSTALL_TEMP === "1";

try {
  logStep(`Using temporary clean project at ${projectDir}`);
  await mkdir(packDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  for (const packageName of packagesToPack) {
    await assertPackageEntrypointsExist(packageName);
  }

  const tarballs = [];
  for (const packageName of packagesToPack) {
    logStep(`Packing ${packageName}`);
    tarballs.push(await packWorkspacePackage(packageName));
  }

  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "sui402-pay-clean-install-proof",
        version: "0.0.0",
        private: true,
        type: "module",
        description: "Temporary clean-install proof project for @sui402/pay."
      },
      null,
      2
    )
  );

  logStep("Installing packed tarballs into clean project");
  const install = run("npm", ["install", "--ignore-scripts", "--no-audit", "--fund=false", "--save-exact", ...tarballs], {
    cwd: projectDir,
    env: proofEnv()
  });
  assertOk(install, "install packed @sui402/pay and local workspace dependencies");

  logStep("Running packaged CLI --help");
  const help = runCli(["--help"]);
  assertOk(help, "sui402-pay --help");
  assertIncludes(help.stdout, "sui402-pay", "help output should identify the CLI");

  logStep("Running packaged CLI init preflight");
  const init = runCli(["init", "--check", "--json", "--no-balance"]);
  assertOk(init, "sui402-pay init --check --json --no-balance");
  const initJson = parseJson(init.stdout, "init JSON");
  assertEqual(initJson.custody, "user-owned", "init report should preserve non-custodial posture");
  assertEqual(initJson.signerConfigured, false, "init proof should not discover or require a local signer");
  assertNoSecretLeak(init.stdout, "init output");

  logStep("Running packaged CLI readiness preflight");
  const readiness = runCli(["readiness", "--json", "--no-balance"]);
  assertOk(readiness, "sui402-pay readiness --json --no-balance");
  const readinessJson = parseJson(readiness.stdout, "readiness JSON");
  assertEqual(readinessJson.custody, "user-owned", "readiness report should preserve non-custodial posture");
  assertEqual(readinessJson.signerConfigured, false, "readiness proof should not discover or require a local signer");
  assertEqual(readinessJson.balanceCheck, "skipped", "readiness --no-balance should not query Sui gRPC");
  assertNoSecretLeak(readiness.stdout, "readiness output");

  logStep("Running packaged CLI search against localhost mock marketplace");
  const marketplace = await withMockMarketplace(async (marketplaceUrl, requests) => {
    const search = await runCliAsync(["search", "weather", "--json", "--marketplace-url", marketplaceUrl, "--limit", "1"]);
    assertOk(search, "sui402-pay search weather --json against localhost mock marketplace");
    const searchJson = parseJson(search.stdout, "search JSON");
    assertEqual(searchJson.count, 1, "search should read one mocked marketplace API");
    assertEqual(searchJson.apis?.[0]?.id, "clean-install-weather", "search should return the mocked API id");
    assertNoSecretLeak(search.stdout, "search output");
    return requests;
  });

  const searchRequest = marketplace.find((request) => request.pathname === "/v1/marketplace/apis");
  if (!searchRequest) {
    fail("mock marketplace did not receive /v1/marketplace/apis");
  }
  assertEqual(searchRequest.searchParams.get("q"), "weather", "search should pass the query to the marketplace");
  assertEqual(searchRequest.searchParams.get("limit"), "1", "search should pass the requested limit to the marketplace");

  const installedPayPackage = JSON.parse(await readFile(join(projectDir, "node_modules", "@sui402", "pay", "package.json"), "utf8"));
  assertEqual(installedPayPackage.name, "@sui402/pay", "clean project should install @sui402/pay from the packed tarball");
  if (!existsSync(join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "sui402-pay.cmd" : "sui402-pay"))) {
    fail("clean project is missing the sui402-pay executable shim");
  }

  console.log("Clean-install proof passed.");
  console.log(`Packed packages: ${packagesToPack.join(", ")}`);
  console.log("Verified packaged CLI commands:");
  console.log("  sui402-pay --help");
  console.log("  sui402-pay init --check --json --no-balance");
  console.log("  sui402-pay readiness --json --no-balance");
  console.log("  sui402-pay search weather --json --marketplace-url http://127.0.0.1:<mock> --limit 1");
  if (keepTemp) {
    console.log(`Temporary proof project kept at ${projectDir}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (keepTemp) {
    console.error(`Temporary proof project kept at ${projectDir}`);
  }
  process.exitCode = 1;
} finally {
  if (!keepTemp) {
    scheduleTempCleanup(tempRoot);
  }
}

async function assertPackageEntrypointsExist(packageName) {
  const packageDir = join(root, packageDirs.get(packageName));
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  for (const field of ["main", "types"]) {
    const target = packageJson[field];
    if (typeof target === "string" && !existsSync(join(packageDir, target))) {
      fail(`${packageName}: ${field} target ${target} is missing; run the relevant workspace build before clean-install proof.`);
    }
  }
  for (const [binName, target] of Object.entries(packageJson.bin ?? {})) {
    if (!existsSync(join(packageDir, target))) {
      fail(`${packageName}: bin ${binName} target ${target} is missing; run npm run build -w ${packageName}.`);
    }
  }
}

async function packWorkspacePackage(packageName) {
  const result = run("npm", ["pack", "--json", "--pack-destination", packDir, "-w", packageName], {
    cwd: root,
    env: proofEnv()
  });
  assertOk(result, `npm pack ${packageName}`);
  const parsed = parseJson(result.stdout, `npm pack JSON for ${packageName}`);
  const filename = parsed?.[0]?.filename;
  if (!filename) {
    fail(`npm pack ${packageName} did not report a tarball filename`);
  }
  const tarball = join(packDir, basename(filename));
  if (!existsSync(tarball)) {
    fail(`npm pack ${packageName} reported ${tarball}, but the tarball does not exist`);
  }
  return tarball;
}

async function withMockMarketplace(callback) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ pathname: url.pathname, searchParams: url.searchParams });

    if (request.method === "GET" && url.pathname === "/v1/marketplace/apis") {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(
        JSON.stringify({
          count: 1,
          apis: [
            {
              id: "clean-install-weather",
              name: "Clean Install Weather",
              description: "Local mock marketplace listing used by the packaged CLI proof.",
              transport: "http",
              network: "sui:testnet",
              merchant: "0x0000000000000000000000000000000000000000000000000000000000000001",
              coinType: "0x2::sui::SUI",
              price: "1000",
              resourceScope: "GET /weather",
              sessionSupported: true,
              protectedResourceUrl: "https://example.invalid/weather",
              status: "active",
              readiness: {
                ready: false,
                level: "needs_review",
                reasons: ["mock listing for clean-install proof only"],
                checks: [
                  {
                    name: "clean-install-mock",
                    ok: true,
                    message: "localhost mock marketplace responded"
                  }
                ]
              },
              stats: {
                verifiedPayments: 0,
                sessionPayments: 0,
                volume: "0"
              }
            }
          ]
        })
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      fail("mock marketplace did not bind to a TCP port");
    }
    await callback(`http://127.0.0.1:${address.port}`, requests);
    return requests;
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.closeAllConnections?.();
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

function runCli(args) {
  const binPath = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "sui402-pay.cmd" : "sui402-pay");
  return run(binPath, args, {
    cwd: projectDir,
    env: proofEnv()
  });
}

function runCliAsync(args) {
  const binPath = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "sui402-pay.cmd" : "sui402-pay");
  return runAsync(binPath, args, {
    cwd: projectDir,
    env: proofEnv()
  });
}

function proofEnv() {
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    SUI_SECRET_KEY: "",
    SUI_MNEMONIC: "",
    SUI_ADDRESS: "",
    SUI_CLIENT_CONFIG: join(homeDir, "missing-client.yaml"),
    SUI_KEYSTORE_PATH: join(homeDir, "missing-sui.keystore"),
    SUI402_MARKETPLACE_URL: "",
    SUI402_CONSOLE_API_URL: "",
    SUI402_SESSION_PACKAGE_ID: "",
    SUI402_MAX_ONE_SHOT_AMOUNT: ""
  };
}

function run(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

function runAsync(command, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      ...options,
      shell: process.platform === "win32",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 30_000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolveRun({ status: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolveRun({
        status: code ?? (signal ? 1 : 0),
        stdout,
        stderr: signal ? `${stderr}\nterminated by ${signal}` : stderr
      });
    });
  });
}

function scheduleTempCleanup(target) {
  const tempPrefix = resolve(tmpdir(), "sui402-pay-clean-install-");
  if (!resolve(target).startsWith(tempPrefix)) {
    return;
  }

  const cleanupScript = `
    import { rm } from "node:fs/promises";
    const target = process.argv[1];
    if (target) {
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", cleanupScript, target], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function assertOk(result, label) {
  if (result.status !== 0) {
    fail(
      [
        `${label} failed with exit code ${result.status}.`,
        result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : undefined,
        result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}\n${source}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) {
    fail(`${message}: missing ${JSON.stringify(expected)}\n${source}`);
  }
}

function assertNoSecretLeak(source, label) {
  for (const marker of ["suiprivkey", "SUI_MNEMONIC=", "SUI_SECRET_KEY=", "Authorization:", "Cookie:"]) {
    if (source.includes(marker)) {
      fail(`${label} included forbidden secret marker ${marker}`);
    }
  }
}

function fail(message) {
  throw new Error(`[clean-install] ${message}`);
}

function logStep(message) {
  if (process.env.SUI402_CLEAN_INSTALL_VERBOSE === "1") {
    console.error(`[clean-install] ${message}`);
  }
}
