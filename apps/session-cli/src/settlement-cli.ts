#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { resourceScopeHash } from "@sui402/protocol";
import {
  buildCreateSettlementLedgerTransaction,
  buildSettleBatchTransaction,
  buildSettleReceiptTransaction,
  type SettlementBatchReceiptInput
} from "@sui402/sui";
import {
  env,
  findCreatedSettlementLedgerId,
  getClient,
  getKeypair,
  optionalEnv,
  printResponse,
  signAndExecute
} from "./env.js";

const execFileAsync = promisify(execFile);

type Command =
  | "create-ledger"
  | "settle-receipt"
  | "settle-batch"
  | "inspect-ledger"
  | "demo"
  | "help";

type BatchReceiptFile = {
  merchant?: string;
  signer?: string;
  receipts: SettlementBatchReceiptInput[];
};

const command = readCommand();

switch (command) {
  case "create-ledger":
    await createLedger();
    break;
  case "settle-receipt":
    await settleReceipt();
    break;
  case "settle-batch":
    await settleBatch();
    break;
  case "inspect-ledger":
    await inspectLedger();
    break;
  case "demo":
    await demo();
    break;
  case "help":
    printHelp();
    break;
}

async function createLedger(): Promise<void> {
  if (!hasSdkSigner()) {
    await createLedgerWithSuiCli();
    return;
  }

  const tx = buildCreateSettlementLedgerTransaction({
    packageId: settlementPackageId()
  });
  const response = await signAndExecute(tx);
  printResponse(response, {
    ledgerId: findCreatedSettlementLedgerId(response)
  });
}

async function settleReceipt(): Promise<void> {
  if (!hasSdkSigner()) {
    await settleReceiptWithSuiCli();
    return;
  }

  const tx = buildSettleReceiptTransaction({
    packageId: settlementPackageId(),
    coinType: coinType(),
    ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
    receiptId: env("SUI402_RECEIPT_ID"),
    payer: env("SUI402_PAYER_ADDRESS"),
    merchant: env("SUI402_MERCHANT_ADDRESS"),
    signer: env("SUI402_RECEIPT_SIGNER_ADDRESS"),
    amount: optionalEnv("SUI402_RECEIPT_AMOUNT") ?? optionalEnv("SUI402_SPEND_AMOUNT") ?? "1000",
    sequence: optionalEnv("SUI402_RECEIPT_SEQUENCE") ?? "1",
    resourceScopeHash: readResourceScopeHash()
  });
  const response = await signAndExecute(tx);
  printResponse(response, {
    ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
    receiptId: env("SUI402_RECEIPT_ID")
  });
}

async function createLedgerWithSuiCli(): Promise<void> {
  const response = await suiCliJson([
    "client",
    "ptb",
    "--move-call",
    `${settlementPackageId()}::settlement::create_ledger`,
    "--gas-budget",
    optionalEnv("SUI402_GAS_BUDGET") ?? "50000000",
    "--json"
  ]);
  ensureSuiCliSuccess(response, "Settlement ledger creation");
  printResponse(response as never, {
    ledgerId: findCreatedObjectIdFromSuiCli(response, "::settlement::SettlementLedger")
  });
}

async function settleReceiptWithSuiCli(): Promise<void> {
  const response = await suiCliJson([
    "client",
    "ptb",
    "--make-move-vec",
    "<u8>",
    hexToCliVector(env("SUI402_RECEIPT_ID")),
    "--assign",
    "receipt_id",
    "--make-move-vec",
    "<u8>",
    hexToCliVector(readResourceScopeHash()),
    "--assign",
    "scope",
    "--move-call",
    `${settlementPackageId()}::settlement::settle_receipt`,
    `<${coinType()}>`,
    `@${env("SUI402_SETTLEMENT_LEDGER_ID")}`,
    "receipt_id",
    `@${env("SUI402_PAYER_ADDRESS")}`,
    `@${env("SUI402_MERCHANT_ADDRESS")}`,
    `@${env("SUI402_RECEIPT_SIGNER_ADDRESS")}`,
    optionalEnv("SUI402_RECEIPT_AMOUNT") ?? optionalEnv("SUI402_SPEND_AMOUNT") ?? "1000",
    optionalEnv("SUI402_RECEIPT_SEQUENCE") ?? "1",
    "scope",
    "--gas-budget",
    optionalEnv("SUI402_GAS_BUDGET") ?? "50000000",
    "--json"
  ]);
  ensureSuiCliSuccess(response, "Receipt settlement");
  printResponse(response as never, {
    ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
    receiptId: env("SUI402_RECEIPT_ID")
  });
}

