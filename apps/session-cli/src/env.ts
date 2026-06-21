import type { SuiClientTypes } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";
import type { Sui402Network } from "@sui402/protocol";

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

export function getNetwork(): Sui402Network {
  const network = process.env.SUI402_NETWORK ?? "sui:testnet";
  if (!["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"].includes(network)) {
    throw new Error(`Unsupported SUI402_NETWORK: ${network}`);
  }
  return network as Sui402Network;
}

export function getSuiNetwork(): "mainnet" | "testnet" | "devnet" | "localnet" {
  return getNetwork().replace("sui:", "") as "mainnet" | "testnet" | "devnet" | "localnet";
}

export function getClient(): SuiGrpcClient {
  const network = getSuiNetwork();
  return new SuiGrpcClient({
    network,
    baseUrl: process.env.SUI_GRPC_URL ?? grpcUrlForNetwork(network)
  });
}

export function getKeypair(): Ed25519Keypair {
  const secretKey = process.env.SUI_SECRET_KEY;
  const mnemonic = process.env.SUI_MNEMONIC;

  if (secretKey) {
    const decoded = decodeSuiPrivateKey(secretKey);
    if (decoded.scheme !== "ED25519") {
      throw new Error(`SUI_SECRET_KEY uses ${decoded.scheme}; this CLI currently supports ED25519 only`);
    }
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }

  if (mnemonic) {
    return Ed25519Keypair.deriveKeypair(mnemonic);
  }

  throw new Error("Set SUI_SECRET_KEY or SUI_MNEMONIC");
}

export type CliTransactionResponse = SuiClientTypes.Transaction<{
  effects: true;
  events: true;
  objectTypes: true;
  balanceChanges: true;
}>;

export async function signAndExecute(transaction: Transaction): Promise<CliTransactionResponse> {
  const client = getClient();
  const signer = getKeypair();
  const result = await client.signAndExecuteTransaction({
    transaction,
    signer,
    include: {
      effects: true,
      events: true,
      objectTypes: true,
      balanceChanges: true
    }
  });
  if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }
  return result.Transaction;
}

export function findCreatedSessionId(response: CliTransactionResponse): string | undefined {
  return findCreatedObjectId(response, "::sessions::AgentPaymentSession");
}

export function findCreatedSettlementLedgerId(response: CliTransactionResponse): string | undefined {
  return findCreatedObjectId(response, "::settlement::SettlementLedger");
}

export function printResponse(response: CliTransactionResponse, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify(
      {
        digest: response.digest,
        status: response.status,
        ...extra
      },
      null,
      2
    )
  );
}

function findCreatedObjectId(response: CliTransactionResponse, typeFragment: string): string | undefined {
  return response.effects?.changedObjects.find(
    (change) =>
      change.idOperation === "Created" &&
      response.objectTypes?.[change.objectId]?.includes(typeFragment)
  )?.objectId;
}

function grpcUrlForNetwork(network: "mainnet" | "testnet" | "devnet" | "localnet"): string {
  switch (network) {
    case "mainnet":
      return "https://fullnode.mainnet.sui.io:443";
    case "testnet":
      return "https://fullnode.testnet.sui.io:443";
    case "devnet":
      return "https://fullnode.devnet.sui.io:443";
    case "localnet":
      return "http://127.0.0.1:9000";
  }
}
