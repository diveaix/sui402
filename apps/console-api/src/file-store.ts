import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Sui402AnyPaymentProofSchema, Sui402ChallengeSchema, isExpired, type Sui402Challenge } from "@sui402/protocol";
import { Sui402SignedSpendReceiptSchema } from "@sui402/receipts";
import {
  GatewayMerchantConfigSchema,
  type GatewayMerchantConfig,
  type MerchantStore
} from "@sui402/gateway";
import {
  Sui402ServiceListingSchema,
  type ListingQuery,
  type ListingStore,
  type Sui402ServiceListing
} from "@sui402/registry";
import type { ChallengeStore, PaymentRecord, PaymentRecordStore } from "@sui402/server";
import type {
  IndexerCursorState,
  IndexerCursorStore,
  SessionSpendIndexStore,
  SessionSpendRecord,
  SessionSpendRecordQuery,
  SettlementIndexStore,
  SettlementRecord,
  SettlementRecordQuery
} from "@sui402/indexer";
import { z } from "zod";
import {
  ConsoleArtifactExportSchema,
  type ArtifactExportStore,
  type ConsoleArtifactExport
} from "./exports.js";
import {
  MerchantApplicationSchema,
  type MerchantApplication,
  type MerchantApplicationQuery,
  type MerchantApplicationStore
} from "./onboarding.js";
import {
  MerchantChangeRequestSchema,
  compareMerchantChangeRequestsDescending,
  matchesMerchantChangeRequestQuery,
  type MerchantChangeRequest,
  type MerchantChangeRequestQuery,
  type MerchantChangeRequestStore
} from "./merchant-change-requests.js";
import {
  ConsoleAuditEventSchema,
  compareAuditEventsDescending,
  createChainedConsoleAuditEvent,
  matchesAuditEventQuery,
  type ConsoleAuditEvent,
  type ConsoleAuditEventInput,
  type ConsoleAuditEventQuery,
  type ConsoleAuditLogStore
} from "./audit.js";

type JsonConsoleState = {
  version: 1;
  merchants: GatewayMerchantConfig[];
  listings: Sui402ServiceListing[];
  payments: PaymentRecord[];
  challenges: Sui402Challenge[];
  consumedChallengeIds: string[];
  sessionSpends: SessionSpendRecord[];
  settlementEvents: SettlementRecord[];
  indexerCursors: IndexerCursorState[];
  exports: ConsoleArtifactExport[];
  merchantApplications: MerchantApplication[];
  merchantChangeRequests: MerchantChangeRequest[];
  auditEvents: ConsoleAuditEvent[];
  updatedAt: string;
};

const PaymentRecordSchema = z.custom<PaymentRecord>((value) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<PaymentRecord>;
  return (
    typeof record.id === "string" &&
    Sui402ChallengeSchema.safeParse(record.challenge).success &&
    Sui402AnyPaymentProofSchema.safeParse(record.proof).success &&
    (record.receipt === undefined || Sui402SignedSpendReceiptSchema.safeParse(record.receipt).success) &&
    Boolean(record.verification && record.verification.ok === true) &&
    typeof record.resource === "string" &&
    typeof record.createdAt === "string"
  );
});

