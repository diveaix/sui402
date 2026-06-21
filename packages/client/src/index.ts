import type { Transaction } from "@mysten/sui/transactions";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import {
  assertPolicyDecision,
  evaluateChallengePolicy,
  type Sui402PaymentKind,
  type Sui402SpendingPolicy
} from "@sui402/policy";
import {
  SUI402_CHALLENGE_HEADER,
  SUI402_PAYMENT_HEADER,
  Sui402ChallengeSchema,
  Sui402PaymentRequiredResponseSchema,
  Sui402ProviderManifestSchema,
  assertChallengeId,
  decodeHeader,
  encodeHeader,
  isExpired,
  resourceScopeHash as hashResourceScope,
  type Sui402Challenge,
  type Sui402AnyPaymentProof,
  type Sui402PaymentProof,
  type Sui402Network,
  type Sui402ProviderManifest,
  type Sui402SessionSpendProof
} from "@sui402/protocol";
import {
  SUI_COIN_TYPE,
  buildCoinPaymentTransaction,
  buildCloseSessionTransaction,
  buildFundSessionTransaction,
  buildOpenSessionTransaction,
  buildSpendSessionTransaction,
  findUsableAgentPaymentSession,
  selectCoinObjectIdsForAmount,
  type AgentPaymentSession,
  type SuiCoinListingClient,
  type SessionFunding
} from "@sui402/sui";

export type PaymentHandlerContext = {
  challenge: Sui402Challenge;
  originalRequest: Request;
};

export type PaymentHandler = (context: PaymentHandlerContext) => Promise<Sui402AnyPaymentProof>;

export type Sui402ClientOptions = {
  fetch?: typeof fetch;
  paymentHandler: PaymentHandler;
};

export class Sui402Client {
  readonly #fetch: typeof fetch;
  readonly #paymentHandler: PaymentHandler;

  constructor(options: Sui402ClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#paymentHandler = options.paymentHandler;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const firstRequest = new Request(input, init);
    const firstResponse = await this.#fetch(firstRequest.clone());

    if (firstResponse.status !== 402) {
      return firstResponse;
    }

    const challenge = await readChallenge(firstResponse);
    const proof = await this.#paymentHandler({
      challenge,
      originalRequest: firstRequest.clone()
    });

    const retryHeaders = new Headers(firstRequest.headers);
    retryHeaders.set(SUI402_PAYMENT_HEADER, encodeHeader(proof));

    const retryRequest = new Request(firstRequest, {
      headers: retryHeaders
    });

    return this.#fetch(retryRequest);
  }
}

export type DiscoverSui402ProviderOptions = {
  fetch?: typeof fetch;
  wellKnownPath?: string;
};

