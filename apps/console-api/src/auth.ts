import type { RequestHandler } from "express";
import { z } from "zod";

export const ConsoleRoleSchema = z.enum(["viewer", "merchant_admin", "exporter", "indexer", "admin"]);
export type ConsoleRole = z.infer<typeof ConsoleRoleSchema>;

export const ConsoleSellerRoleSchema = z.enum(["seller_viewer", "seller_admin"]);
export type ConsoleSellerRole = z.infer<typeof ConsoleSellerRoleSchema>;

export const ConsoleOperatorKeySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  key: z.string().min(16),
  roles: z.array(ConsoleRoleSchema).min(1),
  notBefore: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional()
});

export type ConsoleOperatorKey = z.infer<typeof ConsoleOperatorKeySchema>;

export const ConsoleOperatorKeysSchema = z.array(ConsoleOperatorKeySchema).max(100);

export const ConsoleSellerKeySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  key: z.string().min(16),
  merchantIds: z.array(z.union([z.literal("*"), z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/)])).min(1).max(100),
  roles: z.array(ConsoleSellerRoleSchema).min(1),
  notBefore: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional()
});

export type ConsoleSellerKey = z.infer<typeof ConsoleSellerKeySchema>;

export const ConsoleSellerKeysSchema = z.array(ConsoleSellerKeySchema).max(1000);

export type ConsoleAuthConfig = {
  NODE_ENV: "development" | "test" | "production";
  SUI402_CONSOLE_ADMIN_API_KEY?: string;
  SUI402_CONSOLE_OPERATOR_KEYS_JSON?: string;
  SUI402_CONSOLE_SELLER_KEYS_JSON?: string;
  SUI402_CONSOLE_OIDC_ISSUER?: string;
  SUI402_CONSOLE_OIDC_AUDIENCE?: string;
  SUI402_CONSOLE_OIDC_JWKS_URL?: string;
  SUI402_CONSOLE_OIDC_ROLE_CLAIM?: string;
  SUI402_CONSOLE_OIDC_SUBJECT_CLAIM?: string;
  SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM?: string;
};

export function parseConsoleOperatorKeys(
  operatorKeysJson: string | undefined,
  legacyAdminKey: string | undefined
): ConsoleOperatorKey[] {
  const operators = operatorKeysJson ? ConsoleOperatorKeysSchema.parse(JSON.parse(operatorKeysJson)) : [];
  if (!legacyAdminKey) {
    return operators;
  }

  return [
    ...operators,
    {
      id: "legacy-admin",
      key: legacyAdminKey,
      roles: ["admin"]
    }
  ];
}

export function parseConsoleSellerKeys(sellerKeysJson: string | undefined): ConsoleSellerKey[] {
  return sellerKeysJson ? ConsoleSellerKeysSchema.parse(JSON.parse(sellerKeysJson)) : [];
}

export function requireConsoleRole(config: ConsoleAuthConfig, role: ConsoleRole): RequestHandler {
  const operators = parseConsoleOperatorKeys(
    config.SUI402_CONSOLE_OPERATOR_KEYS_JSON,
    config.SUI402_CONSOLE_ADMIN_API_KEY
  );

  return async (req, res, next) => {
    if (config.NODE_ENV !== "production" && operators.length === 0 && !hasOidcConfig(config)) {
      next();
      return;
    }

    const bearerToken = readBearerToken(req);
    const presentedKey = readPresentedKey(req, bearerToken);
    const operator = presentedKey ? operators.find((entry) => entry.key === presentedKey) : undefined;
    const activeOperator = operator && operatorKeyIsActive(operator) ? operator : undefined;
    const resolvedOperator =
      activeOperator ??
      (bearerToken && hasOidcConfig(config) ? await verifyOidcBearerToken(config, bearerToken) : undefined);

    if (!resolvedOperator) {
      res.status(401).json({ error: "unauthorized", message: "Invalid console operator credential" });
      return;
    }

    if (!operatorHasRole(resolvedOperator, role)) {
      res.status(403).json({
        error: "forbidden",
        message: `Console operator ${resolvedOperator.id} is missing required role ${role}`,
        requiredRole: role
      });
      return;
    }

    res.locals.sui402Operator = {
      id: resolvedOperator.id,
      roles: resolvedOperator.roles
    };
    next();
  };
}

