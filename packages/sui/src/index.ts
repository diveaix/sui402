import type { ClientWithCoreApi, SuiClientTypes } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { Sui402Challenge, Sui402Network, Sui402PaymentProof, Sui402SessionSpendProof } from "@sui402/protocol";
import {
  Sui402PaymentProofSchema,
  Sui402SessionSpendProofSchema,
  assertChallengeId,
  isExpired,
  resourceScopeHash
} from "@sui402/protocol";

export const SUI_COIN_TYPE = "0x2::sui::SUI";

export type Sui402VerifierOptions = {
  client?: ClientWithCoreApi;
  grpcUrl?: string;
  network?: Sui402Network;
  minConfirmations?: number;
  sessionPackageId?: string;
};

export type VerificationResult =
  | {
      ok: true;
      digest: string;
      payer?: string;
      recipient: string;
      amount: string;
      coinType: string;
    }
  | {
      ok: false;
      reason: string;
    };

export type SessionSpendVerificationResult =
  | {
      ok: true;
      digest: string;
      sessionId: string;
      payer?: string;
      recipient: string;
      amount: string;
      coinType: string;
    }
  | {
      ok: false;
      reason: string;
    };

export class Sui402Verifier {
  readonly client: ClientWithCoreApi;
  readonly network: Sui402Network;
  readonly sessionPackageId?: string;

  constructor(options: Sui402VerifierOptions = {}) {
    this.network = options.network ?? "sui:testnet";
    this.sessionPackageId = options.sessionPackageId;
    this.client =
      options.client ??
      new SuiGrpcClient({
        baseUrl: options.grpcUrl ?? fullnodeUrlForNetwork(this.network),
        network: suiNetworkName(this.network)
      });
  }

  async verifyPayment(challenge: Sui402Challenge, proofInput: Sui402PaymentProof): Promise<VerificationResult> {
    const proof = Sui402PaymentProofSchema.parse(proofInput);

    try {
      assertChallengeId(challenge);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Invalid challenge" };
    }

    if (isExpired(challenge.expiresAt)) {
      return { ok: false, reason: "Challenge expired" };
    }

    if (proof.challengeId !== challenge.id) {
      return { ok: false, reason: "Proof challenge id mismatch" };
    }

    if (proof.network !== challenge.network || proof.network !== this.network) {
      return { ok: false, reason: "Network mismatch" };
    }

    const transaction = await this.client.core.getTransaction({
      digest: proof.txDigest,
      include: {
        balanceChanges: true,
        effects: true,
        transaction: true
      }
    });

    return verifyTransactionResponse(challenge, proof, normalizeCoreTransaction(transaction));
  }

  async verifySessionSpend(
    challenge: Sui402Challenge,
    proofInput: Sui402SessionSpendProof
  ): Promise<SessionSpendVerificationResult> {
    const proof = Sui402SessionSpendProofSchema.parse(proofInput);

    if (proof.challengeId !== challenge.id) {
      return { ok: false, reason: "Proof challenge id mismatch" };
    }

    if (proof.network !== challenge.network || proof.network !== this.network) {
      return { ok: false, reason: "Network mismatch" };
    }

    const transaction = await this.client.core.getTransaction({
      digest: proof.txDigest,
      include: {
        effects: true,
        events: true,
        transaction: true
      }
    });

    return verifySessionSpendResponse(challenge, proof, normalizeCoreTransaction(transaction), {
      sessionPackageId: this.sessionPackageId
    });
  }
}

export type Sui402TransactionResponse = {
  digest: string;
  effects?: {
    status: {
      status: "success" | "failure";
      error?: string;
    };
  };
  transaction?: {
    data: {
      sender?: string;
    };
  };
  balanceChanges?: Array<{
    owner: unknown;
    coinType: string;
    amount: string;
  }>;
  events?: Array<{
    packageId: string;
    transactionModule: string;
    parsedJson: Record<string, unknown> | null;
    type: string;
  }>;
};

export type Sui402ObjectResponse =
  | {
      data?: {
        objectId: string;
        version?: string;
        digest?: string;
        content?: {
          dataType: string;
          type: string;
          fields: unknown;
        };
      } | null;
    }
  | {
      objectId: string;
      version?: string;
      digest?: string;
      type: string;
      json?: Record<string, unknown> | null;
    };

