import { z } from "zod";
import type { SettlementRecord } from "@sui402/indexer";
import type { PaymentRecord } from "@sui402/server";
import type { ConsoleArtifactExport } from "./exports.js";

export const SettlementQuerySchema = z.object({
  merchantId: z.string().min(1).optional(),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).optional(),
  coinType: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(500)
});

export const SETTLEMENT_OPERATIONAL_CAVEATS = [
  "Operational reconciliation only; does not prove escrowed fund movement, refund guarantees, legal settlement finality, or external audit.",
  "Rows compare signed receipts with indexed settlement events available to this console, so results can change as indexing catches up."
] as const;

export type SettlementQuery = z.infer<typeof SettlementQuerySchema>;

export type SettlementSummary = {
  id: string;
  merchantId: string;
  recipient: string;
  network: PaymentRecord["challenge"]["network"];
  coinType: string;
  paymentCount: number;
  sessionPaymentCount: number;
  oneShotPaymentCount: number;
  receiptCount: number;
  totalAmount: string;
  firstPaymentAt: string;
  lastPaymentAt: string;
  exportedPaymentCount: number;
  latestExportBlobId?: string;
};

export type SettlementPaymentRow = {
  id: string;
  merchantId: string;
  recipient: string;
  network: PaymentRecord["challenge"]["network"];
  coinType: string;
  amount: string;
  paymentKind: PaymentRecord["proof"]["kind"];
  txDigest: string;
  resource: string;
  receiptId?: string;
  createdAt: string;
};

export type SettlementReconciliationStatus = "settled" | "unsettled" | "mismatched" | "duplicate" | "orphaned";

export type SettlementReconciliationSummary = {
  receiptPaymentCount: number;
  indexedReceiptEventCount: number;
  settledCount: number;
  unsettledCount: number;
  mismatchedCount: number;
  duplicateCount: number;
  orphanedEventCount: number;
  settledAmount: string;
  unsettledAmount: string;
};

export type SettlementReconciliationRow = {
  status: SettlementReconciliationStatus;
  receiptId: string;
  paymentId?: string;
  merchantId?: string;
  payer?: string;
  merchant?: string;
  signer?: string;
  network?: PaymentRecord["challenge"]["network"];
  coinType?: string;
  amount?: string;
  sequence?: string;
  resource?: string;
  resourceScopeHash?: string;
  paymentCreatedAt?: string;
  settlementTxDigest?: string;
  ledgerId?: string;
  settledAt?: string;
  eventCount: number;
  mismatchReasons: string[];
};

export function buildSettlementReport(input: {
  payments: PaymentRecord[];
  exports?: ConsoleArtifactExport[];
  query?: SettlementQuery;
}): {
  caveats: string[];
  summaries: SettlementSummary[];
  payments: SettlementPaymentRow[];
} {
  const query = input.query ?? { limit: 500 };
  const rows = input.payments
    .filter((payment) => matchesSettlementQuery(payment, query))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, query.limit)
    .map(paymentToSettlementRow);

  const summaries = new Map<string, SettlementSummary>();
  for (const row of [...rows].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
    const key = settlementKey(row.merchantId, row.network, row.coinType);
    const existing = summaries.get(key);
    if (!existing) {
      summaries.set(key, {
        id: key,
        merchantId: row.merchantId,
        recipient: row.recipient,
        network: row.network,
        coinType: row.coinType,
        paymentCount: 1,
        sessionPaymentCount: row.paymentKind === "session" ? 1 : 0,
        oneShotPaymentCount: row.paymentKind === "one-shot" ? 1 : 0,
        receiptCount: row.receiptId ? 1 : 0,
        totalAmount: row.amount,
        firstPaymentAt: row.createdAt,
        lastPaymentAt: row.createdAt,
        exportedPaymentCount: 0
      });
      continue;
    }

    existing.paymentCount += 1;
    existing.sessionPaymentCount += row.paymentKind === "session" ? 1 : 0;
    existing.oneShotPaymentCount += row.paymentKind === "one-shot" ? 1 : 0;
    existing.receiptCount += row.receiptId ? 1 : 0;
    existing.totalAmount = (BigInt(existing.totalAmount) + BigInt(row.amount)).toString();
    existing.lastPaymentAt = row.createdAt;
  }

  attachExportContext([...summaries.values()], input.exports ?? []);

  return {
    caveats: [...SETTLEMENT_OPERATIONAL_CAVEATS],
    summaries: [...summaries.values()].sort((left, right) => Date.parse(right.lastPaymentAt) - Date.parse(left.lastPaymentAt)),
    payments: rows
  };
}