const JsonConsoleStateSchema: z.ZodType<JsonConsoleState> = z.object({
  version: z.literal(1),
  merchants: z.array(GatewayMerchantConfigSchema),
  listings: z.array(Sui402ServiceListingSchema),
  payments: z.array(PaymentRecordSchema),
  challenges: z.array(Sui402ChallengeSchema),
  consumedChallengeIds: z.array(z.string()),
  sessionSpends: z.array(
    z.object({
      id: z.string(),
      network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]),
      packageId: z.string(),
      coinType: z.string(),
      txDigest: z.string(),
      eventSeq: z.string().optional(),
      sessionId: z.string(),
      payer: z.string().optional(),
      merchant: z.string(),
      amount: z.string(),
      spentTotal: z.string().optional(),
      challengeId: z.string(),
      resourceScopeHash: z.string(),
      sender: z.string().optional(),
      timestampMs: z.string().optional(),
      indexedAt: z.string()
    }) satisfies z.ZodType<SessionSpendRecord>
  ).default([]),
  settlementEvents: z.array(
    z.object({
      id: z.string(),
      network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]),
      packageId: z.string(),
      coinType: z.string(),
      txDigest: z.string(),
      eventSeq: z.string().optional(),
      kind: z.enum(["receipt", "batch"]),
      ledgerId: z.string(),
      receiptId: z.string().optional(),
      payer: z.string().optional(),
      merchant: z.string(),
      signer: z.string().optional(),
      amount: z.string().optional(),
      sequence: z.string().optional(),
      resourceScopeHash: z.string().optional(),
      submitter: z.string(),
      receiptCount: z.string().optional(),
      totalAmount: z.string().optional(),
      sender: z.string().optional(),
      timestampMs: z.string().optional(),
      indexedAt: z.string()
    }) satisfies z.ZodType<SettlementRecord>
  ).default([]),
  indexerCursors: z.array(
    z.object({
      key: z.string().min(1),
      cursor: z.string().optional(),
      updatedAt: z.string().datetime()
    }) satisfies z.ZodType<IndexerCursorState>
  ).default([]),
  exports: z.array(ConsoleArtifactExportSchema).default([]),
  merchantApplications: z.array(MerchantApplicationSchema).default([]),
  merchantChangeRequests: z.array(MerchantChangeRequestSchema).default([]),
  auditEvents: z.array(ConsoleAuditEventSchema).default([]),
  updatedAt: z.string().datetime()
});

