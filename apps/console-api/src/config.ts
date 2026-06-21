import { z } from "zod";
import { parseConsoleOperatorKeys, parseConsoleSellerKeys } from "./auth.js";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4030),
  SUI402_CONSOLE_ADMIN_API_KEY: z.string().min(16).optional(),
  SUI402_CONSOLE_OPERATOR_KEYS_JSON: z.string().min(1).optional(),
  SUI402_CONSOLE_SELLER_KEYS_JSON: z.string().min(1).optional(),
  SUI402_CONSOLE_OIDC_ISSUER: z.string().min(1).optional(),
  SUI402_CONSOLE_OIDC_AUDIENCE: z.string().min(1).optional(),
  SUI402_CONSOLE_OIDC_JWKS_URL: z.string().url().optional(),
  SUI402_CONSOLE_OIDC_ROLE_CLAIM: z.string().min(1).default("roles"),
  SUI402_CONSOLE_OIDC_SUBJECT_CLAIM: z.string().min(1).default("sub"),
  SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM: z.string().min(1).default("merchant_ids"),
  SUI402_CONSOLE_PROVIDER_BASE_URL: z.string().url().default("http://localhost:4030"),
  SUI402_CONSOLE_CORS_ORIGINS: z.string().min(1).optional(),
  SUI402_CONSOLE_MAINNET_GRPC_URL: z.string().url().optional(),
  SUI402_CONSOLE_TESTNET_GRPC_URL: z.string().url().optional(),
  SUI402_CONSOLE_DEVNET_GRPC_URL: z.string().url().optional(),
  SUI402_CONSOLE_LOCALNET_GRPC_URL: z.string().url().optional(),
  SUI402_CONSOLE_STORAGE_DRIVER: z.enum(["memory", "file", "postgres"]).default("memory"),
  SUI402_CONSOLE_FILE_STORE_PATH: z.string().min(1).default(".sui402/console-store.json"),
  SUI402_CONSOLE_POSTGRES_URL: z.string().url().optional(),
  SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS: z.coerce.boolean().default(false),
  SUI402_CONSOLE_MERCHANT_TABLE: z.string().min(1).default("sui402_console_merchants"),
  SUI402_CONSOLE_LISTING_TABLE: z.string().min(1).default("sui402_console_listings"),
  SUI402_CONSOLE_CHALLENGE_TABLE: z.string().min(1).default("sui402_challenges"),
  SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE: z.string().min(1).default("sui402_consumed_challenges"),
  SUI402_CONSOLE_PAYMENT_RECORD_TABLE: z.string().min(1).default("sui402_payment_records"),
  SUI402_CONSOLE_SESSION_SPEND_TABLE: z.string().min(1).default("sui402_session_spend_events"),
  SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE: z.string().min(1).default("sui402_settlement_events"),
  SUI402_CONSOLE_INDEXER_CURSOR_TABLE: z.string().min(1).default("sui402_indexer_cursors"),
  SUI402_CONSOLE_EXPORT_TABLE: z.string().min(1).default("sui402_console_exports"),
  SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE: z.string().min(1).default("sui402_merchant_applications"),
  SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE: z.string().min(1).default("sui402_merchant_change_requests"),
  SUI402_CONSOLE_AUDIT_TABLE: z.string().min(1).default("sui402_console_audit_events"),
  SUI402_CONSOLE_RATE_LIMIT_TABLE: z.string().min(1).default("sui402_console_rate_limits"),
  SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(20),
  SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SUI402_CONSOLE_PUBLIC_INTAKE_ALLOWED_HOSTS: z.string().min(1).optional(),
  SUI402_CONSOLE_PUBLIC_INTAKE_BLOCKED_HOSTS: z.string().min(1).optional(),
  SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(30),
  SUI402_CONSOLE_PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(600),
  SUI402_CONSOLE_PUBLIC_READ_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SUI402_CONSOLE_PUBLIC_READ_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(15),
  SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS: z.coerce.number().positive().max(8_760).default(72),
  SUI402_RECEIPT_SIGNER_PROVIDER: z.enum(["local", "external"]).default("local"),
  SUI402_RECEIPT_SIGNER_ID: z.string().min(1).optional(),
  SUI402_RECEIPT_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: z.string().min(1).optional(),
  SUI402_RECEIPT_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
  SUI402_WALRUS_PUBLISHER_URL: z.string().url().optional(),
  SUI402_WALRUS_EPOCHS: z.coerce.number().int().positive().default(5)
});

export type ConsoleConfig = z.infer<typeof EnvironmentSchema>;

export function loadConsoleConfig(env: NodeJS.ProcessEnv = process.env): ConsoleConfig {
  const config = EnvironmentSchema.parse(env);
  parseConsoleOperatorKeys(config.SUI402_CONSOLE_OPERATOR_KEYS_JSON, config.SUI402_CONSOLE_ADMIN_API_KEY);
  parseConsoleSellerKeys(config.SUI402_CONSOLE_SELLER_KEYS_JSON);

  if (
    config.NODE_ENV === "production" &&
    !config.SUI402_CONSOLE_ADMIN_API_KEY &&
    !config.SUI402_CONSOLE_OPERATOR_KEYS_JSON &&
    !hasOidcConfig(config)
  ) {
    throw new Error(
      "Production console API requires SUI402_CONSOLE_ADMIN_API_KEY, SUI402_CONSOLE_OPERATOR_KEYS_JSON, or OIDC config"
    );
  }

  if (hasPartialOidcConfig(config)) {
    throw new Error(
      "OIDC console auth requires SUI402_CONSOLE_OIDC_ISSUER, SUI402_CONSOLE_OIDC_AUDIENCE, and SUI402_CONSOLE_OIDC_JWKS_URL"
    );
  }

  if (config.NODE_ENV === "production" && config.SUI402_CONSOLE_STORAGE_DRIVER === "memory") {
    throw new Error("Production console API requires durable storage; set SUI402_CONSOLE_STORAGE_DRIVER=file or postgres");
  }

  if (config.SUI402_CONSOLE_STORAGE_DRIVER === "postgres" && !config.SUI402_CONSOLE_POSTGRES_URL) {
    throw new Error("Postgres console storage requires SUI402_CONSOLE_POSTGRES_URL");
  }

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

function hasOidcConfig(config: ConsoleConfig): boolean {
  return Boolean(
    config.SUI402_CONSOLE_OIDC_ISSUER &&
      config.SUI402_CONSOLE_OIDC_AUDIENCE &&
      config.SUI402_CONSOLE_OIDC_JWKS_URL
  );
}

function hasPartialOidcConfig(config: ConsoleConfig): boolean {
  const values = [
    config.SUI402_CONSOLE_OIDC_ISSUER,
    config.SUI402_CONSOLE_OIDC_AUDIENCE,
    config.SUI402_CONSOLE_OIDC_JWKS_URL
  ];
  return values.some(Boolean) && !values.every(Boolean);
}