export function buildSettlementReconciliationReport(input: {
  payments: PaymentRecord[];
  settlementEvents: SettlementRecord[];
  query?: SettlementQuery;
}): {
  caveats: string[];
  summary: SettlementReconciliationSummary;
  rows: SettlementReconciliationRow[];
} {
  const query = input.query ?? { limit: 500 };
  const receiptEvents = input.settlementEvents
    .filter((event) => event.kind === "receipt")
    .filter((event) => matchesSettlementEventQuery(event, query));
  const eventsByReceipt = groupSettlementEventsByReceipt(receiptEvents);
  const paymentsWithReceipts = input.payments
    .filter((payment) => payment.receipt)
    .filter((payment) => matchesSettlementQuery(payment, query))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, query.limit);
  const seenReceiptIds = new Set<string>();

  const rows: SettlementReconciliationRow[] = [];
  const summary: SettlementReconciliationSummary = {
    receiptPaymentCount: paymentsWithReceipts.length,
    indexedReceiptEventCount: receiptEvents.length,
    settledCount: 0,
    unsettledCount: 0,
    mismatchedCount: 0,
    duplicateCount: 0,
    orphanedEventCount: 0,
    settledAmount: "0",
    unsettledAmount: "0"
  };

  for (const payment of paymentsWithReceipts) {
    const receipt = payment.receipt?.receipt;
    if (!receipt) {
      continue;
    }
    seenReceiptIds.add(normalizeKey(receipt.id));
    const events = eventsByReceipt.get(normalizeKey(receipt.id)) ?? [];
    const primaryEvent = events[0];
    const mismatchReasons = primaryEvent ? compareReceiptToSettlementEvent(payment, primaryEvent) : [];
    const status = reconciliationStatus(events.length, mismatchReasons);
    const row = reconciliationRowFromPayment(payment, primaryEvent, status, events.length, mismatchReasons);
    rows.push(row);

    if (status === "settled") {
      summary.settledCount += 1;
      summary.settledAmount = addAmounts(summary.settledAmount, receipt.amount);
    } else if (status === "unsettled") {
      summary.unsettledCount += 1;
      summary.unsettledAmount = addAmounts(summary.unsettledAmount, receipt.amount);
    } else if (status === "mismatched") {
      summary.mismatchedCount += 1;
    } else if (status === "duplicate") {
      summary.duplicateCount += 1;
    }
  }

  for (const event of receiptEvents) {
    const receiptId = event.receiptId;
    if (!receiptId || seenReceiptIds.has(normalizeKey(receiptId))) {
      continue;
    }

    summary.orphanedEventCount += 1;
    rows.push(reconciliationRowFromOrphanedEvent(event));
  }

  return {
    caveats: [...SETTLEMENT_OPERATIONAL_CAVEATS],
    summary,
    rows: rows.sort(compareReconciliationRows)
  };
}

export function settlementReportToCsv(report: ReturnType<typeof buildSettlementReport>): string {
  return rowsToCsv([
    [
      "payment_id",
      "merchant_id",
      "recipient",
      "network",
      "coin_type",
      "amount",
      "payment_kind",
      "tx_digest",
      "resource",
      "receipt_id",
      "created_at"
    ],
    ...report.payments.map((row) => [
      row.id,
      row.merchantId,
      row.recipient,
      row.network,
      row.coinType,
      row.amount,
      row.paymentKind,
      row.txDigest,
      row.resource,
      row.receiptId ?? "",
      row.createdAt
    ])
  ]);
}