export function requireSellerRole(
  config: ConsoleAuthConfig,
  role: ConsoleSellerRole,
  readMerchantId: (req: Parameters<RequestHandler>[0]) => string | undefined
): RequestHandler {
  const sellers = parseConsoleSellerKeys(config.SUI402_CONSOLE_SELLER_KEYS_JSON);

  return async (req, res, next) => {
    const merchantId = readMerchantId(req);
    if (!merchantId) {
      res.status(400).json({ error: "invalid_merchant", message: "Merchant id is required" });
      return;
    }

    if (sellers.length === 0 && !hasOidcConfig(config)) {
      res.status(403).json({ error: "seller_auth_disabled", message: "Seller scoped access is not configured" });
      return;
    }

    const bearerToken = readBearerToken(req);
    const presentedKey = bearerToken ?? req.header("x-sui402-seller-key");
    const seller = presentedKey ? sellers.find((entry) => entry.key === presentedKey) : undefined;
    const activeSeller = seller && sellerKeyIsActive(seller) ? seller : undefined;
    const resolvedSeller =
      activeSeller ??
      (bearerToken && hasOidcConfig(config) ? await verifyOidcSellerBearerToken(config, bearerToken) : undefined);

    if (!resolvedSeller) {
      res.status(401).json({ error: "unauthorized", message: "Invalid seller credential" });
      return;
    }

    if (!sellerHasRole(resolvedSeller, role)) {
      res.status(403).json({
        error: "forbidden",
        message: `Seller ${resolvedSeller.id} is missing required role ${role}`,
        requiredRole: role
      });
      return;
    }

    if (!sellerCanAccessMerchant(resolvedSeller, merchantId)) {
      res.status(403).json({
        error: "merchant_forbidden",
        message: `Seller ${resolvedSeller.id} cannot access merchant ${merchantId}`
      });
      return;
    }

    res.locals.sui402Seller = {
      id: resolvedSeller.id,
      roles: resolvedSeller.roles,
      merchantIds: resolvedSeller.merchantIds
    };
    next();
  };
}

function operatorHasRole(operator: { roles: ConsoleRole[] }, role: ConsoleRole): boolean {
  return operator.roles.includes("admin") || operator.roles.includes(role);
}

function sellerHasRole(seller: { roles: ConsoleSellerRole[] }, role: ConsoleSellerRole): boolean {
  return seller.roles.includes("seller_admin") || seller.roles.includes(role);
}

function operatorKeyIsActive(operator: ConsoleOperatorKey, now = Date.now()): boolean {
  return (
    (!operator.notBefore || Date.parse(operator.notBefore) <= now) &&
    (!operator.expiresAt || Date.parse(operator.expiresAt) > now)
  );
}

function sellerKeyIsActive(seller: ConsoleSellerKey, now = Date.now()): boolean {
  return (
    (!seller.notBefore || Date.parse(seller.notBefore) <= now) &&
    (!seller.expiresAt || Date.parse(seller.expiresAt) > now)
  );
}

function sellerCanAccessMerchant(seller: { merchantIds: Array<"*" | string> }, merchantId: string): boolean {
  return seller.merchantIds.includes("*") || seller.merchantIds.includes(merchantId);
}

function readPresentedKey(req: Parameters<RequestHandler>[0], bearerToken: string | undefined): string | undefined {
  return bearerToken ?? req.header("x-sui402-admin-key");
}

function readBearerToken(req: Parameters<RequestHandler>[0]): string | undefined {
  return req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
}

type ConsoleJsonWebKey = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type JsonWebKeySet = {
  keys: ConsoleJsonWebKey[];
};

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  [claim: string]: unknown;
};

const jwksCache = new Map<string, { expiresAt: number; keys: ConsoleJsonWebKey[] }>();

async function verifyOidcBearerToken(
  config: ConsoleAuthConfig,
  token: string
): Promise<{ id: string; roles: ConsoleRole[] } | undefined> {
  try {
    const claims = await verifyOidcClaims(config, token);
    if (!claims) {
      return undefined;
    }

    const roles = readConsoleRoles(claims[config.SUI402_CONSOLE_OIDC_ROLE_CLAIM ?? "roles"]);
    if (roles.length === 0) {
      return undefined;
    }

    const subject = claims[config.SUI402_CONSOLE_OIDC_SUBJECT_CLAIM ?? "sub"];
    return {
      id: typeof subject === "string" && subject ? subject : "oidc-operator",
      roles
    };
  } catch {
    return undefined;
  }
}

async function verifyOidcSellerBearerToken(
  config: ConsoleAuthConfig,
  token: string
): Promise<{ id: string; roles: ConsoleSellerRole[]; merchantIds: Array<"*" | string> } | undefined> {
  try {
    const claims = await verifyOidcClaims(config, token);
    if (!claims) {
      return undefined;
    }

    const roles = readSellerRoles(claims[config.SUI402_CONSOLE_OIDC_ROLE_CLAIM ?? "roles"]);
    if (roles.length === 0) {
      return undefined;
    }

    const merchantIds = readSellerMerchantIds(claims[config.SUI402_CONSOLE_OIDC_SELLER_MERCHANT_CLAIM ?? "merchant_ids"]);
    if (merchantIds.length === 0) {
      return undefined;
    }

    const subject = claims[config.SUI402_CONSOLE_OIDC_SUBJECT_CLAIM ?? "sub"];
    return {
      id: typeof subject === "string" && subject ? subject : "oidc-seller",
      roles,
      merchantIds
    };
  } catch {
    return undefined;
  }
}