function normalizeCoreTransaction(
  result:
    | SuiClientTypes.TransactionResult<{
        balanceChanges: true;
        effects: true;
        transaction: true;
      }>
    | SuiClientTypes.TransactionResult<{
        effects: true;
        events: true;
        transaction: true;
      }>
): Sui402TransactionResponse {
  const transaction = result.Transaction ?? result.FailedTransaction;
  return {
    digest: transaction.digest,
    effects: {
      status: {
        status: transaction.status.success ? "success" : "failure",
        error: transaction.status.success ? undefined : transaction.status.error?.message
      }
    },
    transaction: {
      data: {
        sender: transaction.transaction?.sender ?? undefined
      }
    },
    balanceChanges: transaction.balanceChanges?.map((change) => ({
      owner: { AddressOwner: change.address },
      coinType: change.coinType,
      amount: change.amount
    })),
    events: transaction.events?.map((event) => ({
      packageId: event.packageId,
      transactionModule: event.module,
      parsedJson: event.json,
      type: event.eventType
    }))
  };
}

export function verifyTransactionResponse(
  challenge: Sui402Challenge,
  proof: Sui402PaymentProof,
  transaction: Sui402TransactionResponse
): VerificationResult {
  if (transaction.digest !== proof.txDigest) {
    return { ok: false, reason: "Transaction digest mismatch" };
  }

  if (transaction.effects?.status.status !== "success") {
    return { ok: false, reason: transaction.effects?.status.error ?? "Transaction did not succeed" };
  }

  const sender = transaction.transaction?.data.sender;
  if (proof.payer && sender && normalizeAddress(sender) !== normalizeAddress(proof.payer)) {
    return { ok: false, reason: "Payer does not match transaction sender" };
  }

  const paid = (transaction.balanceChanges ?? []).some((change) => {
    const ownerAddress = ownerToAddress(change.owner);
    if (!ownerAddress) {
      return false;
    }

    return (
      normalizeAddress(ownerAddress) === normalizeAddress(challenge.recipient) &&
      normalizeCoinType(change.coinType) === normalizeCoinType(challenge.coinType) &&
      BigInt(change.amount) >= BigInt(challenge.amount)
    );
  });

  if (!paid) {
    return { ok: false, reason: "No matching recipient balance change found" };
  }

  return {
    ok: true,
    digest: proof.txDigest,
    payer: proof.payer ?? sender,
    recipient: challenge.recipient,
    amount: challenge.amount,
    coinType: challenge.coinType
  };
}

export function verifySessionSpendResponse(
  challenge: Sui402Challenge,
  proof: Sui402SessionSpendProof,
  transaction: Sui402TransactionResponse,
  options: { sessionPackageId?: string } = {}
): SessionSpendVerificationResult {
  try {
    assertChallengeId(challenge);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid challenge" };
  }

  if (isExpired(challenge.expiresAt)) {
    return { ok: false, reason: "Challenge expired" };
  }

  if (transaction.digest !== proof.txDigest) {
    return { ok: false, reason: "Transaction digest mismatch" };
  }

  if (transaction.effects?.status.status !== "success") {
    return { ok: false, reason: transaction.effects?.status.error ?? "Transaction did not succeed" };
  }

  const sender = transaction.transaction?.data.sender;
  if (proof.payer && sender && normalizeAddress(sender) !== normalizeAddress(proof.payer)) {
    return { ok: false, reason: "Payer does not match transaction sender" };
  }

  const expectedResourceScopeHash = resourceScopeHash(challenge.resource);
  const matchingEvent = (transaction.events ?? []).find((event) => {
    if (
      options.sessionPackageId &&
      normalizeAddress(event.packageId) !== normalizeAddress(options.sessionPackageId)
    ) {
      return false;
    }

    if (event.transactionModule !== "sessions") {
      return false;
    }

    const parsed = event.parsedJson;
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    const spend = parsed as Record<string, unknown>;
    const eventCoinType = String(spend.coin_type ?? spend.coinType ?? event.type ?? "");
    return (
      String(spend.session_id ?? spend.sessionId ?? "") === proof.sessionId &&
      normalizeAddress(String(spend.merchant ?? "")) === normalizeAddress(challenge.recipient) &&
      eventMatchesCoinType(eventCoinType, challenge.coinType) &&
      BigInt(String(spend.amount ?? "0")) >= BigInt(challenge.amount) &&
      bytesFieldMatches(spend.challenge_id ?? spend.challengeId, challenge.id) &&
      bytesFieldMatches(spend.resource_scope_hash ?? spend.resourceScopeHash, expectedResourceScopeHash)
    );
  });

  if (!matchingEvent) {
    return { ok: false, reason: "No matching Sui402 session spend event found" };
  }

  return {
    ok: true,
    digest: proof.txDigest,
    sessionId: proof.sessionId,
    payer: proof.payer ?? sender,
    recipient: challenge.recipient,
    amount: challenge.amount,
    coinType: challenge.coinType
  };
}

