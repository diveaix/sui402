#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Sui402NetworkSchema } from "@sui402/protocol";

const SuiAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Expected a 32-byte Sui address");
const ToolNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Expected an MCP-safe tool name");
const AmountSchema = z.string().regex(/^\d+$/, "Expected a whole-number amount in base units");

const ClientTargetSchema = z.enum(["claude", "cursor", "generic"]);

export type McpClientTarget = z.infer<typeof ClientTargetSchema>;

export type RenderMcpClientConfigOptions = {
  serverName: string;
  command?: string;
  args?: string[];
  env: Record<string, string | undefined>;
};

export type RenderSui402McpClientConfigOptions = {
  target?: McpClientTarget;
  serverName?: string;
  command?: string;
  args?: string[];
  merchantAddress: string;
  price: string;
  network?: string;
  coinType?: string;
  challengeTtlSeconds?: string;
  sessionPackageId?: string;
  toolName?: string;
  toolTitle?: string;
  toolDescription?: string;
  responseJson?: string;
  toolsJson?: string;
  redisUrl?: string;
  postgresUrl?: string;
  paymentRecordTable?: string;
  runStorageMigrations?: string;
};

export function renderMcpClientConfig(options: RenderMcpClientConfigOptions): string {
  const env = Object.fromEntries(
    Object.entries(options.env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return `${JSON.stringify(
    {
      mcpServers: {
        [options.serverName]: {
          command: options.command ?? "sui402-mcp",
          args: options.args ?? [],
          env
        }
      }
    },
    null,
    2
  )}\n`;
}

export function renderSui402McpClientConfig(options: RenderSui402McpClientConfigOptions): string {
  const normalized = normalizeSui402Options(options);
  return renderMcpClientConfig({
    serverName: normalized.serverName,
    command: normalized.command,
    args: normalized.args,
    env: {
      NODE_ENV: normalized.redisUrl && normalized.postgresUrl ? "production" : "development",
      SUI402_NETWORK: normalized.network,
      SUI402_MERCHANT_ADDRESS: normalized.merchantAddress,
      SUI402_COIN_TYPE: normalized.coinType,
      SUI402_PRICE: normalized.price,
      SUI402_CHALLENGE_TTL_SECONDS: normalized.challengeTtlSeconds,
      SUI402_SESSION_PACKAGE_ID: normalized.sessionPackageId,
      SUI402_MCP_SERVER_NAME: normalized.serverName,
      SUI402_MCP_TOOL_NAME: normalized.toolName,
      SUI402_MCP_TOOL_TITLE: normalized.toolTitle,
      SUI402_MCP_TOOL_DESCRIPTION: normalized.toolDescription,
      SUI402_MCP_RESPONSE_JSON: normalized.responseJson,
      SUI402_MCP_TOOLS_JSON: normalized.toolsJson,
      SUI402_REDIS_URL: normalized.redisUrl,
      SUI402_POSTGRES_URL: normalized.postgresUrl,
      SUI402_PAYMENT_RECORD_TABLE: normalized.paymentRecordTable,
      SUI402_RUN_STORAGE_MIGRATIONS: normalized.runStorageMigrations
    }
  });
}

function normalizeSui402Options(options: RenderSui402McpClientConfigOptions): Required<
  Pick<
    RenderSui402McpClientConfigOptions,
    | "target"
    | "serverName"
    | "command"
    | "args"
    | "merchantAddress"
    | "price"
    | "network"
    | "coinType"
    | "challengeTtlSeconds"
    | "toolName"
    | "toolDescription"
    | "responseJson"
    | "paymentRecordTable"
    | "runStorageMigrations"
  >
> &
  Omit<
    RenderSui402McpClientConfigOptions,
    | "target"
    | "serverName"
    | "command"
    | "args"
    | "merchantAddress"
    | "price"
    | "network"
    | "coinType"
    | "challengeTtlSeconds"
    | "toolName"
    | "toolDescription"
    | "responseJson"
    | "paymentRecordTable"
    | "runStorageMigrations"
  > {
  const target = ClientTargetSchema.parse(options.target ?? "generic");
  return {
    target,
    serverName: options.serverName ?? "sui402-paid-tools",
    command: options.command ?? "sui402-mcp",
    args: options.args ?? [],
    merchantAddress: SuiAddressSchema.parse(options.merchantAddress),
    price: AmountSchema.parse(options.price),
    network: Sui402NetworkSchema.parse(options.network ?? "sui:testnet"),
    coinType: options.coinType ?? "0x2::sui::SUI",
    challengeTtlSeconds: options.challengeTtlSeconds ?? "300",
    sessionPackageId: options.sessionPackageId,
    toolName: ToolNameSchema.parse(options.toolName ?? "paid_resource"),
    toolTitle: options.toolTitle,
    toolDescription: options.toolDescription ?? "Sui402 protected MCP tool",
    responseJson: requireJsonString(options.responseJson ?? '{"ok":true,"paid":true}', "response-json"),
    toolsJson: options.toolsJson === undefined ? undefined : requireJsonString(options.toolsJson, "tools-json"),
    redisUrl: options.redisUrl,
    postgresUrl: options.postgresUrl,
    paymentRecordTable: options.paymentRecordTable ?? "sui402_payment_records",
    runStorageMigrations: options.runStorageMigrations ?? "false"
  };
}

function requireJsonString(value: string, name: string): string {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`--${name} must be valid JSON`);
  }

  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.merchantAddress || !args.price) {
    console.error("Missing required --merchant and --price");
    printHelp();
    process.exit(1);
  }

  const config = renderSui402McpClientConfig(args as RenderSui402McpClientConfigOptions);
  if (args.out) {
    await writeFile(args.out, config, { flag: args.force ? "w" : "wx" });
    console.log(`Wrote MCP client config to ${args.out}`);
    return;
  }

  process.stdout.write(config);
}

