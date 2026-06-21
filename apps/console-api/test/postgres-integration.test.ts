import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createConfiguredConsoleStores, createConsoleApp, type ConsoleStores } from "../src/app.js";
import type { ConsoleConfig } from "../src/config.js";
import { verifyAuditHashChain } from "../src/audit.js";

const POSTGRES_URL = process.env.SUI402_CONSOLE_POSTGRES_URL ?? process.env.SUI402_POSTGRES_URL;
const maybeDescribe = POSTGRES_URL ? describe : describe.skip;
const MERCHANT = `0x${"a".repeat(64)}`;

maybeDescribe("console API Postgres integration", () => {
  const suffix = randomUUID().replaceAll("-", "_");
  const config: ConsoleConfig = {
    NODE_ENV: "production",
    PORT: 4030,
    SUI402_CONSOLE_ADMIN_API_KEY: undefined,
    SUI402_CONSOLE_OPERATOR_KEYS_JSON: JSON.stringify([
      { id: "viewer", key: "viewer-key-with-length", roles: ["viewer"] },
      { id: "merchant-admin", key: "merchant-admin-key", roles: ["merchant_admin"] },
      { id: "indexer", key: "indexer-key-with-len", roles: ["indexer"] },
      { id: "admin", key: "admin-key-with-length", roles: ["admin"] }
    ]),
    SUI402_CONSOLE_OIDC_ROLE_CLAIM: "roles",
    SUI402_CONSOLE_OIDC_SUBJECT_CLAIM: "sub",
    SUI402_CONSOLE_PROVIDER_BASE_URL: "http://localhost:4030",
    SUI402_CONSOLE_STORAGE_DRIVER: "postgres",
    SUI402_CONSOLE_FILE_STORE_PATH: ".sui402/console-store.json",
    SUI402_CONSOLE_POSTGRES_URL: POSTGRES_URL,
    SUI402_CONSOLE_RUN_STORAGE_MIGRATIONS: true,
    SUI402_CONSOLE_MERCHANT_TABLE: `sui402_cert_merchants_${suffix}`,
    SUI402_CONSOLE_LISTING_TABLE: `sui402_cert_listings_${suffix}`,
    SUI402_CONSOLE_CHALLENGE_TABLE: `sui402_cert_challenges_${suffix}`,
    SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE: `sui402_cert_consumed_challenges_${suffix}`,
    SUI402_CONSOLE_PAYMENT_RECORD_TABLE: `sui402_cert_payment_records_${suffix}`,
    SUI402_CONSOLE_SESSION_SPEND_TABLE: `sui402_cert_session_spends_${suffix}`,
    SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE: `sui402_cert_settlements_${suffix}`,
    SUI402_CONSOLE_INDEXER_CURSOR_TABLE: `sui402_cert_cursors_${suffix}`,
    SUI402_CONSOLE_EXPORT_TABLE: `sui402_cert_exports_${suffix}`,
    SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE: `sui402_cert_applications_${suffix}`,
    SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE: `sui402_cert_change_requests_${suffix}`,
    SUI402_CONSOLE_AUDIT_TABLE: `sui402_cert_audit_${suffix}`,
    SUI402_CONSOLE_RATE_LIMIT_TABLE: `sui402_cert_rate_limits_${suffix}`,
    SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_MAX: 20,
    SUI402_CONSOLE_PUBLIC_INTAKE_RATE_LIMIT_WINDOW_MS: 60000,
    SUI402_CONSOLE_MERCHANT_REVIEW_SLA_HOURS: 72,
    SUI402_RECEIPT_SIGNER_PROVIDER: "local",
    SUI402_RECEIPT_SIGNER_ID: undefined,
    SUI402_RECEIPT_PRIVATE_KEY_PEM: undefined,
    SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: undefined,
    SUI402_RECEIPT_TTL_SECONDS: 86400,
    SUI402_WALRUS_PUBLISHER_URL: undefined,
    SUI402_WALRUS_EPOCHS: 5
  };
  const tables = [
    config.SUI402_CONSOLE_AUDIT_TABLE,
    config.SUI402_CONSOLE_RATE_LIMIT_TABLE,
    config.SUI402_CONSOLE_MERCHANT_CHANGE_REQUEST_TABLE,
    config.SUI402_CONSOLE_MERCHANT_APPLICATION_TABLE,
    config.SUI402_CONSOLE_EXPORT_TABLE,
    config.SUI402_CONSOLE_INDEXER_CURSOR_TABLE,
    config.SUI402_CONSOLE_SETTLEMENT_EVENT_TABLE,
    config.SUI402_CONSOLE_SESSION_SPEND_TABLE,
    config.SUI402_CONSOLE_PAYMENT_RECORD_TABLE,
    config.SUI402_CONSOLE_CONSUMED_CHALLENGE_TABLE,
    config.SUI402_CONSOLE_CHALLENGE_TABLE,
    config.SUI402_CONSOLE_LISTING_TABLE,
    config.SUI402_CONSOLE_MERCHANT_TABLE
  ];

  afterAll(async () => {
    const pool = new pg.Pool({ connectionString: POSTGRES_URL });
    try {
      for (const table of tables) {
        await pool.query(`drop table if exists ${table}`);
      }
    } finally {
      await pool.end();
    }
  });

  it("persists production console state and indexer cursors across restarts", async () => {
    const firstStores = await createConfiguredConsoleStores(config, false);
    const firstServer = createConsoleApp(config, { stores: firstStores, seed: false }).listen(0);
    const base = serverBaseUrl(firstServer);
    const cursorKey = `settlement:0x${"f".repeat(64)}:0x2::sui::SUI`;
    const encodedCursorKey = encodeURIComponent(cursorKey);

    try {
      const createMerchant = await fetch(`${base}/v1/merchants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer merchant-admin-key"
        },
        body: JSON.stringify({
          id: "cert-api",
          service: "Certification API",
          merchant: MERCHANT,
          coinType: "0x2::sui::SUI",
          price: "1000",
          resourceScope: "api:cert",
          transport: "http"
        })
      });
      const cursorUpdate = await fetch(`${base}/v1/indexer/cursors/${encodedCursorKey}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer indexer-key-with-len"
        },
        body: JSON.stringify({ cursor: "345425998:0" })
      });
      expect(createMerchant.status).toBe(201);
      expect(cursorUpdate.status).toBe(200);
    } finally {
      firstServer.close();
      await closeStores(firstStores);
    }

    const secondStores = await createConfiguredConsoleStores(config, false);
    const secondServer = createConsoleApp(config, { stores: secondStores, seed: false }).listen(0);
    const secondBase = serverBaseUrl(secondServer);
    try {
      const overview = await fetch(`${secondBase}/v1/overview`, {
        headers: { authorization: "Bearer viewer-key-with-length" }
      });
      const cursor = await fetch(`${secondBase}/v1/indexer/cursors/${encodedCursorKey}`, {
        headers: { authorization: "Bearer indexer-key-with-len" }
      });
      const audit = await fetch(`${secondBase}/v1/audit-events?action=indexer.cursor.update`, {
        headers: { authorization: "Bearer admin-key-with-length" }
      });

      expect(overview.status).toBe(200);
      expect((await overview.json()).merchants).toContainEqual(expect.objectContaining({ id: "cert-api" }));
      expect(cursor.status).toBe(200);
      expect(await cursor.json()).toMatchObject({
        state: { key: cursorKey, cursor: "345425998:0" }
      });
      expect(audit.status).toBe(200);
      expect((await audit.json()).events).toHaveLength(1);
    } finally {
      secondServer.close();
      await closeStores(secondStores);
    }
  }, 30_000);

  it("serializes concurrent Postgres audit appends into one hash chain", async () => {
    const stores = await createConfiguredConsoleStores(config, false);
    try {
      if (!stores.audit.append) {
        throw new Error("Postgres audit store must support atomic append");
      }
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          stores.audit.append!({
            id: `concurrent-audit-${index.toString().padStart(2, "0")}`,
            action: "merchant_application.submit",
            createdAt: "2026-05-20T00:00:00.000Z",
            metadata: { index }
          })
        )
      );
      const events = await stores.audit.list({ limit: 100 });
      expect(verifyAuditHashChain(events)).toMatchObject({
        ok: true,
        checked: expect.any(Number)
      });
      expect(events.filter((event) => event.id.startsWith("concurrent-audit-"))).toHaveLength(12);
    } finally {
      await closeStores(stores);
    }
  }, 30_000);
});

function serverBaseUrl(server: ReturnType<typeof import("node:http").createServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function closeStores(stores: ConsoleStores): Promise<void> {
  await stores.close?.();
}