async function verifyOidcClaims(config: ConsoleAuthConfig, token: string): Promise<JwtClaims | undefined> {
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedClaims || !encodedSignature) {
    return undefined;
  }

  const header = JSON.parse(base64UrlDecodeToString(encodedHeader)) as JwtHeader;
  const claims = JSON.parse(base64UrlDecodeToString(encodedClaims)) as JwtClaims;
  if (!isSupportedOidcAlgorithm(header.alg)) {
    return undefined;
  }

  if (!claimsMatchConfig(claims, config)) {
    return undefined;
  }

  const key = await findJwksKey(config.SUI402_CONSOLE_OIDC_JWKS_URL!, header);
  if (!key) {
    return undefined;
  }

  const verified = await verifyJwtSignature({
    alg: header.alg,
    jwk: key,
    signingInput: `${encodedHeader}.${encodedClaims}`,
    signature: base64UrlDecode(encodedSignature)
  });
  return verified ? claims : undefined;
}

function hasOidcConfig(config: ConsoleAuthConfig): boolean {
  return Boolean(
    config.SUI402_CONSOLE_OIDC_ISSUER &&
      config.SUI402_CONSOLE_OIDC_AUDIENCE &&
      config.SUI402_CONSOLE_OIDC_JWKS_URL
  );
}

function claimsMatchConfig(claims: JwtClaims, config: ConsoleAuthConfig): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return (
    claims.iss === config.SUI402_CONSOLE_OIDC_ISSUER &&
    audienceIncludes(claims.aud, config.SUI402_CONSOLE_OIDC_AUDIENCE) &&
    typeof claims.exp === "number" &&
    claims.exp > nowSeconds &&
    (claims.nbf === undefined || claims.nbf <= nowSeconds)
  );
}

function audienceIncludes(audience: JwtClaims["aud"], expected: string | undefined): boolean {
  if (!expected) {
    return false;
  }

  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function isSupportedOidcAlgorithm(alg: string | undefined): alg is "RS256" | "ES256" {
  return alg === "RS256" || alg === "ES256";
}

async function findJwksKey(jwksUrl: string, header: JwtHeader): Promise<ConsoleJsonWebKey | undefined> {
  const keys = await fetchJwksKeys(jwksUrl);
  return keys.find((key) => {
    if (header.kid && key.kid) {
      return key.kid === header.kid;
    }

    return key.alg === header.alg || !key.alg;
  });
}

async function fetchJwksKeys(jwksUrl: string): Promise<ConsoleJsonWebKey[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`OIDC JWKS request failed: ${response.status}`);
  }

  const body = (await response.json()) as JsonWebKeySet;
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUrl, {
    keys,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  return keys;
}

async function verifyJwtSignature(input: {
  alg: "RS256" | "ES256";
  jwk: ConsoleJsonWebKey;
  signingInput: string;
  signature: Uint8Array;
}): Promise<boolean> {
  const algorithm =
    input.alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" };
  const verifyAlgorithm = input.alg === "RS256" ? algorithm : { name: "ECDSA", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("jwk", input.jwk, algorithm, false, ["verify"]);
  return crypto.subtle.verify(
    verifyAlgorithm,
    key,
    toArrayBuffer(input.signature),
    new TextEncoder().encode(input.signingInput)
  );
}

function readConsoleRoles(value: unknown): ConsoleRole[] {
  const rawRoles = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return rawRoles.flatMap((rawRole) => {
    const parsed = ConsoleRoleSchema.safeParse(rawRole);
    return parsed.success ? [parsed.data] : [];
  });
}

function readSellerRoles(value: unknown): ConsoleSellerRole[] {
  const rawRoles = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return rawRoles.flatMap((rawRole) => {
    const parsed = ConsoleSellerRoleSchema.safeParse(rawRole);
    return parsed.success ? [parsed.data] : [];
  });
}

function readSellerMerchantIds(value: unknown): Array<"*" | string> {
  const rawMerchantIds = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return rawMerchantIds.flatMap((rawMerchantId) => {
    if (rawMerchantId === "*") {
      return ["*"] as const;
    }
    const parsed = z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/).safeParse(rawMerchantId);
    return parsed.success ? [parsed.data] : [];
  });
}

function base64UrlDecodeToString(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