export function buildSuiPaymentTransaction(challenge: Sui402Challenge): Transaction {
  if (normalizeCoinType(challenge.coinType) !== normalizeCoinType(SUI_COIN_TYPE)) {
    throw new Error("buildSuiPaymentTransaction currently supports native SUI payments only");
  }

  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [BigInt(challenge.amount)]);
  tx.transferObjects([coin], challenge.recipient);
  return tx;
}

export type BuildCoinPaymentTransactionOptions = {
  coinObjectIds: string[];
};

export type Sui402CoinObject = {
  objectId: string;
  balance: string | bigint | number;
  coinType?: string;
};

export type SelectedCoinObjects = {
  coinObjectIds: string[];
  totalBalance: string;
  requestedAmount: string;
};

export type SelectCoinObjectsForAmountOptions = {
  owner: string;
  coinType: string;
  amount: string | bigint | number;
  coins: Sui402CoinObject[];
  maxCoins?: number;
};

export type CoinListPage = {
  objects?: Sui402CoinObject[];
  coins?: Sui402CoinObject[];
  data?: Sui402CoinObject[];
  hasNextPage?: boolean;
  cursor?: string | null;
  nextCursor?: string | null;
};

export type SuiCoinListingClient = {
  core?: {
    listCoins(input: {
      owner: string;
      coinType?: string;
      cursor?: string | null;
      limit?: number;
    }): Promise<CoinListPage>;
  };
  listCoins?: (input: {
    owner: string;
    coinType?: string;
    cursor?: string | null;
    limit?: number;
  }) => Promise<CoinListPage>;
  getCoins?: (input: {
    owner: string;
    coinType?: string;
    cursor?: string | null;
    limit?: number;
  }) => Promise<CoinListPage>;
};

export type SelectCoinObjectIdsForAmountOptions = {
  client: SuiCoinListingClient;
  owner: string;
  coinType: string;
  amount: string | bigint | number;
  pageSize?: number;
  maxPages?: number;
  maxCoins?: number;
};

export function buildCoinPaymentTransaction(
  challenge: Sui402Challenge,
  options: BuildCoinPaymentTransactionOptions
): Transaction {
  if (normalizeCoinType(challenge.coinType) === normalizeCoinType(SUI_COIN_TYPE)) {
    return buildSuiPaymentTransaction(challenge);
  }

  const [primaryCoinId, ...mergeCoinIds] = options.coinObjectIds;
  if (!primaryCoinId) {
    throw new Error("At least one coin object id is required for non-SUI payments");
  }

  const tx = new Transaction();
  const primaryCoin = tx.object(primaryCoinId);
  if (mergeCoinIds.length > 0) {
    tx.mergeCoins(
      primaryCoin,
      mergeCoinIds.map((coinId) => tx.object(coinId))
    );
  }

  const [paymentCoin] = tx.splitCoins(primaryCoin, [BigInt(challenge.amount)]);
  tx.transferObjects([paymentCoin], challenge.recipient);
  return tx;
}

export function selectCoinObjectsForAmount(options: SelectCoinObjectsForAmountOptions): SelectedCoinObjects {
  const amount = readPositiveAmount(options.amount, "amount");
  const maxCoins = options.maxCoins ?? 256;
  if (!Number.isInteger(maxCoins) || maxCoins <= 0) {
    throw new Error("maxCoins must be a positive integer");
  }

  const matchingCoins = options.coins
    .filter((coin) => !coin.coinType || normalizeCoinType(coin.coinType) === normalizeCoinType(options.coinType))
    .map((coin) => ({
      objectId: coin.objectId,
      balance: BigInt(coin.balance)
    }))
    .filter((coin) => coin.balance > 0n)
    .sort((left, right) => {
      const balanceDiff = right.balance - left.balance;
      if (balanceDiff !== 0n) {
        return balanceDiff > 0n ? 1 : -1;
      }

      return left.objectId.localeCompare(right.objectId);
    });

  const selected: string[] = [];
  let total = 0n;
  for (const coin of matchingCoins) {
    if (selected.length >= maxCoins) {
      break;
    }

    selected.push(coin.objectId);
    total += coin.balance;
    if (total >= amount) {
      return {
        coinObjectIds: selected,
        totalBalance: total.toString(),
        requestedAmount: amount.toString()
      };
    }
  }

  throw new Error(
    `Insufficient ${options.coinType} coin balance for ${options.owner}: required ${amount.toString()}, available ${total.toString()}`
  );
}