async function settleBatch(): Promise<void> {
  const batch = readBatchFile();
  const merchant = optionalEnv("SUI402_MERCHANT_ADDRESS") ?? batch.merchant;
  const signer = optionalEnv("SUI402_RECEIPT_SIGNER_ADDRESS") ?? batch.signer;
  if (!merchant) {
    throw new Error("Set SUI402_MERCHANT_ADDRESS or merchant in the batch file");
  }

  if (!signer) {
    throw new Error("Set SUI402_RECEIPT_SIGNER_ADDRESS or signer in the batch file");
  }

  const tx = buildSettleBatchTransaction({
    packageId: settlementPackageId(),
    coinType: coinType(),
    ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
    merchant,
    signer,
    receipts: batch.receipts
  });
  const response = await signAndExecute(tx);
  printResponse(response, {
    ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
    receiptCount: batch.receipts.length
  });
}

async function inspectLedger(): Promise<void> {
  const ledgerId = env("SUI402_SETTLEMENT_LEDGER_ID");
  const { object } = await getClient().core.getObject({
    objectId: ledgerId,
    include: {
      json: true
    }
  });
  const fields = readMoveFields(object.json);
  console.log(
    JSON.stringify(
      {
        ledgerId,
        owner: fields.owner,
        receiptCount: fields.receipt_count ?? fields.receiptCount,
        totalAmount: fields.total_amount ?? fields.totalAmount,
        type: object.type,
        objectOwner: object.owner
      },
      null,
      2
    )
  );
}

async function demo(): Promise<void> {
  const createTx = buildCreateSettlementLedgerTransaction({
    packageId: settlementPackageId()
  });
  const createResponse = await signAndExecute(createTx);
  const ledgerId = findCreatedSettlementLedgerId(createResponse);
  if (!ledgerId) {
    throw new Error("Could not find created SettlementLedger object id in transaction response");
  }

  const merchant = env("SUI402_MERCHANT_ADDRESS");
  const payer = optionalEnv("SUI402_PAYER_ADDRESS") ?? getSignerAddressHint();
  const signer = optionalEnv("SUI402_RECEIPT_SIGNER_ADDRESS") ?? merchant;
  const receipts: SettlementBatchReceiptInput[] = [
    {
      receiptId: optionalEnv("SUI402_RECEIPT_ID") ?? "11".repeat(32),
      payer,
      amount: optionalEnv("SUI402_RECEIPT_AMOUNT") ?? "1000",
      sequence: optionalEnv("SUI402_RECEIPT_SEQUENCE") ?? "1",
      resourceScopeHash: readResourceScopeHash()
    }
  ];
  const settleTx = buildSettleBatchTransaction({
    packageId: settlementPackageId(),
    coinType: coinType(),
    ledgerId,
    merchant,
    signer,
    receipts
  });
  const settleResponse = await signAndExecute(settleTx);
  printResponse(settleResponse, {
    createdLedgerDigest: createResponse.digest,
    ledgerId,
    receiptCount: receipts.length
  });
}

function settlementPackageId(): string {
  return optionalEnv("SUI402_SETTLEMENT_PACKAGE_ID") ?? env("SUI402_SESSION_PACKAGE_ID");
}

function coinType(): string {
  return optionalEnv("SUI402_COIN_TYPE") ?? "0x2::sui::SUI";
}

function readResourceScopeHash(): string {
  return optionalEnv("SUI402_RESOURCE_SCOPE_HASH") ?? resourceScopeHash(optionalEnv("SUI402_RESOURCE_SCOPE") ?? "mcp:*");
}

function hasSdkSigner(): boolean {
  return Boolean(optionalEnv("SUI_SECRET_KEY") || optionalEnv("SUI_MNEMONIC"));
}

async function suiCliJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("sui", args, {
    env: suiEnv(),
    maxBuffer: 1024 * 1024 * 20
  });

  return JSON.parse(stdout) as Record<string, unknown>;
}

