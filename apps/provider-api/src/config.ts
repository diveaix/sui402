import { z } from "zod";
import { Sui402NetworkSchema } from "@sui402/protocol";

const SuiAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Expected a 32-byte Sui address");

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4020),
  SUI402_NETWORK: Sui402NetworkSchema.default("sui:testnet"),
  SUI402_GRPC_URL: z.string().url().optional(),
  SUI402_MERCHANT_ADDRESS: SuiAddressSchema,
  SUI402_COIN_TYPE: z.string().min(1).default("0x2::sui::SUI"),
  SUI402_PRICE: z.string().regex(/^\d+$/),
  SUI402_SESSION_PACKAGE_ID: SuiAddressSchema.optional(),
  SUI402_RESOURCE_SCOPE: z.string().min(1).default("api:*"),
  SUI402_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SUI402_SERVICE_NAME: z.string().min(1).default("sui402-provider-api"),
  SUI402_REDIS_URL: z.string().url().optional(),
  SUI402_POSTGRES_URL: z.string().url().optional(),
  SUI402_PAYMENT_RECORD_TABLE: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).default("sui402_payment_records"),
  SUI402_RUN_STORAGE_MIGRATIONS: z.coerce.boolean().default(false),
  SUI402_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SUI402_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  SUI402_ADMIN_API_KEY: z.string().min(16).optional(),
  SUI402_ADMIN_MAX_PAYMENTS: z.coerce.number().int().positive().max(1000).default(100),
  SUI402_RECEIPT_SIGNER_PROVIDER: z.enum(["local", "external"]).default("local"),
  SUI402_RECEIPT_SIGNER_ID: z.string().min(1).optional(),
  SUI402_RECEIPT_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: z.string().min(1).optional(),
  SUI402_RECEIPT_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60)
});

export type ProviderConfig = z.infer<typeof EnvironmentSchema>;

export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const config = EnvironmentSchema.parse(env);
  if (
    config.SUI402_RECEIPT_SIGNER_ID &&
    config.SUI402_RECEIPT_SIGNER_PROVIDER === "local" &&
    !config.SUI402_RECEIPT_PRIVATE_KEY_PEM &&
    !config.SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64
  ) {
    throw new Error("Local receipt signing requires SUI402_RECEIPT_PRIVATE_KEY_PEM or SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64");
  }

  return config;
}