export async function discoverSui402Provider(
  baseUrl: string | URL,
  options: DiscoverSui402ProviderOptions = {}
): Promise<Sui402ProviderManifest> {
  const fetchImpl = options.fetch ?? fetch;
  const url = new URL(options.wellKnownPath ?? "/.well-known/sui402", baseUrl);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Sui402 provider discovery failed: ${response.status} ${await response.text()}`);
  }

  return Sui402ProviderManifestSchema.parse(await response.json());
}

export type SuiTransactionSigner = {
  signAndExecuteTransaction: (input: { transaction: Transaction }) => Promise<{ digest: string }>;
  toSuiAddress?: () => string;
};

export type CoinSelector = (challenge: Sui402Challenge) => Promise<string[]> | string[];

export type SuiPaymentHandlerOptions = {
  coinSelector?: CoinSelector;
  coinSelectionClient?: SuiCoinListingClient;
  owner?: string;
  coinSelectionPageSize?: number;
  coinSelectionMaxPages?: number;
  coinSelectionMaxCoins?: number;
};

export function createSuiPaymentHandler(signer: SuiTransactionSigner, options: SuiPaymentHandlerOptions = {}): PaymentHandler {
  return async ({ challenge }) => {
    const coinObjectIds = await resolveCoinObjectIdsForChallenge(challenge, signer, options);
    const transaction = buildCoinPaymentTransaction(challenge, { coinObjectIds });
    const result = await signer.signAndExecuteTransaction({ transaction });

    return {
      version: "sui402-0.1",
      kind: "one-shot",
      challengeId: challenge.id,
      network: challenge.network,
      txDigest: result.digest,
      payer: signer.toSuiAddress?.(),
      paidAt: new Date().toISOString()
    };
  };
}

async function resolveCoinObjectIdsForChallenge(
  challenge: Sui402Challenge,
  signer: SuiTransactionSigner,
  options: SuiPaymentHandlerOptions
): Promise<string[]> {
  if (challenge.coinType === SUI_COIN_TYPE) {
    return [];
  }

  if (options.coinSelector) {
    return options.coinSelector(challenge);
  }

  if (!options.coinSelectionClient) {
    throw new Error("Non-SUI payments require coinSelector or coinSelectionClient");
  }

  const owner = options.owner ?? signer.toSuiAddress?.();
  if (!owner) {
    throw new Error("Automatic non-SUI coin selection requires owner or signer.toSuiAddress()");
  }

  const selection = await selectCoinObjectIdsForAmount({
    client: options.coinSelectionClient,
    owner,
    coinType: challenge.coinType,
    amount: challenge.amount,
    pageSize: options.coinSelectionPageSize,
    maxPages: options.coinSelectionMaxPages,
    maxCoins: options.coinSelectionMaxCoins
  });
  return selection.coinObjectIds;
}

export function createManualPaymentHandler(
  pay: (challenge: Sui402Challenge) => Promise<{ txDigest: string; payer?: string }>
): PaymentHandler {
  return async ({ challenge }) => {
    const result = await pay(challenge);
    return {
      version: "sui402-0.1",
      kind: "one-shot",
      challengeId: challenge.id,
      network: challenge.network,
      txDigest: result.txDigest,
      payer: result.payer,
      paidAt: new Date().toISOString()
    };
  };
}

export type PolicyGuardedPaymentHandlerOptions = {
  policy: Sui402SpendingPolicy;
  paymentKind?: Sui402PaymentKind;
};

export function createPolicyGuardedPaymentHandler(
  handler: PaymentHandler,
  options: PolicyGuardedPaymentHandlerOptions
): PaymentHandler {
  return async (context) => {
    const preflight = evaluateChallengePolicy(
      options.policy,
      context.challenge,
      options.paymentKind ? { paymentKind: options.paymentKind } : {}
    );
    if (preflight.warnings.length > 0 && !options.paymentKind) {
      throw new Error(`Sui402 policy requires explicit payment kind: ${preflight.warnings.join("; ")}`);
    }
    assertPolicyDecision(preflight);

    const proof = await handler(context);
    assertPolicyDecision(evaluateChallengePolicy(options.policy, context.challenge, { paymentKind: proof.kind }));

    return proof;
  };
}

export type SuiSessionPaymentHandlerOptions = {
  packageId: string;
  sessionId: string;
  resourceScopeHash: string;
  coinType?: string;
};

export function createSuiSessionPaymentHandler(
  signer: SuiTransactionSigner,
  options: SuiSessionPaymentHandlerOptions
): PaymentHandler {
  return async ({ challenge }): Promise<Sui402SessionSpendProof> => {
    const transaction = buildSpendSessionTransaction({
      packageId: options.packageId,
      coinType: options.coinType ?? challenge.coinType,
      sessionId: options.sessionId,
      amount: challenge.amount,
      challengeId: challenge.id,
      resourceScopeHash: options.resourceScopeHash
    });
    const result = await signer.signAndExecuteTransaction({ transaction });

    return {
      version: "sui402-0.1",
      kind: "session",
      challengeId: challenge.id,
      sessionId: options.sessionId,
      network: challenge.network,
      txDigest: result.digest,
      payer: signer.toSuiAddress?.(),
      spentAt: new Date().toISOString()
    };
  };
}

export type AutoSuiSessionPaymentHandlerOptions = {
  packageId: string;
  resourceScopeHash: string;
  owner?: string;
  client?: ClientWithCoreApi;
  fallback?: PaymentHandler;
};

export function createAutoSuiSessionPaymentHandler(
  signer: SuiTransactionSigner,
  options: AutoSuiSessionPaymentHandlerOptions
): PaymentHandler {
  return async (context): Promise<Sui402SessionSpendProof | Sui402AnyPaymentProof> => {
    const { challenge } = context;
    const owner = options.owner ?? signer.toSuiAddress?.();
    if (!owner) {
      if (options.fallback) {
        return options.fallback(context);
      }

      throw new Error("Auto session payment requires an owner address or signer.toSuiAddress()");
    }

    const session = await findUsableAgentPaymentSession({
      client: options.client,
      owner,
      packageId: options.packageId,
      coinType: challenge.coinType,
      merchant: challenge.recipient,
      resourceScopeHash: options.resourceScopeHash,
      minBalance: challenge.amount
    });

    if (!session) {
      if (options.fallback) {
        return options.fallback(context);
      }

      throw new Error("No usable Sui402 payment session found for this challenge");
    }

    const transaction = buildSpendSessionTransaction({
      packageId: options.packageId,
      coinType: session.coinType,
      sessionId: session.id,
      amount: challenge.amount,
      challengeId: challenge.id,
      resourceScopeHash: options.resourceScopeHash
    });
    const result = await signer.signAndExecuteTransaction({ transaction });

    return {
      version: "sui402-0.1",
      kind: "session",
      challengeId: challenge.id,
      sessionId: session.id,
      network: challenge.network,
      txDigest: result.digest,
      payer: owner,
      spentAt: new Date().toISOString()
    };
  };
}

export type SessionManagerConfigResponse = {
  network: Sui402Network;
  packageId: string;
  merchant?: string;
  coinType?: string;
  resourceScopeHash?: string;
};

export type SessionListResponse = {
  owner: string;
  sessions: AgentPaymentSession[];
};

export type UsableSessionResponse = {
  owner: string;
  usable: boolean;
  session?: AgentPaymentSession;
};

export type Sui402SessionManagerClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export type SessionQueryOptions = {
  coinType?: string;
  limit?: number;
};

export type UsableSessionQueryOptions = SessionQueryOptions & {
  amount: string | bigint | number;
  merchant?: string;
  resourceScopeHash?: string;
};

export type BuildManagedOpenSessionTransactionInput = {
  merchant?: string;
  coinType?: string;
  maxPerRequest: string | bigint | number;
  expiresMs: string | bigint | number;
  resourceScope?: string;
  resourceScopeHash?: string;
  funding: SessionFunding;
};

export type BuildManagedFundSessionTransactionInput = {
  sessionId: string;
  coinType?: string;
  funding: SessionFunding;
};

export type BuildManagedCloseSessionTransactionInput = {
  sessionId: string;
  coinType?: string;
};

export class Sui402SessionManagerClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;

  constructor(options: Sui402SessionManagerClientOptions) {
    this.#baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    this.#fetch = options.fetch ?? fetch;
  }

  async getConfig(): Promise<SessionManagerConfigResponse> {
    return this.#getJson("config");
  }

  async listSessions(owner: string, options: SessionQueryOptions = {}): Promise<SessionListResponse> {
    return this.#getJson(`owners/${encodeURIComponent(owner)}/sessions`, {
      coinType: options.coinType,
      limit: options.limit
    });
  }

  async findUsableSession(owner: string, options: UsableSessionQueryOptions): Promise<UsableSessionResponse> {
    return this.#getJson(`owners/${encodeURIComponent(owner)}/sessions/usable`, {
      amount: String(options.amount),
      merchant: options.merchant,
      resourceScopeHash: options.resourceScopeHash,
      coinType: options.coinType,
      limit: options.limit
    });
  }

  async buildOpenSessionTransaction(input: BuildManagedOpenSessionTransactionInput): Promise<Transaction> {
    const config = await this.getConfig();
    const merchant = input.merchant ?? config.merchant;
    const scopeHash = input.resourceScopeHash ?? config.resourceScopeHash ?? deriveResourceScopeHash(input.resourceScope);
    if (!merchant) {
      throw new Error("Session manager config did not include a merchant address");
    }

    if (!scopeHash) {
      throw new Error("Provide resourceScopeHash or resourceScope to open a managed session");
    }

    return buildOpenSessionTransaction({
      packageId: config.packageId,
      coinType: input.coinType ?? config.coinType ?? SUI_COIN_TYPE,
      merchant,
      maxPerRequest: input.maxPerRequest,
      expiresMs: input.expiresMs,
      resourceScopeHash: scopeHash,
      funding: input.funding
    });
  }

  async buildFundSessionTransaction(input: BuildManagedFundSessionTransactionInput): Promise<Transaction> {
    const config = await this.getConfig();
    return buildFundSessionTransaction({
      packageId: config.packageId,
      coinType: input.coinType ?? config.coinType ?? SUI_COIN_TYPE,
      sessionId: input.sessionId,
      funding: input.funding
    });
  }

  async buildCloseSessionTransaction(input: BuildManagedCloseSessionTransactionInput): Promise<Transaction> {
    const config = await this.getConfig();
    return buildCloseSessionTransaction({
      packageId: config.packageId,
      coinType: input.coinType ?? config.coinType ?? SUI_COIN_TYPE,
      sessionId: input.sessionId
    });
  }

  async #getJson<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.#fetch(url);
    if (!response.ok) {
      throw new Error(`Sui402 session manager request failed: ${response.status} ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }
}

async function readChallenge(response: Response): Promise<Sui402Challenge> {
  const header = response.headers.get(SUI402_CHALLENGE_HEADER);
  let challenge: Sui402Challenge;
  if (header) {
    challenge = decodeHeader(header, Sui402ChallengeSchema);
  } else {
    const body = Sui402PaymentRequiredResponseSchema.parse(await response.json());
    challenge = body.challenge;
  }

  assertChallengeId(challenge);
  if (isExpired(challenge.expiresAt)) {
    throw new Error("Sui402 challenge is expired");
  }

  return challenge;
}

function deriveResourceScopeHash(resourceScope: string | undefined): string | undefined {
  return resourceScope ? hashResourceScope(resourceScope) : undefined;
}
