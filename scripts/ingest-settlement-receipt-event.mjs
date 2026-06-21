#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const consoleUrl = (process.env.SUI402_CONSOLE_API_URL ?? "http://127.0.0.1:4030").replace(/\/$/, "");
const txDigest = env("SUI402_SETTLEMENT_TX_DIGEST");
const eventSeq = process.env.SUI402_SETTLEMENT_EVENT_SEQ ?? "0";
const submitter = process.env.SUI402_SETTLEMENT_SUBMITTER ?? readActiveAddress();

const record = {
  id: `${txDigest}:${eventSeq}`,
  network: process.env.SUI402_NETWORK ?? "sui:testnet",
  packageId: process.env.SUI402_SETTLEMENT_PACKAGE_ID ?? env("SUI402_SESSION_PACKAGE_ID"),
  coinType: process.env.SUI402_COIN_TYPE ?? "0x2::sui::SUI",
  txDigest,
  eventSeq,
  kind: "receipt",
  ledgerId: env("SUI402_SETTLEMENT_LEDGER_ID"),
  receiptId: env("SUI402_RECEIPT_ID"),
  payer: env("SUI402_PAYER_ADDRESS"),
  merchant: env("SUI402_MERCHANT_ADDRESS"),
  signer: env("SUI402_RECEIPT_SIGNER_ADDRESS"),
  amount: env("SUI402_RECEIPT_AMOUNT"),
  sequence: env("SUI402_RECEIPT_SEQUENCE"),
  resourceScopeHash: env("SUI402_RESOURCE_SCOPE_HASH"),
  submitter,
  sender: submitter,
  timestampMs: String(Date.now()),
  indexedAt: new Date().toISOString()
};

const headers = {
  "content-type": "application/json"
};
if (process.env.SUI402_CONSOLE_ADMIN_API_KEY) {
  headers.authorization = `Bearer ${process.env.SUI402_CONSOLE_ADMIN_API_KEY}`;
}

const response = await fetch(`${consoleUrl}/v1/indexer/settlement-events`, {
  method: "POST",
  headers,
  body: JSON.stringify({ record })
});
const bodyText = await response.text();
const body = parseBody(bodyText);

if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, body }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: response.status,
      record,
      response: body
    },
    null,
    2
  )
);

function env(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env ${key}`);
  }

  return value;
}

function readActiveAddress() {
  const result = spawnSync("sui", ["client", "active-address"], {
    encoding: "utf8",
    shell: true
  });
  if (result.status !== 0) {
    throw new Error(`Set SUI402_SETTLEMENT_SUBMITTER or configure Sui CLI active address: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function parseBody(text) {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