export class JsonFileConsoleStateStore {
  readonly #filePath: string;
  #state: JsonConsoleState;

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);
    this.#state = this.#read();
  }

  get filePath(): string {
    return this.#filePath;
  }

  upsertMerchant(merchant: GatewayMerchantConfig): void {
    const index = this.#state.merchants.findIndex((item) => item.id === merchant.id);
    if (index >= 0) {
      this.#state.merchants[index] = merchant;
    } else {
      this.#state.merchants.push(merchant);
    }
    this.#write();
  }

  getMerchant(id: string): GatewayMerchantConfig | undefined {
    return this.#state.merchants.find((item) => item.id === id);
  }

  listMerchants(): GatewayMerchantConfig[] {
    return [...this.#state.merchants].sort((left, right) => left.id.localeCompare(right.id));
  }

  upsertListing(listing: Sui402ServiceListing): void {
    const index = this.#state.listings.findIndex((item) => item.id === listing.id);
    if (index >= 0) {
      this.#state.listings[index] = listing;
    } else {
      this.#state.listings.push(listing);
    }
    this.#write();
  }

  getListing(id: string): Sui402ServiceListing | undefined {
    return this.#state.listings.find((item) => item.id === id);
  }

  listListings(query: ListingQuery = {}): Sui402ServiceListing[] {
    const limit = query.limit ?? 100;
    return this.#state.listings
      .filter((listing) => matchesListingQuery(listing, query))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit);
  }

  issueChallenge(challenge: Sui402Challenge): void {
    this.#state.challenges = this.#state.challenges.filter((item) => item.id !== challenge.id);
    this.#state.challenges.push(challenge);
    this.#write();
  }

  getChallenge(id: string): Sui402Challenge | undefined {
    const challenge = this.#state.challenges.find((item) => item.id === id);
    if (challenge) {
      if (isExpired(challenge.expiresAt)) {
        this.#state.challenges = this.#state.challenges.filter((item) => item.id !== id);
        this.#write();
        return undefined;
      }

      return challenge;
    }

    return undefined;
  }

  consumeChallenge(id: string): boolean {
    if (this.#state.consumedChallengeIds.includes(id)) {
      return false;
    }

    this.#state.consumedChallengeIds.push(id);
    this.#state.challenges = this.#state.challenges.filter((challenge) => challenge.id !== id);
    this.#write();
    return true;
  }

  recordPayment(payment: PaymentRecord): boolean {
    if (this.#state.payments.some((item) => item.id === payment.id)) {
      return false;
    }

    if (this.#state.payments.some((item) => sameProof(item, payment))) {
      return false;
    }

    this.#state.payments.push(payment);
    this.#write();
    return true;
  }

  getPayment(id: string): PaymentRecord | undefined {
    return this.#state.payments.find((item) => item.id === id);
  }

  getPaymentByProof(network: PaymentRecord["proof"]["network"], txDigest: string): PaymentRecord | undefined {
    return this.#state.payments.find((payment) => payment.proof.network === network && payment.proof.txDigest === txDigest);
  }

  getPaymentByTxDigest(txDigest: string, network?: PaymentRecord["proof"]["network"]): PaymentRecord | undefined {
    return this.#state.payments.find(
      (payment) => payment.proof.txDigest === txDigest && (!network || payment.proof.network === network)
    );
  }

  listPaymentsByRecipient(recipient: string): PaymentRecord[] {
    return this.#state.payments.filter(
      (payment) => payment.challenge.recipient.toLowerCase() === recipient.toLowerCase()
    );
  }

  listRecentPayments(limit = 100): PaymentRecord[] {
    return [...this.#state.payments]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  upsertSessionSpend(record: SessionSpendRecord): void {
    const index = this.#state.sessionSpends.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      this.#state.sessionSpends[index] = record;
    } else {
      this.#state.sessionSpends.push(record);
    }
    this.#write();
  }

  listSessionSpends(query: SessionSpendRecordQuery = {}): SessionSpendRecord[] {
    return [...this.#state.sessionSpends]
      .filter((record) => {
        return (
          (!query.sessionId || normalizeAddress(record.sessionId) === normalizeAddress(query.sessionId)) &&
          (!query.payer || normalizeAddress(record.payer ?? "") === normalizeAddress(query.payer)) &&
          (!query.merchant || normalizeAddress(record.merchant) === normalizeAddress(query.merchant))
        );
      })
      .sort(compareSessionSpendsDescending)
      .slice(0, query.limit ?? 100);
  }

  upsertSettlementEvent(record: SettlementRecord): void {
    const index = this.#state.settlementEvents.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      this.#state.settlementEvents[index] = record;
    } else {
      this.#state.settlementEvents.push(record);
    }
    this.#write();
  }

  listSettlementEvents(query: SettlementRecordQuery = {}): SettlementRecord[] {
    return [...this.#state.settlementEvents]
      .filter((record) => {
        return (
          (!query.kind || record.kind === query.kind) &&
          (!query.ledgerId || normalizeAddress(record.ledgerId) === normalizeAddress(query.ledgerId)) &&
          (!query.merchant || normalizeAddress(record.merchant) === normalizeAddress(query.merchant)) &&
          (!query.submitter || normalizeAddress(record.submitter) === normalizeAddress(query.submitter))
        );
      })
      .sort(compareSettlementEventsDescending)
      .slice(0, query.limit ?? 100);
  }

  getSettlementEventByIdentifier(identifier: string): SettlementRecord | undefined {
    return this.#state.settlementEvents.find(
      (record) =>
        record.id === identifier ||
        record.txDigest === identifier ||
        normalizeAddress(record.ledgerId) === normalizeAddress(identifier) ||
        record.receiptId === identifier
    );
  }

  getIndexerCursor(key: string): IndexerCursorState | undefined {
    return this.#state.indexerCursors.find((state) => state.key === key);
  }

  setIndexerCursor(key: string, cursor: string | undefined): void {
    const state: IndexerCursorState = {
      key,
      cursor,
      updatedAt: new Date().toISOString()
    };
    const index = this.#state.indexerCursors.findIndex((item) => item.key === key);
    if (index >= 0) {
      this.#state.indexerCursors[index] = state;
    } else {
      this.#state.indexerCursors.push(state);
    }
    this.#write();
  }

  recordExport(exportRecord: ConsoleArtifactExport): void {
    this.#state.exports = this.#state.exports.filter((item) => item.id !== exportRecord.id);
    this.#state.exports.push(exportRecord);
    this.#write();
  }

  listExports(limit = 100): ConsoleArtifactExport[] {
    return [...this.#state.exports]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  getExport(id: string): ConsoleArtifactExport | undefined {
    return this.#state.exports.find((item) => item.id === id);
  }

  submitMerchantApplication(application: MerchantApplication): void {
    this.#state.merchantApplications = this.#state.merchantApplications.filter((item) => item.id !== application.id);
    this.#state.merchantApplications.push(application);
    this.#write();
  }

  updateMerchantApplication(application: MerchantApplication): void {
    this.submitMerchantApplication(application);
  }

  getMerchantApplication(id: string): MerchantApplication | undefined {
    return this.#state.merchantApplications.find((item) => item.id === id);
  }

  listMerchantApplications(query: MerchantApplicationQuery = {}): MerchantApplication[] {
    return [...this.#state.merchantApplications]
      .filter((application) => !query.status || application.status === query.status)
      .sort(compareMerchantApplicationsDescending)
      .slice(0, query.limit ?? 100);
  }

  submitMerchantChangeRequest(request: MerchantChangeRequest): void {
    this.#state.merchantChangeRequests = this.#state.merchantChangeRequests.filter((item) => item.id !== request.id);
    this.#state.merchantChangeRequests.push(request);
    this.#write();
  }

  updateMerchantChangeRequest(request: MerchantChangeRequest): void {
    this.submitMerchantChangeRequest(request);
  }

  getMerchantChangeRequest(id: string): MerchantChangeRequest | undefined {
    return this.#state.merchantChangeRequests.find((item) => item.id === id);
  }

  listMerchantChangeRequests(query: MerchantChangeRequestQuery = {}): MerchantChangeRequest[] {
    return [...this.#state.merchantChangeRequests]
      .filter((request) => matchesMerchantChangeRequestQuery(request, query))
      .sort(compareMerchantChangeRequestsDescending)
      .slice(0, query.limit ?? 100);
  }

  recordAuditEvent(event: ConsoleAuditEvent): void {
    this.#state.auditEvents = this.#state.auditEvents.filter((item) => item.id !== event.id);
    this.#state.auditEvents.push(event);
    this.#write();
  }

  listAuditEvents(query: ConsoleAuditEventQuery = { limit: 100 }): ConsoleAuditEvent[] {
    return [...this.#state.auditEvents]
      .filter((event) => matchesAuditEventQuery(event, query))
      .sort(compareAuditEventsDescending)
      .slice(0, query.limit);
  }

  isEmpty(): boolean {
    return (
      this.#state.merchants.length === 0 &&
      this.#state.listings.length === 0 &&
      this.#state.payments.length === 0 &&
      this.#state.challenges.length === 0 &&
      this.#state.sessionSpends.length === 0 &&
      this.#state.settlementEvents.length === 0 &&
      this.#state.indexerCursors.length === 0 &&
      this.#state.exports.length === 0 &&
      this.#state.merchantApplications.length === 0 &&
      this.#state.merchantChangeRequests.length === 0 &&
      this.#state.auditEvents.length === 0
    );
  }

  #read(): JsonConsoleState {
    if (!existsSync(this.#filePath)) {
      return emptyState();
    }

    const raw = JSON.parse(readFileSync(this.#filePath, "utf8"));
    const parsed = JsonConsoleStateSchema.parse(raw);
    return {
      ...parsed,
      challenges: parsed.challenges.filter((challenge) => !isExpired(challenge.expiresAt))
    };
  }

  #write(): void {
    const nextState: JsonConsoleState = {
      ...this.#state,
      updatedAt: new Date().toISOString()
    };
    this.#state = nextState;

    mkdirSync(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.#filePath);
  }
}

export class JsonFileMerchantStore implements MerchantStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  upsert(merchant: GatewayMerchantConfig): void {
    this.state.upsertMerchant(merchant);
  }

  get(id: string): GatewayMerchantConfig | undefined {
    return this.state.getMerchant(id);
  }

  list(): GatewayMerchantConfig[] {
    return this.state.listMerchants();
  }
}

export class JsonFileListingStore implements ListingStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  upsert(listing: Sui402ServiceListing): void {
    this.state.upsertListing(listing);
  }

  get(id: string): Sui402ServiceListing | undefined {
    return this.state.getListing(id);
  }

  list(query: ListingQuery = {}): Sui402ServiceListing[] {
    return this.state.listListings(query);
  }
}

export class JsonFileChallengeStore implements ChallengeStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  issue(challenge: Sui402Challenge): void {
    this.state.issueChallenge(challenge);
  }

  get(id: string): Sui402Challenge | undefined {
    return this.state.getChallenge(id);
  }

  consume(id: string): boolean {
    return this.state.consumeChallenge(id);
  }
}

export class JsonFilePaymentRecordStore implements PaymentRecordStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  record(payment: PaymentRecord): boolean {
    return this.state.recordPayment(payment);
  }

  get(id: string): PaymentRecord | undefined {
    return this.state.getPayment(id);
  }

  getByProof(network: PaymentRecord["proof"]["network"], txDigest: string): PaymentRecord | undefined {
    return this.state.getPaymentByProof(network, txDigest);
  }

  getByTxDigest(txDigest: string, network?: PaymentRecord["proof"]["network"]): PaymentRecord | undefined {
    return this.state.getPaymentByTxDigest(txDigest, network);
  }

  listByRecipient(recipient: string): PaymentRecord[] {
    return this.state.listPaymentsByRecipient(recipient);
  }

  listRecent(limit = 100): PaymentRecord[] {
    return this.state.listRecentPayments(limit);
  }
}

export class JsonFileArtifactExportStore implements ArtifactExportStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  record(exportRecord: ConsoleArtifactExport): void {
    this.state.recordExport(exportRecord);
  }

  get(id: string): ConsoleArtifactExport | undefined {
    return this.state.getExport(id);
  }

  list(limit = 100): ConsoleArtifactExport[] {
    return this.state.listExports(limit);
  }
}