export async function selectCoinObjectIdsForAmount(
  options: SelectCoinObjectIdsForAmountOptions
): Promise<SelectedCoinObjects> {
  const amount = readPositiveAmount(options.amount, "amount");
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 50;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer");
  }
  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error("maxPages must be a positive integer");
  }

  const listCoins = options.client.core?.listCoins ?? options.client.listCoins ?? options.client.getCoins;
  if (!listCoins) {
    throw new Error("Coin selection requires a client with listCoins or getCoins");
  }

  const coins: Sui402CoinObject[] = [];
  let cursor: string | null | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await listCoins({
      owner: options.owner,
      coinType: options.coinType,
      cursor,
      limit: pageSize
    });

    coins.push(...normalizeCoinListPage(page));
    const hasNextPage = Boolean(page.hasNextPage);
    cursor = page.cursor ?? page.nextCursor ?? null;
    if (!hasNextPage || !cursor) {
      break;
    }
  }

  return selectCoinObjectsForAmount({
    owner: options.owner,
    coinType: options.coinType,
    amount,
    coins,
    maxCoins: options.maxCoins
  });
}

export type SessionFunding =
  | {
      kind: "sui";
      amount: string | bigint | number;
    }
  | {
      kind: "coin";
      coinObjectId: string;
    };

export type BuildOpenSessionTransactionOptions = {
  packageId: string;
  coinType?: string;
  merchant: string;
  maxPerRequest: string | bigint | number;
  expiresMs: string | bigint | number;
  resourceScopeHash: string;
  funding: SessionFunding;
};

export type BuildSpendSessionTransactionOptions = {
  packageId: string;
  coinType?: string;
  sessionId: string;
  amount: string | bigint | number;
  challengeId: string;
  resourceScopeHash: string;
  clockObjectId?: string;
};

export type BuildFundSessionTransactionOptions = {
  packageId: string;
  coinType?: string;
  sessionId: string;
  funding: SessionFunding;
};

export type BuildCloseSessionTransactionOptions = {
  packageId: string;
  coinType?: string;
  sessionId: string;
};

export type BuildCreateSettlementLedgerTransactionOptions = {
  packageId: string;
};

export type BuildSettleReceiptTransactionOptions = {
  packageId: string;
  coinType?: string;
  ledgerId: string;
  receiptId: string;
  payer: string;
  merchant: string;
  signer: string;
  amount: string | bigint | number;
  sequence: string | bigint | number;
  resourceScopeHash: string;
};

export type SettlementBatchReceiptInput = {
  receiptId: string;
  payer: string;
  amount: string | bigint | number;
  sequence: string | bigint | number;
  resourceScopeHash: string;
};

export type BuildSettleBatchTransactionOptions = {
  packageId: string;
  coinType?: string;
  ledgerId: string;
  merchant: string;
  signer: string;
  receipts: SettlementBatchReceiptInput[];
};

export type AgentPaymentSession = {
  id: string;
  version?: string;
  digest?: string;
  type: string;
  packageId: string;
  coinType: string;
  payer: string;
  merchant: string;
  balance: string;
  spent: string;
  maxPerRequest: string;
  expiresMs: string;
  resourceScopeHash: string;
  revoked: boolean;
};

export type ListAgentPaymentSessionsOptions = {
  client?: ClientWithCoreApi;
  network?: Sui402Network;
  owner: string;
  packageId: string;
  coinType?: string;
  limit?: number;
};

export type FindUsableAgentPaymentSessionOptions = ListAgentPaymentSessionsOptions & {
  merchant: string;
  resourceScopeHash: string;
  minBalance: string | bigint | number;
  nowMs?: string | bigint | number;
};