function ensureSuiCliSuccess(response: Record<string, unknown>, action: string): void {
  const status = String(asRecord(asRecord(response.effects).status).status ?? "");
  if (status !== "success") {
    throw new Error(`${action} failed: ${JSON.stringify(asRecord(response.effects).status ?? response.effects)}`);
  }
}

function findCreatedObjectIdFromSuiCli(response: Record<string, unknown>, typeFragment: string): string | undefined {
  const changes = Array.isArray(response.objectChanges) ? response.objectChanges : [];
  for (const change of changes) {
    const record = asRecord(change);
    if (
      record.type === "created" &&
      typeof record.objectType === "string" &&
      record.objectType.includes(typeFragment) &&
      typeof record.objectId === "string"
    ) {
      return record.objectId;
    }
  }
  return undefined;
}

function hexToCliVector(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new Error(`Expected even-length hex string, got ${hex}`);
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }

  return `[${bytes.join(",")}]`;
}

function suiEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
  };
}

function readBatchFile(): BatchReceiptFile {
  const path = env("SUI402_SETTLEMENT_BATCH_FILE");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settlement batch file must be a JSON object");
  }

  const record = parsed as Partial<BatchReceiptFile>;
  if (!Array.isArray(record.receipts) || record.receipts.length === 0) {
    throw new Error("Settlement batch file must contain a non-empty receipts array");
  }

  return {
    merchant: typeof record.merchant === "string" ? record.merchant : undefined,
    signer: typeof record.signer === "string" ? record.signer : undefined,
    receipts: record.receipts.map((receipt, index) => readBatchReceipt(receipt, index))
  };
}

function readBatchReceipt(value: unknown, index: number): SettlementBatchReceiptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Receipt at index ${index} must be a JSON object`);
  }

  const record = value as Partial<Record<keyof SettlementBatchReceiptInput, unknown>>;
  return {
    receiptId: readString(record.receiptId, `receipts[${index}].receiptId`),
    payer: readString(record.payer, `receipts[${index}].payer`),
    amount: readString(record.amount, `receipts[${index}].amount`),
    sequence: readString(record.sequence, `receipts[${index}].sequence`),
    resourceScopeHash: readString(record.resourceScopeHash, `receipts[${index}].resourceScopeHash`)
  };
}

function readMoveFields(content: unknown): Record<string, unknown> {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Settlement ledger object has no Move content");
  }

  const contentRecord = content as Record<string, unknown>;
  const fields = contentRecord.fields ?? contentRecord;
  if (typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("Settlement ledger object has invalid fields");
  }

  return fields as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readCommand(): Command {
  const command = process.argv[2] ?? "help";
  if (
    command === "create-ledger" ||
    command === "settle-receipt" ||
    command === "settle-batch" ||
    command === "inspect-ledger" ||
    command === "demo" ||
    command === "help"
  ) {
    return command;
  }

  throw new Error(`Unknown sui402-settlement command: ${command}`);
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  throw new Error(`Missing settlement batch field: ${fieldName}`);
}

function getSignerAddressHint(): string {
  return optionalEnv("SUI402_SIGNER_ADDRESS") ?? optionalEnv("SUI402_PAYER_ADDRESS") ?? getKeypair().getPublicKey().toSuiAddress();
}

function printHelp(): void {
  console.log(`sui402-settlement

Commands:
  create-ledger     Create an owned SettlementLedger
  settle-receipt    Submit one receipt settlement record
  settle-batch      Submit a batch from SUI402_SETTLEMENT_BATCH_FILE
  inspect-ledger    Read a SettlementLedger object
  demo              Create a ledger and settle one sample receipt

Common env:
  SUI402_SETTLEMENT_PACKAGE_ID or SUI402_SESSION_PACKAGE_ID
  SUI_SECRET_KEY or SUI_MNEMONIC
  SUI402_NETWORK=sui:testnet
  SUI402_COIN_TYPE=0x2::sui::SUI

Receipt env:
  SUI402_SETTLEMENT_LEDGER_ID
  SUI402_RECEIPT_ID
  SUI402_PAYER_ADDRESS
  SUI402_MERCHANT_ADDRESS
  SUI402_RECEIPT_SIGNER_ADDRESS
  SUI402_RECEIPT_AMOUNT
  SUI402_RECEIPT_SEQUENCE
  SUI402_RESOURCE_SCOPE_HASH or SUI402_RESOURCE_SCOPE
`);
}