export class JsonFileSessionSpendIndexStore implements SessionSpendIndexStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  upsert(record: SessionSpendRecord): void {
    this.state.upsertSessionSpend(record);
  }

  list(query: SessionSpendRecordQuery = {}): SessionSpendRecord[] {
    return this.state.listSessionSpends(query);
  }
}

export class JsonFileSettlementIndexStore implements SettlementIndexStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  upsert(record: SettlementRecord): void {
    this.state.upsertSettlementEvent(record);
  }

  list(query: SettlementRecordQuery = {}): SettlementRecord[] {
    return this.state.listSettlementEvents(query);
  }

  getByIdentifier(identifier: string): SettlementRecord | undefined {
    return this.state.getSettlementEventByIdentifier(identifier);
  }
}

export class JsonFileIndexerCursorStore implements IndexerCursorStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  getCursor(key: string): IndexerCursorState | undefined {
    return this.state.getIndexerCursor(key);
  }

  setCursor(key: string, cursor: string | undefined): void {
    this.state.setIndexerCursor(key, cursor);
  }
}

export class JsonFileMerchantApplicationStore implements MerchantApplicationStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  submit(application: MerchantApplication): void {
    this.state.submitMerchantApplication(application);
  }

  update(application: MerchantApplication): void {
    this.state.updateMerchantApplication(application);
  }

  get(id: string): MerchantApplication | undefined {
    return this.state.getMerchantApplication(id);
  }

  list(query: MerchantApplicationQuery = {}): MerchantApplication[] {
    return this.state.listMerchantApplications(query);
  }
}