export function buildOpenSessionTransaction(options: BuildOpenSessionTransactionOptions): Transaction {
  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;
  const fundingCoin =
    options.funding.kind === "sui"
      ? tx.splitCoins(tx.gas, [BigInt(options.funding.amount)])
      : [tx.object(options.funding.coinObjectId)];

  tx.moveCall({
    target: `${options.packageId}::sessions::open_session`,
    typeArguments: [coinType],
    arguments: [
      tx.pure.address(options.merchant),
      tx.pure.u64(options.maxPerRequest),
      tx.pure.u64(options.expiresMs),
      tx.pure.vector("u8", hexToBytes(options.resourceScopeHash)),
      fundingCoin[0]
    ]
  });

  return tx;
}

export function buildFundSessionTransaction(options: BuildFundSessionTransactionOptions): Transaction {
  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;
  const fundingCoin =
    options.funding.kind === "sui"
      ? tx.splitCoins(tx.gas, [BigInt(options.funding.amount)])
      : [tx.object(options.funding.coinObjectId)];

  tx.moveCall({
    target: `${options.packageId}::sessions::fund_session`,
    typeArguments: [coinType],
    arguments: [tx.object(options.sessionId), fundingCoin[0]]
  });

  return tx;
}

export function buildSpendSessionTransaction(options: BuildSpendSessionTransactionOptions): Transaction {
  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target: `${options.packageId}::sessions::spend`,
    typeArguments: [coinType],
    arguments: [
      tx.object(options.sessionId),
      tx.pure.u64(options.amount),
      tx.pure.vector("u8", hexToBytes(options.challengeId)),
      tx.pure.vector("u8", hexToBytes(options.resourceScopeHash)),
      tx.object(options.clockObjectId ?? "0x6")
    ]
  });

  return tx;
}

export function buildCloseSessionTransaction(options: BuildCloseSessionTransactionOptions): Transaction {
  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target: `${options.packageId}::sessions::close_session`,
    typeArguments: [coinType],
    arguments: [tx.object(options.sessionId)]
  });

  return tx;
}