function parseArgs(args: string[]): Partial<RenderSui402McpClientConfigOptions> & {
  out?: string;
  force?: boolean;
  help?: boolean;
} {
  const parsed: ReturnType<typeof parseArgs> = { args: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    const value = args[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--target") parsed.target = ClientTargetSchema.parse(value);
    else if (arg === "--server-name") parsed.serverName = value;
    else if (arg === "--command") parsed.command = value;
    else if (arg === "--arg") parsed.args?.push(value);
    else if (arg === "--merchant") parsed.merchantAddress = value;
    else if (arg === "--price") parsed.price = value;
    else if (arg === "--network") parsed.network = value;
    else if (arg === "--coin-type") parsed.coinType = value;
    else if (arg === "--challenge-ttl-seconds") parsed.challengeTtlSeconds = value;
    else if (arg === "--session-package-id") parsed.sessionPackageId = value;
    else if (arg === "--tool-name") parsed.toolName = value;
    else if (arg === "--tool-title") parsed.toolTitle = value;
    else if (arg === "--tool-description") parsed.toolDescription = value;
    else if (arg === "--response-json") parsed.responseJson = value;
    else if (arg === "--tools-json") parsed.toolsJson = value;
    else if (arg === "--redis-url") parsed.redisUrl = value;
    else if (arg === "--postgres-url") parsed.postgresUrl = value;
    else if (arg === "--payment-record-table") parsed.paymentRecordTable = value;
    else if (arg === "--run-storage-migrations") parsed.runStorageMigrations = value;
    else if (arg === "--out") parsed.out = value;
    else throw new Error(`Unknown argument ${arg}`);
    index += 1;
  }

  return parsed;
}

function printHelp(): void {
  console.log(`sui402-mcp-config --merchant <0x...> --price <amount>

Prints an MCP client config JSON object with a sui402-mcp server entry.

Options:
  --target <target>                  claude, cursor, or generic
  --server-name <name>               MCP server key, default sui402-paid-tools
  --command <command>                command clients should run, default sui402-mcp
  --arg <arg>                        command argument, repeatable
  --merchant <0x...>                 merchant Sui address
  --price <amount>                   default tool price in base units
  --network <network>                default sui:testnet
  --coin-type <coinType>             default 0x2::sui::SUI
  --session-package-id <id>          enable session spend verification
  --tool-name <name>                 single-tool mode name
  --tool-description <text>          single-tool mode description
  --response-json <json>             single-tool mode response payload
  --tools-json <json>                multi-tool JSON array for SUI402_MCP_TOOLS_JSON
  --redis-url <url>                  production challenge storage
  --postgres-url <url>               production payment ledger storage
  --out <path>                       write output file instead of printing
  --force                            overwrite --out path
`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