export class JsonFileMerchantChangeRequestStore implements MerchantChangeRequestStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  submit(request: MerchantChangeRequest): void {
    this.state.submitMerchantChangeRequest(request);
  }

  update(request: MerchantChangeRequest): void {
    this.state.updateMerchantChangeRequest(request);
  }

  get(id: string): MerchantChangeRequest | undefined {
    return this.state.getMerchantChangeRequest(id);
  }

  list(query: MerchantChangeRequestQuery = {}): MerchantChangeRequest[] {
    return this.state.listMerchantChangeRequests(query);
  }
}

export class JsonFileConsoleAuditLogStore implements ConsoleAuditLogStore {
  constructor(readonly state: JsonFileConsoleStateStore) {}

  record(event: ConsoleAuditEvent): void {
    this.state.recordAuditEvent(event);
  }

  append(input: ConsoleAuditEventInput): ConsoleAuditEvent {
    const previous = this.state.listAuditEvents({ limit: 1 })[0];
    const event = createChainedConsoleAuditEvent(input, previous);
    this.state.recordAuditEvent(event);
    return event;
  }

  list(query: ConsoleAuditEventQuery = { limit: 100 }): ConsoleAuditEvent[] {
    return this.state.listAuditEvents(query);
  }
}

export function createJsonFileConsoleStoreBundle(filePath: string): {
  state: JsonFileConsoleStateStore;
  merchants: JsonFileMerchantStore;
  listings: JsonFileListingStore;
  challenges: JsonFileChallengeStore;
  payments: JsonFilePaymentRecordStore;
  sessionSpends: JsonFileSessionSpendIndexStore;
  settlementEvents: JsonFileSettlementIndexStore;
  indexerCursors: JsonFileIndexerCursorStore;
  exports: JsonFileArtifactExportStore;
  merchantApplications: JsonFileMerchantApplicationStore;
  merchantChangeRequests: JsonFileMerchantChangeRequestStore;
  audit: JsonFileConsoleAuditLogStore;
} {
  const state = new JsonFileConsoleStateStore(filePath);
  return {
    state,
    merchants: new JsonFileMerchantStore(state),
    listings: new JsonFileListingStore(state),
    challenges: new JsonFileChallengeStore(state),
    payments: new JsonFilePaymentRecordStore(state),
    sessionSpends: new JsonFileSessionSpendIndexStore(state),
    settlementEvents: new JsonFileSettlementIndexStore(state),
    indexerCursors: new JsonFileIndexerCursorStore(state),
    exports: new JsonFileArtifactExportStore(state),
    merchantApplications: new JsonFileMerchantApplicationStore(state),
    merchantChangeRequests: new JsonFileMerchantChangeRequestStore(state),
    audit: new JsonFileConsoleAuditLogStore(state)
  };
}