export function settlementReconciliationToCsv(report: ReturnType<typeof buildSettlementReconciliationReport>): string {
  return rowsToCsv([
    [
      "status",
      "receipt_id",
      "payment_id",
      "merchant_id",
      "payer",
      "merchant",
      "signer",
      "network",
      "coin_type",
      "amount",
      "sequence",
      "resource",
      "resource_scope_hash",
      "payment_created_at",
      "settlement_tx_digest",
      "ledger_id",
      "settled_at",
      "event_count",
      "mismatch_reasons"
    ],
    ...report.rows.map((row) => [
      row.status,
      row.receiptId,
      row.paymentId ?? "",
      row.merchantId ?? "",
      row.payer ?? "",
      row.merchant ?? "",
      row.signer ?? "",
      row.network ?? "",
      row.coinType ?? "",
      row.amount ?? "",
      row.sequence ?? "",
      row.resource ?? "",
      row.resourceScopeHash ?? "",
      row.paymentCreatedAt ?? "",
      row.settlementTxDigest ?? "",
      row.ledgerId ?? "",
      row.settledAt ?? "",
      String(row.eventCount),
      row.mismatchReasons.join(";")
    ])
  ]);
}

function matchesSettlementQuery(payment: PaymentRecord, query: SettlementQuery): boolean {
  if (query.merchantId && merchantIdForPayment(payment) !== query.merchantId) {
    return false;
  }

  if (query.network && payment.challenge.network !== query.network) {
    return false;
  }

  if (query.coinType && payment.challenge.coinType !== query.coinType) {
    return false;
  }

  return true;
}

function matchesSettlementEventQuery(event: SettlementRecord, query: SettlementQuery): boolean {
  if (query.network && event.network !== query.network) {
    return false;
  }

  if (query.coinType && event.coinType !== query.coinType) {
    return false;
  }

  if (query.merchantId?.startsWith("0x") && normalizeAddress(event.merchant) !== normalizeAddress(query.merchantId)) {
    return false;
  }

  return true;
}

function paymentToSettlementRow(payment: PaymentRecord): SettlementPaymentRow {
  return {
    id: payment.id,
    merchantId: merchantIdForPayment(payment),
    recipient: payment.challenge.recipient,
    network: payment.challenge.network,
    coinType: payment.challenge.coinType,
    amount: payment.verification.amount,
    paymentKind: payment.proof.kind,
    txDigest: payment.proof.txDigest,
    resource: payment.resource,
    receiptId: payment.receipt?.receipt.id,
    createdAt: payment.createdAt
  };
}

function groupSettlementEventsByReceipt(events: SettlementRecord[]): Map<string, SettlementRecord[]> {
  const grouped = new Map<string, SettlementRecord[]>();
  for (const event of events) {
    if (!event.receiptId) {
      continue;
    }

    const key = normalizeKey(event.receiptId);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(event);
    } else {
      grouped.set(key, [event]);
    }
  }

  return grouped;
}

function reconciliationStatus(
  eventCount: number,
  mismatchReasons: string[]
): Exclude<SettlementReconciliationStatus, "orphaned"> {
  if (eventCount === 0) {
    return "unsettled";
  }

  if (eventCount > 1) {
    return "duplicate";
  }

  return mismatchReasons.length > 0 ? "mismatched" : "settled";
}

function compareReceiptToSettlementEvent(payment: PaymentRecord, event: SettlementRecord): string[] {
  const signed = payment.receipt;
  const receipt = signed?.receipt;
  if (!receipt) {
    return ["payment_missing_receipt"];
  }

  const reasons: string[] = [];
  addMismatch(reasons, "network", receipt.network, event.network);
  addMismatch(reasons, "coin_type", receipt.coinType, event.coinType);
  addMismatch(reasons, "payer", receipt.payer, event.payer);
  addMismatch(reasons, "merchant", receipt.merchant, event.merchant);
  addMismatch(reasons, "signer", signed.signer, event.signer);
  addMismatch(reasons, "amount", receipt.amount, event.amount);
  addMismatch(reasons, "sequence", receipt.sequence, event.sequence);
  addMismatch(reasons, "resource_scope_hash", receipt.resourceScopeHash, event.resourceScopeHash);
  return reasons;
}

