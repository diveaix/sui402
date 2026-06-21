import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { createChallenge } from "@sui402/protocol";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let server: ReturnType<typeof createServer> | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  if (server) {
    const closing = once(server, "close");
    server.close();
    await closing;
    server = undefined;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("sui402-pay search", () => {
  it("prints non-custodial wallet readiness without leaking the local secret", async () => {
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout } = await runCli(["wallet"], {
      SUI_SECRET_KEY: secretKey,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet",
      SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
      SUI402_SESSION_PACKAGE_ID: "0xsessionpackage",
      SUI402_MARKETPLACE_URL: "https://console.example.com"
    });
    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      custody: "user-owned",
      signerConfigured: true,
      signerSource: "SUI_SECRET_KEY",
      address: keypair.toSuiAddress(),
      network: "sui:testnet",
      grpcUrl: "https://fullnode.testnet.sui.io:443",
      grpcUrlSource: "SUI_GRPC_URL",
      sessionPackageId: "0xsessionpackage",
      marketplaceUrl: "https://console.example.com",
      balanceCheck: "skipped",
      funding: {
        custody: "user-owned",
        purpose: "sui_gas",
        coinType: "0x2::sui::SUI",
        network: "sui:testnet",
        address: keypair.toSuiAddress(),
        actions: [
          expect.objectContaining({
            kind: "web_faucet",
            url: "https://faucet.sui.io"
          })
        ]
      },
      readiness: {
        readyForPaidCalls: false,
        level: "needs_gas_check",
        summary: "Signer is configured; gas readiness is unverified.",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "local_signer", ok: true }),
          expect.objectContaining({ name: "sui_gas_balance", ok: false })
        ])
      },
      errors: []
    });
    expect(status.readiness.nextActions.join("\n")).toContain("sui402-pay wallet --balance");
    expect(status.readiness.nextActions.join("\n")).toContain("https://faucet.sui.io");
    expect(status.readiness.nextActions.join("\n")).toContain("do not rely on `sui client faucet` for Testnet");
    expect(stdout).not.toContain(secretKey);
  });

  it("reports setup readiness as JSON even before a signer is configured", async () => {
    const { stdout } = await runCli(["setup", "--check", "--json"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:devnet"
    });
    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      custody: "user-owned",
      signerConfigured: false,
      network: "sui:devnet",
      grpcUrlSource: "default",
      balanceCheck: "skipped",
      readiness: {
        readyForPaidCalls: false,
        level: "needs_wallet",
        summary: "Configure a user-owned Sui signer before paid calls.",
        checks: expect.arrayContaining([expect.objectContaining({ name: "local_signer", ok: false })])
      }
    });
    expect(status.readiness.nextActions.join("\n")).toContain("sui client -y");
    expect(status.errors[0]).toContain("No Sui wallet configured");
  });

  it("prints readiness preflight blockers without requiring a configured signer", async () => {
    const { stdout } = await runCli(["readiness"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    });

    expect(stdout).toContain("readiness: needs_wallet");
    expect(stdout).toContain("ready for paid calls: no");
    expect(stdout).toContain("Gas balance was not checked.");
    expect(stdout).toContain("Initialize or select a Sui CLI wallet");
    expect(stdout).toContain("https://faucet.sui.io");
  });

  it("supports strict readiness for CI while still printing the diagnostic report", async () => {
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout, stderr } = await runCli(["readiness", "--strict", "--no-balance", "--json"], {
      SUI_SECRET_KEY: secretKey,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    }).catch((error: { stdout: string; stderr: string }) => error);
    const status = JSON.parse(stdout);

    expect(status.readiness).toMatchObject({
      readyForPaidCalls: false,
      level: "needs_gas_check"
    });
    expect(status.address).toBe(keypair.toSuiAddress());
    expect(stderr).toBe("");
    expect(stdout).not.toContain(secretKey);
  });

  it("treats init as the human setup entrypoint", async () => {
    const { stdout } = await runCli(["init"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: ""
    });

    expect(stdout).toContain("Sui402 wallet setup is non-custodial.");
    expect(stdout).toContain("sui402-pay readiness");
    expect(stdout).toContain("This CLI signs locally.");
  });

  it("prints human wallet next actions without leaking signer material", async () => {
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout } = await runCli(["wallet", "--human"], {
      SUI_SECRET_KEY: secretKey,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    });

    expect(stdout).toContain("readiness: needs_gas_check");
    expect(stdout).toContain("ready for paid calls: no");
    expect(stdout).toContain("next actions:");
    expect(stdout).toContain("funding:");
    expect(stdout).toContain("Request Testnet SUI: https://faucet.sui.io");
    expect(stdout).toContain("sui402-pay wallet --balance");
    expect(stdout).toContain("https://faucet.sui.io");
    expect(stdout).toContain("do not rely on `sui client faucet` for Testnet");
    expect(stdout).not.toContain(secretKey);
  });

  it("prints mainnet deposit guidance instead of faucet guidance", async () => {
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout } = await runCli(["wallet"], {
      SUI_SECRET_KEY: secretKey,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:mainnet"
    });
    const status = JSON.parse(stdout);

    expect(status.funding).toMatchObject({
      custody: "user-owned",
      purpose: "sui_gas",
      network: "sui:mainnet",
      address: keypair.toSuiAddress(),
      actions: [
        expect.objectContaining({
          kind: "deposit",
          label: "Deposit Mainnet SUI"
        })
      ]
    });
    expect(status.funding.summary).toContain("For Mainnet gas, fund");
    expect(status.funding.summary).not.toContain("faucet");
    expect(stdout).not.toContain(secretKey);
  });

  it("prints a non-secret setup profile without leaking signer material", async () => {
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout } = await runCli(
      [
        "setup",
        "--print-env",
        "--network",
        "sui:testnet",
        "--marketplace-url",
        "https://console.example.com",
        "--session-package-id",
        "0xsessionpackage",
        "--max-one-shot-amount",
        "1000"
      ],
      {
        SUI_SECRET_KEY: secretKey,
        SUI_MNEMONIC: "",
        SUI402_NETWORK: "sui:devnet"
      }
    );

    expect(stdout).toContain("# Sui402 non-secret agent payment profile");
    expect(stdout).toContain('SUI402_NETWORK="sui:testnet"');
    expect(stdout).toContain('SUI_GRPC_URL="https://fullnode.testnet.sui.io:443"');
    expect(stdout).toContain('SUI402_MARKETPLACE_URL="https://console.example.com/"');
    expect(stdout).toContain('SUI402_SESSION_PACKAGE_ID="0xsessionpackage"');
    expect(stdout).toContain('SUI402_MAX_ONE_SHOT_AMOUNT="1000"');
    expect(stdout).not.toContain(secretKey);
  });

  it("writes a non-secret setup profile and refuses accidental overwrite", async () => {
    const dir = makeTempDir();
    const profilePath = join(dir, "sui402.env");
    const keypair = new Ed25519Keypair();

    const first = await runCli(["setup", "--write-env", profilePath, "--json", "--marketplace-url", "https://console.example.com"], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    });
    const profile = JSON.parse(first.stdout);
    const file = readFileSync(profilePath, "utf8");

    expect(profile).toMatchObject({
      custody: "user-owned",
      path: profilePath,
      variables: {
        SUI402_NETWORK: "sui:testnet",
        SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
        SUI402_MARKETPLACE_URL: "https://console.example.com/"
      }
    });
    expect(file).toContain('SUI402_NETWORK="sui:testnet"');
    expect(file).not.toContain(keypair.getSecretKey());

    const { stderr } = await runCli(["setup", "--write-env", profilePath], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: ""
    }).catch((error: { stderr: string }) => error);
    expect(stderr).toContain("Refusing to overwrite");
  });

  it("discovers a user-owned Sui CLI keystore without leaking key material", async () => {
    const keypair = new Ed25519Keypair();
    const keystoreDir = makeTempDir();
    const keystorePath = join(keystoreDir, "sui.keystore");
    const clientConfigPath = join(keystoreDir, "client.yaml");
    const decoded = decodeSuiPrivateKey(keypair.getSecretKey());
    const keystoreEntry = Buffer.concat([Buffer.from([0]), Buffer.from(decoded.secretKey)]).toString("base64");
    writeFileSync(keystorePath, JSON.stringify([keystoreEntry]), "utf8");
    writeFileSync(
      clientConfigPath,
      `active_address: "${keypair.toSuiAddress()}"\nkeystore: "File: ${keystorePath}"\n`,
      "utf8"
    );

    const { stdout } = await runCli(["wallet"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: "",
      SUI_CLIENT_CONFIG: clientConfigPath,
      SUI_KEYSTORE_PATH: "",
      SUI402_NETWORK: "sui:testnet"
    });
    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      custody: "user-owned",
      signerConfigured: true,
      signerSource: "SUI_CLI_KEYSTORE",
      signerPath: keystorePath,
      address: keypair.toSuiAddress(),
      errors: []
    });
    expect(stdout).not.toContain(keypair.getSecretKey());
    expect(stdout).not.toContain(keystoreEntry);
  });

  it("selects the requested address from a Sui CLI keystore", async () => {
    const first = new Ed25519Keypair();
    const second = new Secp256k1Keypair();
    const keystoreDir = makeTempDir();
    const keystorePath = join(keystoreDir, "sui.keystore");
    writeFileSync(keystorePath, JSON.stringify([suiCliKeystoreEntry(first), suiCliKeystoreEntry(second)]), "utf8");

    const { stdout } = await runCli(["wallet"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: "",
      SUI_KEYSTORE_PATH: keystorePath,
      SUI_ADDRESS: second.toSuiAddress(),
      SUI402_NETWORK: "sui:testnet"
    });
    const status = JSON.parse(stdout);

    expect(status.signerSource).toBe("SUI_CLI_KEYSTORE");
    expect(status.address).toBe(second.toSuiAddress());
    expect(stdout).not.toContain(suiCliKeystoreEntry(first));
    expect(stdout).not.toContain(suiCliKeystoreEntry(second));
  });

  it("accepts a secp256r1 SUI_SECRET_KEY without leaking it", async () => {
    const keypair = new Secp256r1Keypair();
    const secretKey = keypair.getSecretKey();

    const { stdout } = await runCli(["wallet"], {
      SUI_SECRET_KEY: secretKey,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    });
    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      signerConfigured: true,
      signerSource: "SUI_SECRET_KEY",
      address: keypair.toSuiAddress(),
      errors: []
    });
    expect(stdout).not.toContain(secretKey);
  });

  it("reports an invalid SUI_SECRET_KEY specifically without leaking the secret", async () => {
    const invalidSecret = "suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

    const { stdout } = await runCli(["setup", "--check", "--json"], {
      SUI_SECRET_KEY: invalidSecret,
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet"
    });
    const status = JSON.parse(stdout);

    expect(status.signerConfigured).toBe(false);
    expect(status.errors).toEqual(["Invalid SUI_SECRET_KEY: expected a Sui private key exported as suiprivkey..."]);
    expect(stdout).not.toContain(invalidSecret);
  });

  it("reports an invalid SUI_MNEMONIC specifically without leaking the mnemonic", async () => {
    const invalidMnemonic = "not a valid mnemonic sentinel phrase";

    const { stdout } = await runCli(["setup", "--check", "--json"], {
      SUI_SECRET_KEY: "",
      SUI_MNEMONIC: invalidMnemonic,
      SUI402_NETWORK: "sui:testnet"
    });
    const status = JSON.parse(stdout);

    expect(status.signerConfigured).toBe(false);
    expect(status.errors).toEqual(["Invalid SUI_MNEMONIC: expected a valid BIP-39 mnemonic phrase."]);
    expect(stdout).not.toContain(invalidMnemonic);
  });

  it("surfaces invalid signer configuration from wallet instead of the generic missing-wallet error", async () => {
    const invalidSecret = "not-a-valid-sui-secret-key";
    const { stderr } = await execFileAsync(process.execPath, [cliPath, "wallet"], {
      env: {
        ...process.env,
        SUI_SECRET_KEY: invalidSecret,
        SUI_MNEMONIC: "",
        SUI402_NETWORK: "sui:testnet"
      }
    }).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("Invalid SUI_SECRET_KEY");
    expect(stderr).not.toContain("No Sui wallet configured");
    expect(stderr).not.toContain(invalidSecret);
  });

  it("fails closed when curl is session-only but no session package is configured", async () => {
    const keypair = new Ed25519Keypair();
    const { stderr } = await runCli(["curl", "http://127.0.0.1:1/weather", "--session-only"], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: "",
      SUI402_SESSION_PACKAGE_ID: ""
    }).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("--session-only requires SUI402_SESSION_PACKAGE_ID");
  });

  it("requires an explicit one-shot cap before fallback signing", async () => {
    const keypair = new Ed25519Keypair();
    let requests = 0;
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: `0x${"2".repeat(64)}`,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "https://api.example.com/weather",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const url = await startMarketplaceServer((_req, res) => {
      requests += 1;
      res.statusCode = 402;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "payment_required", challenge }));
    });

    const { stderr } = await runCli(["curl", url], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: "",
      SUI402_SESSION_PACKAGE_ID: "",
      SUI402_MAX_ONE_SHOT_AMOUNT: undefined
    }).catch((error: { stderr: string }) => error);

    expect(requests).toBe(1);
    expect(stderr).toContain("One-shot payments require an explicit spend cap before signing.");
    expect(stderr).toContain("Challenge amount: 1000 0x2::sui::SUI on sui:testnet.");
    expect(stderr).toContain("Re-run with --max-one-shot-amount ATOMIC or set SUI402_MAX_ONE_SHOT_AMOUNT.");
  });

  it("waits for signed Sui transactions before returning CLI payment/session results", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    const waitCalls = source.match(/await waitForSubmittedTransaction/g) ?? [];

    expect(waitCalls.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("await client.waitForTransaction({ result });");
    expect(source).toContain("waiting for transaction finality/indexing failed");
  });

  it("simulates Sui transactions before signing local payment/session transactions", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    const preflightCalls = source.match(/await preflightSuiTransaction/g) ?? [];

    expect(preflightCalls.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("transaction.setSenderIfNotSet(signerAddress);");
    expect(source).toContain("await client.simulateTransaction");
    expect(source).toContain("Sui transaction preflight failed before signing");
  });

  it("rejects one-shot fallback above the curl max amount before signing", async () => {
    const keypair = new Ed25519Keypair();
    let requests = 0;
    const challenge = createChallenge(
      {
        network: "sui:testnet",
        recipient: `0x${"2".repeat(64)}`,
        coinType: "0x2::sui::SUI",
        amount: "1001",
        resource: "https://api.example.com/weather",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const url = await startMarketplaceServer((_req, res) => {
      requests += 1;
      res.statusCode = 402;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "payment_required", challenge }));
    });

    const { stderr } = await runCli(["curl", url, "--max-one-shot-amount", "1000"], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: "",
      SUI402_SESSION_PACKAGE_ID: ""
    }).catch((error: { stderr: string }) => error);

    expect(requests).toBe(1);
    expect(stderr).toContain("Sui402 policy rejected payment");
    expect(stderr).toContain("Amount 1001 exceeds policy maximum 1000");
  });

  it("rejects challenge network mismatches before signing", async () => {
    const keypair = new Ed25519Keypair();
    let requests = 0;
    const challenge = createChallenge(
      {
        network: "sui:mainnet",
        recipient: `0x${"2".repeat(64)}`,
        coinType: "0x2::sui::SUI",
        amount: "1000",
        resource: "https://api.example.com/weather",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      "nonce-with-enough-entropy"
    );
    const url = await startMarketplaceServer((_req, res) => {
      requests += 1;
      res.statusCode = 402;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "payment_required", challenge }));
    });

    const { stderr } = await runCli(["curl", url], {
      SUI_SECRET_KEY: keypair.getSecretKey(),
      SUI_MNEMONIC: "",
      SUI402_NETWORK: "sui:testnet",
      SUI402_SESSION_PACKAGE_ID: `0x${"f".repeat(64)}`
    }).catch((error: { stderr: string }) => error);

    expect(requests).toBe(1);
    expect(stderr).toContain("challenge network sui:mainnet does not match local SUI402_NETWORK sui:testnet");
  });

  it("queries the public marketplace endpoint and prints agent-ready commands", async () => {
    const seenUrls: string[] = [];
    const marketplaceUrl = await startMarketplaceServer((req, res) => {
      seenUrls.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          count: 1,
          apis: [
            {
              id: "weather-atlas",
              name: "Weather Atlas",
              description: "Forecasts priced per agent call.",
              transport: "http",
              network: "sui:testnet",
              merchant: "0x123",
              coinType: "0x2::sui::SUI",
              price: "1000",
              resourceScope: "weather.read",
              sessionSupported: true,
              protectedResourceUrl: "http://127.0.0.1:8080/weather",
              sessionManagerUrl: "http://127.0.0.1:8080/sessions",
              tags: ["weather", "agent"],
              status: "active",
              stats: {
                verifiedPayments: 3,
                sessionPayments: 2,
                volume: "3000"
              }
            }
          ]
        })
      );
    });

    const { stdout } = await runCli([
      "search",
      "weather",
      "--network",
      "sui:testnet",
      "--transport",
      "http",
      "--tag",
      "agent",
      "--limit",
      "5"
    ], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(seenUrls).toEqual([
      "/v1/marketplace/apis?q=weather&network=sui%3Atestnet&transport=http&tag=agent&limit=5"
    ]);
    expect(stdout).toContain("Sui402 marketplace:");
    expect(stdout).toContain("weather-atlas  Weather Atlas");
    expect(stdout).toContain("call: sui402-pay curl http://127.0.0.1:8080/weather");
    expect(stdout).toContain("session manager: http://127.0.0.1:8080/sessions");
    expect(stdout).toContain("stats: 3 verified, 2 session, volume 3000");
  });

  it("returns machine-readable search results with the marketplace URL", async () => {
    const marketplaceUrl = await startMarketplaceServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ count: 0, apis: [] }));
    });

    const { stdout } = await runCli(["search", "--json"], {
      SUI402_CONSOLE_API_URL: marketplaceUrl
    });

    expect(JSON.parse(stdout)).toEqual({
      marketplaceUrl: `${marketplaceUrl}/`,
      count: 0,
      apis: []
    });
  });

  it("looks up marketplace API details and prints agent-ready commands", async () => {
    const seenUrls: string[] = [];
    const marketplaceUrl = await startMarketplaceServer((req, res) => {
      seenUrls.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          schemaVersion: "sui402.marketplace.api.v1",
          api: {
            id: "atlas-api",
            name: "Atlas API",
            description: "Market data priced per agent call.",
            transport: "http",
            network: "sui:testnet",
            merchant: "0x123",
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:market-feed",
            sessionSupported: true,
            protectedResourceUrl: "http://127.0.0.1:8080/atlas",
            sessionManagerUrl: "http://127.0.0.1:8080/sessions",
            tags: ["market", "agent"],
            status: "active",
            stats: {
              verifiedPayments: 1,
              sessionPayments: 0,
              volume: "1000"
            },
            reliability: {
              paidTestObserved: true,
              verifiedPayments: 1,
              sessionPayments: 0,
              oneShotPayments: 1,
              recentIndexedPayments: 1,
              firstVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
              lastVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
              evidenceWindow: {
                from: "2026-05-19T00:00:00.000Z",
                to: "2026-05-19T00:00:00.000Z",
                payments: 1
              },
              notes: ["Verified payment records exist in the public scan index."]
            }
          },
          readiness: {
            ready: true,
            level: "ready",
            reasons: [],
            checks: [
              { name: "listing_active", ok: true, message: "Listing is active" },
              { name: "paid_test_evidence", ok: true, message: "Verified paid evidence exists" }
            ]
          },
          trust: {
            listingPublished: true,
            merchantPublished: true,
            upstreamConfigured: true,
            sessionsEnabled: true
          },
          commands: {
            curl: "sui402-pay curl http://127.0.0.1:8080/atlas",
            search: "sui402-pay search Atlas API",
            scan: "sui402-pay scan merchant atlas-api"
          },
          stats: {
            verifiedPayments: 1,
            sessionPayments: 0,
            volume: "1000"
          },
          reliability: {
            paidTestObserved: true,
            verifiedPayments: 1,
            sessionPayments: 0,
            oneShotPayments: 1,
            recentIndexedPayments: 1,
            firstVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
            lastVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
            evidenceWindow: {
              from: "2026-05-19T00:00:00.000Z",
              to: "2026-05-19T00:00:00.000Z",
              payments: 1
            },
            notes: ["Verified payment records exist in the public scan index."]
          },
          recentPayments: [
            {
              digest: "digest-atlas-1",
              kind: "one-shot",
              amount: "1000",
              coinType: "0x2::sui::SUI",
              resource: "api:market-feed"
            }
          ]
        })
      );
    });

    const { stdout } = await runCli(["marketplace", "detail", "atlas-api"], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(seenUrls).toEqual(["/v1/marketplace/apis/atlas-api"]);
    expect(stdout).toContain("Sui402 marketplace API:");
    expect(stdout).toContain("atlas-api  Atlas API");
    expect(stdout).toContain("call: sui402-pay curl http://127.0.0.1:8080/atlas");
    expect(stdout).toContain("search: sui402-pay search Atlas API");
    expect(stdout).toContain("scan: sui402-pay scan merchant atlas-api");
    expect(stdout).toContain("Agent safety");
    expect(stdout).toContain("verdict: ready for bounded paid calls");
    expect(stdout).toContain("reliability: paid evidence observed, 1 recent public record(s)");
    expect(stdout).toContain("last verified payment: 2026-05-19T00:00:00.000Z");
    expect(stdout).toContain("Use `sui402-pay curl http://127.0.0.1:8080/atlas --max-one-shot-amount 1000`");
    expect(stdout).toContain("protected access configured: yes");
    expect(stdout).toContain("digest-atlas-1");
  });

  it("returns machine-readable marketplace API detail", async () => {
    const marketplaceUrl = await startMarketplaceServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          api: {
            id: "atlas-api",
            name: "Atlas API",
            transport: "http",
            network: "sui:testnet",
            merchant: "0x123",
            coinType: "0x2::sui::SUI",
            price: "1000",
            resourceScope: "api:market-feed",
            sessionSupported: false,
            tags: [],
            status: "active"
          },
          trust: {
            listingPublished: true
          },
          reliability: {
            paidTestObserved: false,
            verifiedPayments: 0,
            sessionPayments: 0,
            oneShotPayments: 0,
            recentIndexedPayments: 0,
            notes: ["No verified paid-call evidence has been indexed for this listing yet."]
          },
          recentPayments: []
        })
      );
    });

    const { stdout } = await runCli(["marketplace", "api", "atlas-api", "--json"], {
      SUI402_CONSOLE_API_URL: marketplaceUrl
    });

    expect(JSON.parse(stdout)).toMatchObject({
      marketplaceUrl: `${marketplaceUrl}/`,
      agentSafety: {
        shouldAutoPay: false,
        level: "unknown",
        summary: "Marketplace readiness is not proven; agents should not pay automatically.",
        reasons: expect.arrayContaining([
          "No protected resource URL is published for direct paid calls.",
          "Marketplace did not provide a readiness verdict; fail closed for autonomous payments.",
          "No verified paid-call evidence is indexed for this listing yet.",
          "Marketplace reliability says no verified paid-test evidence is indexed for this listing yet."
        ])
      },
      detail: {
        api: {
          id: "atlas-api"
        },
        trust: {
          listingPublished: true
        }
      }
    });
  });

  it("prints a session open plan without requiring a signer", async () => {
    const { stdout } = await runCli(
      [
        "session",
        "open",
        "--package-id",
        `0x${"1".repeat(64)}`,
        "--merchant",
        `0x${"2".repeat(64)}`,
        "--resource",
        "https://api.example.com/weather",
        "--max-per-request",
        "1000",
        "--funding",
        "10000",
        "--json"
      ],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    );
    const plan = JSON.parse(stdout);

    expect(plan).toMatchObject({
      mode: "plan",
      action: "open",
      custody: "user-owned",
      signerRequired: true,
      requiresConfirmation: true,
      confirmed: false,
      details: {
        resource: "https://api.example.com/weather",
        maxPerRequest: "1000",
        funding: "10000 SUI",
        budget: "10000 SUI locked in this user-owned session",
        maxFullRequestsAtCap: "10",
        unusedRemainderAtCap: "0"
      }
    });
    expect(plan.details.expiresAt).toEqual(expect.any(String));
    expect(plan.details.resourceScopeHash).toEqual(expect.any(String));
  });

  it("prints session fund and close plans before submitting transactions", async () => {
    const fund = await runCli(
      ["session", "fund", "--package-id", `0x${"1".repeat(64)}`, "--session-id", `0x${"3".repeat(64)}`, "--funding", "2500"],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    );
    const close = await runCli(
      ["session", "close", "--package-id", `0x${"1".repeat(64)}`, "--session-id", `0x${"3".repeat(64)}`, "--json"],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    );

    expect(fund.stdout).toContain("Sui402 session fund plan");
    expect(fund.stdout).toContain("budgetDelta: adds 2500 SUI to the session");
    expect(fund.stdout).toContain("Rerun with --yes to submit this transaction.");
    expect(JSON.parse(close.stdout)).toMatchObject({
      mode: "plan",
      action: "close",
      confirmed: false,
      details: {
        sessionId: `0x${"3".repeat(64)}`
      }
    });
  });

  it("rejects invalid session scope hashes before signing", async () => {
    const { stderr } = await runCli(
      [
        "session",
        "open",
        "--package-id",
        `0x${"1".repeat(64)}`,
        "--merchant",
        `0x${"2".repeat(64)}`,
        "--resource-scope-hash",
        "abc123",
        "--max-per-request",
        "1000",
        "--funding",
        "10000"
      ],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    ).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("--resource-scope-hash must be a 32-byte SHA-256 hash");
  });

  it("rejects expired session opens before signing", async () => {
    const { stderr } = await runCli(
      [
        "session",
        "open",
        "--package-id",
        `0x${"1".repeat(64)}`,
        "--merchant",
        `0x${"2".repeat(64)}`,
        "--resource",
        "https://api.example.com/weather",
        "--max-per-request",
        "1000",
        "--funding",
        "10000",
        "--expires-ms",
        "1"
      ],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    ).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("--expires-ms must resolve to a future Unix timestamp in milliseconds");
  });

  it("rejects session amounts above u64 before signing", async () => {
    const { stderr } = await runCli(
      [
        "session",
        "fund",
        "--package-id",
        `0x${"1".repeat(64)}`,
        "--session-id",
        `0x${"3".repeat(64)}`,
        "--funding",
        "18446744073709551616"
      ],
      {
        SUI_SECRET_KEY: "",
        SUI_MNEMONIC: ""
      }
    ).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("--funding must be a positive u64 integer");
  });

  it("looks up public scan payment details", async () => {
    const seenUrls: string[] = [];
    const marketplaceUrl = await startMarketplaceServer((req, res) => {
      seenUrls.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          digest: "digest-atlas-1",
          network: "sui:testnet",
          kind: "one-shot",
          merchantId: "atlas-api",
          recipient: "0x123",
          coinType: "0x2::sui::SUI",
          amount: "1000",
          resource: "api:market-feed",
          createdAt: "2026-05-19T00:00:00.000Z"
        })
      );
    });

    const { stdout } = await runCli(["scan", "payment", "digest-atlas-1"], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(seenUrls).toEqual(["/v1/scan/payments/digest-atlas-1"]);
    expect(stdout).toContain("Sui402 scan payment:");
    expect(stdout).toContain("digest: digest-atlas-1");
    expect(stdout).toContain("merchant id: atlas-api");
    expect(stdout).toContain("resource: api:market-feed");
  });

  it("looks up public scan merchant details as JSON", async () => {
    const marketplaceUrl = await startMarketplaceServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          merchant: {
            id: "atlas-api",
            service: "Atlas API",
            network: "sui:testnet",
            sessionsEnabled: true
          },
          stats: {
            verifiedPayments: 1,
            sessionPayments: 0,
            volume: "1000"
          },
          recentPayments: []
        })
      );
    });

    const { stdout } = await runCli(["scan", "merchant", "atlas-api", "--json"], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(JSON.parse(stdout)).toMatchObject({
      marketplaceUrl: `${marketplaceUrl}/`,
      kind: "merchant",
      record: {
        merchant: {
          id: "atlas-api"
        },
        stats: {
          verifiedPayments: 1
        }
      }
    });
  });

  it("looks up public scan session details", async () => {
    const marketplaceUrl = await startMarketplaceServer((req, res) => {
      expect(req.url).toBe("/v1/scan/sessions/0xsession");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          sessionId: "0xsession",
          network: "sui:testnet",
          coinType: "0x2::sui::SUI",
          payerHash: "sha256:payerhash",
          merchant: "0xmerchant",
          spendCount: 1,
          spentAmount: "1000",
          lastTxDigest: "session-spend-digest-1",
          resourceScopeHashes: ["abc"],
          spends: [
            {
              txDigest: "session-spend-digest-1",
              amount: "1000",
              challengeId: "challenge-1"
            }
          ]
        })
      );
    });

    const { stdout } = await runCli(["scan", "session", "0xsession"], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(stdout).toContain("Sui402 scan session:");
    expect(stdout).toContain("session: 0xsession");
    expect(stdout).toContain("payer hash: sha256:payerhash");
    expect(stdout).toContain("spends: 1");
    expect(stdout).toContain("last tx: session-spend-digest-1");
  });

  it("looks up public scan settlement details", async () => {
    const marketplaceUrl = await startMarketplaceServer((req, res) => {
      expect(req.url).toBe("/v1/scan/settlements/settlement-digest-1");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "settlement-digest-1:0",
          txDigest: "settlement-digest-1",
          network: "sui:testnet",
          kind: "receipt",
          ledgerId: "0xledger",
          receiptId: "receipt-1",
          merchant: "0xmerchant",
          amount: "1000",
          submitter: "0xsubmitter",
          indexedAt: "2026-05-19T00:00:00.000Z"
        })
      );
    });

    const { stdout } = await runCli(["scan", "settlement", "settlement-digest-1"], {
      SUI402_MARKETPLACE_URL: marketplaceUrl
    });

    expect(stdout).toContain("Sui402 scan settlement:");
    expect(stdout).toContain("tx: settlement-digest-1");
    expect(stdout).toContain("receipt: receipt-1");
    expect(stdout).toContain("amount: 1000");
  });

  it("rejects limits above the console marketplace cap before making a request", async () => {
    const { stderr } = await execFileAsync(process.execPath, [cliPath, "search", "--limit", "101"], {
      env: {
        ...process.env,
        SUI402_MARKETPLACE_URL: "http://127.0.0.1:9"
      }
    }).catch((error: { stderr: string }) => error);

    expect(stderr).toContain("--limit must be 100 or less");
  });
});

async function startMarketplaceServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sui402-pay-"));
  tempDirs.push(dir);
  return dir;
}

function suiCliKeystoreEntry(keypair: Ed25519Keypair | Secp256k1Keypair | Secp256r1Keypair): string {
  const decoded = decodeSuiPrivateKey(keypair.getSecretKey());
  return Buffer.concat([Buffer.from([schemeFlag(decoded.scheme)]), Buffer.from(decoded.secretKey)]).toString("base64");
}

function schemeFlag(scheme: string): number {
  if (scheme === "ED25519") {
    return 0;
  }
  if (scheme === "Secp256k1") {
    return 1;
  }
  if (scheme === "Secp256r1") {
    return 2;
  }

  throw new Error(`Unsupported test scheme: ${scheme}`);
}

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SUI_CLIENT_CONFIG: join(tmpdir(), "sui402-pay-missing-client.yaml"),
    SUI_KEYSTORE_PATH: join(tmpdir(), "sui402-pay-missing.keystore")
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[key];
    } else {
      childEnv[key] = value;
    }
  }

  return execFileAsync(process.execPath, [cliPath, ...args], {
    env: childEnv
  });
}
