import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresIndexerCursorStore, PostgresSettlementIndexStore } from "../src/index.js";
import { runIndexerSyncOnce, type IndexerSyncConfig } from "../src/sync.js";

const POSTGRES_URL = process.env.SUI402_INDEXER_POSTGRES_URL ?? process.env.SUI402_POSTGRES_URL;
const maybeDescribe = POSTGRES_URL ? describe : describe.skip;
const PACKAGE = "0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b";
const COIN_TYPE = "0x2::sui::SUI";

maybeDescribe("indexer Postgres integration", () => {
  const suffix = randomUUID().replaceAll("-", "_");
  const settlementTable = `sui402_cert_settlements_${suffix}`;
  const cursorTable = `sui402_cert_cursors_${suffix}`;
  const tempDir = mkdtempSync(join(tmpdir(), "sui402-indexer-cert-"));

  afterAll(async () => {
    const pool = new pg.Pool({ connectionString: POSTGRES_URL });
    try {
      await pool.query(`drop table if exists ${settlementTable}`);
      await pool.query(`drop table if exists ${cursorTable}`);
    } finally {
      await pool.end();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("indexes settlement events into Postgres with a durable cursor", async () => {
    const jsonlPath = join(tempDir, "settlement-events.jsonl");
    writeFileSync(
      jsonlPath,
      `${JSON.stringify({
        id: {
          txDigest: "cert-settlement-digest",
          eventSeq: "0"
        },
        packageId: PACKAGE,
        transactionModule: "settlement",
        sender: `0x${"a".repeat(64)}`,
        type: `${PACKAGE}::settlement::ReceiptSettled<${COIN_TYPE}>`,
        parsedJson: {
          ledger_id: `0x${"9".repeat(64)}`,
          receipt_id: Buffer.from("33".repeat(32), "hex").toString("base64"),
          payer: `0x${"b".repeat(64)}`,
          merchant: `0x${"a".repeat(64)}`,
          signer: `0x${"c".repeat(64)}`,
          amount: "1000",
          sequence: "1",
          resource_scope_hash: Buffer.from("22".repeat(32), "hex").toString("base64"),
          submitter: `0x${"a".repeat(64)}`
        },
        timestampMs: "1780791692633"
      })}\n`,
      "utf8"
    );
    const config: IndexerSyncConfig = {
      command: "sync",
      eventKind: "settlement",
      source: "jsonl",
      sink: "postgres",
      network: "sui:testnet",
      packageId: PACKAGE,
      coinType: COIN_TYPE,
      graphqlUrl: undefined,
      jsonlPath,
      grpcUrl: undefined,
      grpcStartCheckpoint: undefined,
      grpcMaxCheckpointsPerPage: 1,
      postgresUrl: POSTGRES_URL,
      consoleUrl: undefined,
      consoleApiKey: undefined,
      tableName: settlementTable,
      cursorTableName: cursorTable,
      cursorKey: `settlement:${PACKAGE}:${COIN_TYPE}`,
      cursor: undefined,
      pageLimit: 10,
      maxPages: 1,
      setup: true,
      summarize: true,
      loop: false,
      intervalMs: 30000,
      retryInitialMs: 1000,
      retryMaxMs: 60000,
      maxRuns: undefined
    };

    const result = await runIndexerSyncOnce(config);
    expect(result).toMatchObject({
      ok: true,
      eventKind: "settlement",
      result: {
        processed: 1,
        skipped: 0,
        nextCursor: "1"
      }
    });

    const pool = new pg.Pool({ connectionString: POSTGRES_URL });
    try {
      const settlements = new PostgresSettlementIndexStore({
        client: pool,
        tableName: settlementTable
      });
      const cursors = new PostgresIndexerCursorStore({
        client: pool,
        tableName: cursorTable
      });
      expect(await cursors.getCursor(config.cursorKey)).toMatchObject({
        cursor: "1"
      });
      expect(await settlements.list({ limit: 10 })).toContainEqual(
        expect.objectContaining({
          txDigest: "cert-settlement-digest",
          receiptId: "33".repeat(32),
          ledgerId: `0x${"9".repeat(64)}`
        })
      );
    } finally {
      await pool.end();
    }
  }, 45_000);
});