function reconciliationRowFromPayment(
  payment: PaymentRecord,
  event: SettlementRecord | undefined,
  status: Exclude<SettlementReconciliationStatus, "orphaned">,
  eventCount: number,
  mismatchReasons: string[]
): SettlementReconciliationRow {
  const signed = payment.receipt;
  const receipt = signed?.receipt;
  if (!receipt) {
    throw new Error("Expected payment receipt");
  }

  return {
    status,
    receiptId: receipt.id,
    paymentId: payment.id,
    merchantId: merchantIdForPayment(payment),
    payer: receipt.payer,
    merchant: receipt.merchant,
    signer: signed.signer,
    network: receipt.network,
    coinType: receipt.coinType,
    amount: receipt.amount,
    sequence: receipt.sequence,
    resource: receipt.resource,
    resourceScopeHash: receipt.resourceScopeHash,
    paymentCreatedAt: payment.createdAt,
    settlementTxDigest: event?.txDigest,
    ledgerId: event?.ledgerId,
    settledAt: event?.timestampMs,
    eventCount,
    mismatchReasons
  };
}

function reconciliationRowFromOrphanedEvent(event: SettlementRecord): SettlementReconciliationRow {
  return {
    status: "orphaned",
    receiptId: event.receiptId ?? `${event.txDigest}:${event.eventSeq ?? "0"}`,
    payer: event.payer,
    merchant: event.merchant,
    signer: event.signer,
    network: event.network,
    coinType: event.coinType,
    amount: event.amount,
    sequence: event.sequence,
    resourceScopeHash: event.resourceScopeHash,
    settlementTxDigest: event.txDigest,
    ledgerId: event.ledgerId,
    settledAt: event.timestampMs,
    eventCount: 1,
    mismatchReasons: ["no_matching_payment_receipt"]
  };
}

function addMismatch(reasons: string[], field: string, expected: string | undefined, actual: string | undefined): void {
  if (expected === undefined || actual === undefined) {
    if (expected !== actual) {
      reasons.push(field);
    }
    return;
  }

  if (normalizeKey(expected) !== normalizeKey(actual)) {
    reasons.push(field);
  }
}

function attachExportContext(summaries: SettlementSummary[], exports: ConsoleArtifactExport[]): void {
  const paymentLedgerExports = exports
    .filter((item) => item.kind === "payment-ledger")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  for (const summary of summaries) {
    const matchingExport =
      paymentLedgerExports.find((item) => String(item.metadata?.merchantId ?? "") === summary.merchantId) ??
      paymentLedgerExports.find((item) => item.metadata?.merchantId === undefined);
    if (!matchingExport) {
      continue;
    }

    summary.exportedPaymentCount = matchingExport.paymentCount;
    summary.latestExportBlobId = matchingExport.blobId;
  }
}

function merchantIdForPayment(payment: PaymentRecord): string {
  return String(payment.challenge.metadata?.merchantId ?? payment.challenge.recipient);
}

function settlementKey(merchantId: string, network: string, coinType: string): string {
  return `${merchantId}:${network}:${coinType}`;
}

function compareReconciliationRows(left: SettlementReconciliationRow, right: SettlementReconciliationRow): number {
  return (
    statusRank(left.status) - statusRank(right.status) ||
    Date.parse(right.paymentCreatedAt ?? "1970-01-01T00:00:00.000Z") -
      Date.parse(left.paymentCreatedAt ?? "1970-01-01T00:00:00.000Z") ||
    left.receiptId.localeCompare(right.receiptId)
  );
}

function statusRank(status: SettlementReconciliationStatus): number {
  switch (status) {
    case "mismatched":
      return 0;
    case "duplicate":
      return 1;
    case "unsettled":
      return 2;
    case "orphaned":
      return 3;
    case "settled":
      return 4;
  }
}

function addAmounts(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function rowsToCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function normalizeKey(value: string): string {
  return value.toLowerCase();
}
