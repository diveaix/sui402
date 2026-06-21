#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const storePath = resolve(process.env.SUI402_CONSOLE_FILE_STORE_PATH ?? ".sui402/console-store.json");
const merchantIdFilter = process.env.SUI402_MERCHANT_ID;
const addressPattern = /^0x[a-fA-F0-9]{64}$/;

if (!existsSync(storePath)) {
  throw new Error(`Console file store not found: ${storePath}`);
}

const state = JSON.parse(readFileSync(storePath, "utf8"));
const payments = Array.isArray(state.payments) ? state.payments : [];
const receiptPayments = payments
  .filter((payment) => payment?.receipt?.receipt)
  .filter((payment) => !merchantIdFilter || payment.challenge?.metadata?.merchantId === merchantIdFilter)
  .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""));

if (receiptPayments.length === 0) {
  const suffix = merchantIdFilter ? ` for merchant ${merchantIdFilter}` : "";
  throw new Error(`No signed receipt-bearing payments found in ${storePath}${suffix}`);
}

const payment = receiptPayments[0];
const signed = payment.receipt;
const receipt = signed.receipt;

if (!addressPattern.test(signed.signer)) {
  throw new Error(
    `Receipt signer "${signed.signer}" is not a Sui address. Issue receipts with SUI402_RECEIPT_SIGNER_ID set to a settlement signer address.`
  );
}

const env = {
  SUI402_RECEIPT_ID: receipt.id,
  SUI402_PAYER_ADDRESS: receipt.payer,
  SUI402_MERCHANT_ADDRESS: receipt.merchant,
  SUI402_RECEIPT_SIGNER_ADDRESS: signed.signer,
  SUI402_RECEIPT_AMOUNT: receipt.amount,
  SUI402_RECEIPT_SEQUENCE: receipt.sequence,
  SUI402_RESOURCE_SCOPE_HASH: receipt.resourceScopeHash,
  SUI402_COIN_TYPE: receipt.coinType,
  SUI402_RESOURCE_SCOPE: receipt.resource
};

console.log(`# Latest signed receipt from ${storePath}`);
console.log(`# paymentId=${payment.id}`);
console.log(`# txDigest=${payment.proof?.txDigest ?? receipt.metadata?.txDigest ?? "unknown"}`);
for (const [key, value] of Object.entries(env)) {
  console.log(`$env:${key}="${escapePowerShellString(value)}"`);
}

function escapePowerShellString(value) {
  return String(value).replace(/`/g, "``").replace(/"/g, '`"');
}