function emptyState(): JsonConsoleState {
  return {
    version: 1,
    merchants: [],
    listings: [],
    payments: [],
    challenges: [],
    consumedChallengeIds: [],
    sessionSpends: [],
    settlementEvents: [],
    indexerCursors: [],
    exports: [],
    merchantApplications: [],
    merchantChangeRequests: [],
    auditEvents: [],
    updatedAt: new Date().toISOString()
  };
}

function matchesListingQuery(listing: Sui402ServiceListing, query: ListingQuery): boolean {
  if (query.network && listing.network !== query.network) {
    return false;
  }

  if (query.transport && listing.transport !== query.transport) {
    return false;
  }

  if (query.tag && !listing.tags.includes(query.tag)) {
    return false;
  }

  if (query.merchant && listing.merchant.toLowerCase() !== query.merchant.toLowerCase()) {
    return false;
  }

  if (query.status && listing.status !== query.status) {
    return false;
  }

  return true;
}

function sameProof(left: PaymentRecord, right: PaymentRecord): boolean {
  return left.proof.network === right.proof.network && left.proof.txDigest === right.proof.txDigest;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function compareSessionSpendsDescending(left: SessionSpendRecord, right: SessionSpendRecord): number {
  return (
    Number(right.timestampMs ?? 0) - Number(left.timestampMs ?? 0) ||
    Date.parse(right.indexedAt) - Date.parse(left.indexedAt) ||
    right.id.localeCompare(left.id)
  );
}

function compareMerchantApplicationsDescending(left: MerchantApplication, right: MerchantApplication): number {
  return Date.parse(right.submittedAt) - Date.parse(left.submittedAt) || right.id.localeCompare(left.id);
}

function compareSettlementEventsDescending(left: SettlementRecord, right: SettlementRecord): number {
  return (
    Number(right.timestampMs ?? 0) - Number(left.timestampMs ?? 0) ||
    Date.parse(right.indexedAt) - Date.parse(left.indexedAt) ||
    right.id.localeCompare(left.id)
  );
}