export function buildCreateSettlementLedgerTransaction(
  options: BuildCreateSettlementLedgerTransactionOptions
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${options.packageId}::settlement::create_ledger`
  });
  return tx;
}

export function buildSettleReceiptTransaction(options: BuildSettleReceiptTransactionOptions): Transaction {
  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target: `${options.packageId}::settlement::settle_receipt`,
    typeArguments: [coinType],
    arguments: [
      tx.object(options.ledgerId),
      tx.pure.vector("u8", hexToBytes(options.receiptId)),
      tx.pure.address(options.payer),
      tx.pure.address(options.merchant),
      tx.pure.address(options.signer),
      tx.pure.u64(options.amount),
      tx.pure.u64(options.sequence),
      tx.pure.vector("u8", hexToBytes(options.resourceScopeHash))
    ]
  });

  return tx;
}

export function buildSettleBatchTransaction(options: BuildSettleBatchTransactionOptions): Transaction {
  if (options.receipts.length === 0) {
    throw new Error("At least one receipt is required to build a settlement batch transaction");
  }

  const tx = new Transaction();
  const coinType = options.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target: `${options.packageId}::settlement::settle_batch`,
    typeArguments: [coinType],
    arguments: [
      tx.object(options.ledgerId),
      tx.pure.vector(
        "vector<u8>",
        options.receipts.map((receipt) => hexToBytes(receipt.receiptId))
      ),
      tx.pure.vector(
        "address",
        options.receipts.map((receipt) => receipt.payer)
      ),
      tx.pure.address(options.merchant),
      tx.pure.address(options.signer),
      tx.pure.vector(
        "u64",
        options.receipts.map((receipt) => BigInt(receipt.amount))
      ),
      tx.pure.vector(
        "u64",
        options.receipts.map((receipt) => BigInt(receipt.sequence))
      ),
      tx.pure.vector(
        "vector<u8>",
        options.receipts.map((receipt) => hexToBytes(receipt.resourceScopeHash))
      )
    ]
  });

  return tx;
}

export async function listAgentPaymentSessions(
  options: ListAgentPaymentSessionsOptions
): Promise<AgentPaymentSession[]> {
  const client =
    options.client ??
    new SuiGrpcClient({
      baseUrl: fullnodeUrlForNetwork(options.network ?? "sui:testnet"),
      network: suiNetworkName(options.network ?? "sui:testnet")
    });
  const sessions: AgentPaymentSession[] = [];
  let cursor: string | null | undefined;

  do {
    const page = await client.core.listOwnedObjects({
      owner: options.owner,
      cursor,
      limit: options.limit ?? 50,
      include: {
        json: true
      }
    });

    for (const object of page.objects) {
      const session = parseAgentPaymentSessionObject(object, options.packageId);
      if (!session) {
        continue;
      }

      if (options.coinType && normalizeCoinType(session.coinType) !== normalizeCoinType(options.coinType)) {
        continue;
      }

      sessions.push(session);
    }

    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);

  return sessions;
}

export async function findUsableAgentPaymentSession(
  options: FindUsableAgentPaymentSessionOptions
): Promise<AgentPaymentSession | undefined> {
  const nowMs = BigInt(options.nowMs ?? Date.now());
  const minBalance = BigInt(options.minBalance);
  const expectedScope = stripHexPrefix(options.resourceScopeHash).toLowerCase();
  const sessions = await listAgentPaymentSessions(options);

  return sessions
    .filter((session) => {
      return (
        normalizeAddress(session.merchant) === normalizeAddress(options.merchant) &&
        stripHexPrefix(session.resourceScopeHash).toLowerCase() === expectedScope &&
        BigInt(session.balance) >= minBalance &&
        BigInt(session.maxPerRequest) >= minBalance &&
        BigInt(session.expiresMs) > nowMs &&
        !session.revoked
      );
    })
    .sort((left, right) => {
      const balanceDiff = BigInt(right.balance) - BigInt(left.balance);
      if (balanceDiff !== 0n) {
        return balanceDiff > 0n ? 1 : -1;
      }

      const expiryDiff = BigInt(left.expiresMs) - BigInt(right.expiresMs);
      return expiryDiff > 0n ? 1 : expiryDiff < 0n ? -1 : 0;
    })[0];
}

export function parseAgentPaymentSessionObject(
  object: Sui402ObjectResponse,
  expectedPackageId?: string
): AgentPaymentSession | undefined {
  const normalized = normalizeSessionObject(object);
  if (!normalized) {
    return undefined;
  }

  const { objectId, version, digest, type, fields } = normalized;
  if (!type.includes("::sessions::AgentPaymentSession<")) {
    return undefined;
  }

  const packageId = type.slice(0, type.indexOf("::sessions::AgentPaymentSession<"));
  if (expectedPackageId && normalizeAddress(packageId) !== normalizeAddress(expectedPackageId)) {
    return undefined;
  }

  const id = readObjectId(fields.id) ?? readOptionalString(fields.id) ?? objectId;
  const coinType = extractFirstTypeArgument(type);
  const payer = readRequiredString(fields.payer, "payer");
  const merchant = readRequiredString(fields.merchant, "merchant");
  const balance = readBalance(fields.balance);
  const spent = readRequiredString(fields.spent, "spent");
  const maxPerRequest = readRequiredString(fields.max_per_request ?? fields.maxPerRequest, "max_per_request");
  const expiresMs = readRequiredString(fields.expires_ms ?? fields.expiresMs, "expires_ms");
  const resourceScopeHash = readBytesHex(
    fields.resource_scope_hash ?? fields.resourceScopeHash,
    "resource_scope_hash"
  );
  const revoked = readRequiredBoolean(fields.revoked, "revoked");

  return {
    id,
    version,
    digest,
    type,
    packageId,
    coinType,
    payer,
    merchant,
    balance,
    spent,
    maxPerRequest,
    expiresMs,
    resourceScopeHash,
    revoked
  };
}

function normalizeSessionObject(object: Sui402ObjectResponse): {
  objectId: string;
  version?: string;
  digest?: string;
  type: string;
  fields: Record<string, unknown>;
} | undefined {
  if ("objectId" in object) {
    if (!object.json) {
      return undefined;
    }
    return {
      objectId: object.objectId,
      version: object.version,
      digest: object.digest,
      type: object.type,
      fields: asRecord(object.json)
    };
  }

  {
    const data = object.data;
    if (!data?.content || data.content.dataType !== "moveObject") {
      return undefined;
    }
    return {
      objectId: data.objectId,
      version: data.version,
      digest: data.digest,
      type: data.content.type,
      fields: asRecord(data.content.fields)
    };
  }
}

export function fullnodeUrlForNetwork(network: Sui402Network): string {
  switch (network) {
    case "sui:mainnet":
      return "https://fullnode.mainnet.sui.io:443";
    case "sui:testnet":
      return "https://fullnode.testnet.sui.io:443";
    case "sui:devnet":
      return "https://fullnode.devnet.sui.io:443";
    case "sui:localnet":
      return "http://127.0.0.1:9000";
  }
}

function suiNetworkName(network: Sui402Network): "mainnet" | "testnet" | "devnet" | "localnet" {
  switch (network) {
    case "sui:mainnet":
      return "mainnet";
    case "sui:testnet":
      return "testnet";
    case "sui:devnet":
      return "devnet";
    case "sui:localnet":
      return "localnet";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected Move object fields");
  }

  const record = value as Record<string, unknown>;
  if (record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)) {
    return record.fields as Record<string, unknown>;
  }

  return record;
}

function readObjectId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : undefined;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  throw new Error(`Expected string-like Move field: ${fieldName}`);
}

function readRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Expected boolean Move field: ${fieldName}`);
}

