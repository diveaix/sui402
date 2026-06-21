#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Sui402NetworkSchema, resourceScopeHash, type Sui402Network } from "@sui402/protocol";

export type ScaffoldOptions = {
  name: string;
  merchant: string;
  price: string;
  network?: Sui402Network;
  coinType?: string;
  resourceScope?: string;
  sessionPackageId?: string;
};

export type ScaffoldFile = {
  path: string;
  contents: string;
};

export function renderProviderScaffold(options: ScaffoldOptions): ScaffoldFile[] {
  const normalized = normalizeOptions(options);
  return [
    {
      path: "package.json",
      contents: renderPackageJson(normalized)
    },
    {
      path: "tsconfig.json",
      contents: renderTsconfig()
    },
    {
      path: ".env.example",
      contents: renderEnv(normalized)
    },
    {
      path: "src/server.ts",
      contents: renderServer()
    },
    {
      path: "README.md",
      contents: renderReadme(normalized)
    }
  ];
}

export async function createProviderScaffold(targetDir: string, options: ScaffoldOptions): Promise<ScaffoldFile[]> {
  const files = renderProviderScaffold(options);
  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "src"), { recursive: true });

  for (const file of files) {
    await writeFile(join(targetDir, file.path), file.contents, { flag: "wx" });
  }

  return files;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.dir) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!args.merchant || !args.price) {
    console.error("Missing required --merchant and --price");
    printHelp();
    process.exit(1);
  }

  const files = await createProviderScaffold(args.dir, {
    name: args.name ?? "sui402-provider",
    merchant: args.merchant,
    price: args.price,
    network: args.network,
    coinType: args.coinType,
    resourceScope: args.resourceScope,
    sessionPackageId: args.sessionPackageId
  });

  console.log(`Created Sui402 provider scaffold in ${args.dir}`);
  for (const file of files) {
    console.log(`- ${file.path}`);
  }
}

function normalizeOptions(options: ScaffoldOptions): Required<Omit<ScaffoldOptions, "sessionPackageId">> & {
  sessionPackageId?: string;
} {
  return {
    name: options.name,
    merchant: options.merchant,
    price: options.price,
    network: Sui402NetworkSchema.parse(options.network ?? "sui:testnet"),
    coinType: options.coinType ?? "0x2::sui::SUI",
    resourceScope: options.resourceScope ?? "api:*",
    sessionPackageId: options.sessionPackageId
  };
}

function renderPackageJson(options: ReturnType<typeof normalizeOptions>): string {
  return `${JSON.stringify(
    {
      name: options.name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "tsx src/server.ts",
        build: "tsc -p tsconfig.json",
        start: "node dist/server.js"
      },
      dependencies: {
        "@sui402/provider-api": "0.1.0"
      },
      devDependencies: {
        tsx: "^4.22.2",
        typescript: "^5.9.3"
      }
    },
    null,
    2
  )}\n`;
}

function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: "dist",
        rootDir: "src"
      },
      include: ["src/**/*.ts"]
    },
    null,
    2
  )}\n`;
}

function renderEnv(options: ReturnType<typeof normalizeOptions>): string {
  const lines = [
    `SUI402_NETWORK=${options.network}`,
    `SUI402_MERCHANT_ADDRESS=${options.merchant}`,
    `SUI402_COIN_TYPE=${options.coinType}`,
    `SUI402_PRICE=${options.price}`,
    `SUI402_RESOURCE_SCOPE=${options.resourceScope}`,
    `SUI402_RESOURCE_SCOPE_HASH=${resourceScopeHash(options.resourceScope)}`,
    "SUI402_CHALLENGE_TTL_SECONDS=300",
    "SUI402_SERVICE_NAME=sui402-provider-api",
    "SUI402_REDIS_URL=",
    "SUI402_POSTGRES_URL=",
    "SUI402_RUN_STORAGE_MIGRATIONS=false",
    "SUI402_ADMIN_API_KEY=",
    "PORT=4020"
  ];

  if (options.sessionPackageId) {
    lines.push(`SUI402_SESSION_PACKAGE_ID=${options.sessionPackageId}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderServer(): string {
  return `import { createProviderApp, createProviderStorage, loadProviderConfig } from "@sui402/provider-api";

const config = loadProviderConfig();
const storage = await createProviderStorage(config);
const app = createProviderApp(config, {
  challengeStore: storage.challengeStore,
  paymentRecords: storage.paymentRecords,
  rateLimiter: storage.rateLimiter
});

const server = app.listen(config.PORT, () => {
  console.log(\`\${config.SUI402_SERVICE_NAME} listening on http://localhost:\${config.PORT}\`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await storage.close();
      process.exit(0);
    });
  });
}
`;
}

function renderReadme(options: ReturnType<typeof normalizeOptions>): string {
  return `# ${options.name}

Sui402 provider scaffold.

## Start

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

## Discovery

\`\`\`text
GET http://localhost:4020/.well-known/sui402
\`\`\`

## Protected Resource

\`\`\`text
GET http://localhost:4020/v1/entitlements/current
\`\`\`
`;
}

function parseArgs(args: string[]): {
  dir?: string;
  name?: string;
  merchant?: string;
  price?: string;
  network?: Sui402Network;
  coinType?: string;
  resourceScope?: string;
  sessionPackageId?: string;
  help?: boolean;
} {
  const parsed: ReturnType<typeof parseArgs> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("--") && !parsed.dir) {
      parsed.dir = arg;
      continue;
    }

    const value = args[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--name") parsed.name = value;
    else if (arg === "--merchant") parsed.merchant = value;
    else if (arg === "--price") parsed.price = value;
    else if (arg === "--network") parsed.network = Sui402NetworkSchema.parse(value);
    else if (arg === "--coin-type") parsed.coinType = value;
    else if (arg === "--resource-scope") parsed.resourceScope = value;
    else if (arg === "--session-package-id") parsed.sessionPackageId = value;
    else throw new Error(`Unknown argument ${arg}`);
    index += 1;
  }

  return parsed;
}

function printHelp(): void {
  console.log(`create-sui402 <dir> --merchant <0x...> --price <amount>

Options:
  --name <name>                 package name
  --network <network>           sui:testnet, sui:mainnet, sui:devnet, sui:localnet
  --coin-type <coinType>        default 0x2::sui::SUI
  --resource-scope <scope>      default api:*
  --session-package-id <id>     enable payment sessions
`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
