import { z } from "zod";
import { Sui402NetworkSchema } from "@sui402/protocol";

const SuiAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Expected a 32-byte Sui address");
const ToolNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Expected an MCP-safe tool name");
const AmountSchema = z.string().regex(/^\d+$/);
const ToolDefinitionSchema = z.object({
  name: ToolNameSchema,
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  amount: AmountSchema.optional(),
  coinType: z.string().min(1).optional(),
  responseJson: z.unknown().optional()
});

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUI402_NETWORK: Sui402NetworkSchema.default("sui:testnet"),
  SUI402_GRPC_URL: z.string().url().optional(),
  SUI402_MERCHANT_ADDRESS: SuiAddressSchema,
  SUI402_COIN_TYPE: z.string().min(1).default("0x2::sui::SUI"),
  SUI402_PRICE: AmountSchema,
  SUI402_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SUI402_SESSION_PACKAGE_ID: SuiAddressSchema.optional(),
  SUI402_MCP_SERVER_NAME: z.string().min(1).default("sui402-paid-tools"),
  SUI402_MCP_TOOL_NAME: ToolNameSchema.default("paid_resource"),
  SUI402_MCP_TOOL_TITLE: z.string().min(1).optional(),
  SUI402_MCP_TOOL_DESCRIPTION: z.string().min(1).default("Sui402 protected MCP tool"),
  SUI402_MCP_RESPONSE_JSON: z.string().min(1).default('{"ok":true,"paid":true}'),
  SUI402_MCP_TOOLS_JSON: z.string().min(1).optional(),
  SUI402_REDIS_URL: z.string().url().optional(),
  SUI402_POSTGRES_URL: z.string().url().optional(),
  SUI402_PAYMENT_RECORD_TABLE: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).default("sui402_payment_records"),
  SUI402_RUN_STORAGE_MIGRATIONS: z.coerce.boolean().default(false)
});

export type McpConfig = z.infer<typeof EnvironmentSchema>;
export type McpToolDefinition = z.infer<typeof ToolDefinitionSchema> & {
  amount: string;
  coinType: string;
  description: string;
  responseJson: unknown;
};

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return EnvironmentSchema.parse(env);
}

export function loadMcpToolDefinitions(config: McpConfig): McpToolDefinition[] {
  const tools = config.SUI402_MCP_TOOLS_JSON
    ? parseToolsJson(config.SUI402_MCP_TOOLS_JSON).map((tool) => ({
        ...tool,
        amount: tool.amount ?? config.SUI402_PRICE,
        coinType: tool.coinType ?? config.SUI402_COIN_TYPE,
        description: tool.description ?? config.SUI402_MCP_TOOL_DESCRIPTION,
        responseJson: tool.responseJson ?? { ok: true, paid: true, tool: tool.name }
      }))
    : [
        {
          name: config.SUI402_MCP_TOOL_NAME,
          title: config.SUI402_MCP_TOOL_TITLE,
          description: config.SUI402_MCP_TOOL_DESCRIPTION,
          amount: config.SUI402_PRICE,
          coinType: config.SUI402_COIN_TYPE,
          responseJson: parseJson(config.SUI402_MCP_RESPONSE_JSON, "SUI402_MCP_RESPONSE_JSON")
        }
      ];

  assertUniqueToolNames(tools);
  return tools;
}

function parseToolsJson(value: string): Array<z.infer<typeof ToolDefinitionSchema>> {
  const parsed = parseJson(value, "SUI402_MCP_TOOLS_JSON");
  const result = z.array(ToolDefinitionSchema).min(1).safeParse(parsed);
  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

function assertUniqueToolNames(tools: Array<{ name: string }>): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    }
    names.add(tool.name);
  }
}