function readPositiveAmount(amount: string | bigint | number, fieldName: string): bigint {
  const parsed = BigInt(amount);
  if (parsed <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }

  return parsed;
}

function normalizeCoinListPage(page: CoinListPage): Sui402CoinObject[] {
  return page.objects ?? page.coins ?? page.data ?? [];
}

function readBalance(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  const fields = asRecord(value);
  return readRequiredString(fields.value, "balance.value");
}

function readBytesHex(value: unknown, fieldName: string): string {
  if (Array.isArray(value)) {
    return bytesToHex(Uint8Array.from(value.map((byte) => Number(byte))));
  }

  if (typeof value !== "string") {
    throw new Error(`Expected byte vector Move field: ${fieldName}`);
  }

  const normalized = stripHexPrefix(value).toLowerCase();
  if (normalized.length % 2 === 0 && /^[a-f0-9]+$/.test(normalized)) {
    return normalized;
  }

  try {
    return bytesToHex(fromBase64(value));
  } catch {
    throw new Error(`Expected hex or base64 byte vector Move field: ${fieldName}`);
  }
}

function extractFirstTypeArgument(type: string): string {
  const prefixIndex = type.indexOf("::sessions::AgentPaymentSession<");
  if (prefixIndex < 0) {
    throw new Error(`Not an AgentPaymentSession type: ${type}`);
  }

  const start = type.indexOf("<", prefixIndex);
  let depth = 0;
  for (let index = start; index < type.length; index += 1) {
    const char = type[index];
    if (char === "<") {
      depth += 1;
      continue;
    }

    if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return type.slice(start + 1, index).trim();
      }
    }
  }

  throw new Error(`Could not parse AgentPaymentSession type argument: ${type}`);
}

function ownerToAddress(owner: unknown): string | undefined {
  if (!owner || typeof owner !== "object") {
    return undefined;
  }

  const maybeOwner = owner as { AddressOwner?: string };
  return maybeOwner.AddressOwner;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function normalizeCoinType(coinType: string): string {
  return coinType
    .toLowerCase()
    .replace(/0x[0-9a-f]+(?=::)/g, (address) => normalizeTypeAddress(address));
}

function normalizeTypeAddress(address: string): string {
  const trimmed = stripHexPrefix(address).replace(/^0+/, "") || "0";
  return `0x${trimmed}`;
}

function eventMatchesCoinType(eventCoinType: string, expectedCoinType: string): boolean {
  const normalizedEventCoinType = normalizeCoinType(eventCoinType);
  const normalizedExpectedCoinType = normalizeCoinType(expectedCoinType);
  return (
    normalizedEventCoinType === normalizedExpectedCoinType ||
    normalizedEventCoinType.includes(`<${normalizedExpectedCoinType}>`) ||
    normalizedEventCoinType.endsWith(`::sessions::sessionspent<${normalizedExpectedCoinType}>`)
  );
}

function bytesFieldMatches(value: unknown, expectedHex: string): boolean {
  const normalizedExpected = stripHexPrefix(expectedHex).toLowerCase();
  if (Array.isArray(value)) {
    return bytesToHex(Uint8Array.from(value.map((byte) => Number(byte)))) === normalizedExpected;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (stripHexPrefix(value).toLowerCase() === normalizedExpected) {
    return true;
  }

  try {
    const decoded = fromBase64(value);
    return bytesToHex(decoded) === normalizedExpected;
  } catch {
    return false;
  }
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): number[] {
  const normalized = stripHexPrefix(hex);
  if (normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new Error("Expected an even-length hex string");
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}
