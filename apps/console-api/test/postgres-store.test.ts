import { describe, expect, it } from "vitest";
import { createGatewayManifest, createGatewayMerchantConfig } from "@sui402/gateway";
import { createListingFromManifest } from "@sui402/registry";
import type { PostgresQueryResult } from "@sui402/storage";
import {
  PostgresArtifactExportStore,
  PostgresListingStore,
  PostgresMerchantChangeRequestStore,
  PostgresMerchantStore,
  createPostgresConsoleStoreBundle
} from "../src/postgres-store.js";
import type { ConsoleArtifactExport } from "../src/exports.js";
import type { MerchantChangeRequest } from "../src/merchant-change-requests.js";
import { PostgresWindowRateLimitStore } from "../src/rate-limit.js";

const MERCHANT = `0x${"a".repeat(64)}`;

class FakePostgres {
  merchants = new Map<string, Record<string, unknown>>();
  listings = new Map<string, Record<string, unknown>>();
  exports = new Map<string, Record<string, unknown>>();
  merchantChangeRequests = new Map<string, Record<string, unknown>>();
  rateLimits = new Map<string, { count: number; reset_at: Date }>();

  async query<Row = unknown>(text: string, values: unknown[] = []): Promise<PostgresQueryResult<Row>> {
    if (text.includes("insert into sui402_console_merchants")) {
      const [id, merchant, status] = values;
      this.merchants.set(String(id), {
        id,
        merchant: JSON.parse(String(merchant)),
        status
      });
      return { rows: [] };
    }

    if (text.includes("from sui402_console_merchants") && text.includes("where id = $1")) {
      const row = this.merchants.get(String(values[0]));
      return { rows: row ? ([{ merchant: row.merchant }] as Row[]) : [] };
    }

    if (text.includes("from sui402_console_merchants") && text.includes("order by id asc")) {
      return {
        rows: [...this.merchants.values()]
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
          .map((row) => ({ merchant: row.merchant })) as Row[]
      };
    }

    if (text.includes("insert into sui402_console_listings")) {
      const [id, listing, network, transport, merchant, status, tags, updatedAt] = values;
      this.listings.set(String(id), {
        id,
        listing: JSON.parse(String(listing)),
        network,
        transport,
        merchant,
        status,
        tags,
        updated_at: updatedAt
      });
      return { rows: [] };
    }

    if (text.includes("from sui402_console_listings") && text.includes("where id = $1")) {
      const row = this.listings.get(String(values[0]));
      return { rows: row ? ([{ listing: row.listing }] as Row[]) : [] };
    }

    if (text.includes("from sui402_console_listings") && text.includes("order by updated_at desc")) {
      return {
        rows: [...this.listings.values()]
          .sort((left, right) => Date.parse(String(right.updated_at)) - Date.parse(String(left.updated_at)))
          .slice(0, Number(values.at(-1)))
          .map((row) => ({ listing: row.listing })) as Row[]
      };
    }

    if (text.includes("insert into sui402_console_exports")) {
      const [id, exportRecord, kind, blobId, paymentCount, createdAt] = values;
      this.exports.set(String(id), {
        id,
        export: JSON.parse(String(exportRecord)),
        kind,
        blob_id: blobId,
        payment_count: paymentCount,
        created_at: createdAt
      });
      return { rows: [] };
    }

    if (text.includes("from sui402_console_exports")) {
      return {
        rows: [...this.exports.values()]
          .sort((left, right) => Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)))
          .slice(0, Number(values[0]))
          .map((row) => ({ export: row.export })) as Row[]
      };
    }

    if (text.includes("insert into sui402_merchant_change_requests")) {
      const [id, request, merchantId, status, submittedAt, reviewedAt] = values;
      this.merchantChangeRequests.set(String(id), {
        id,
        request: JSON.parse(String(request)),
        merchant_id: merchantId,
        status,
        submitted_at: submittedAt,
        reviewed_at: reviewedAt
      });
      return { rows: [] };
    }

    if (text.includes("from sui402_merchant_change_requests") && text.includes("where id = $1")) {
      const row = this.merchantChangeRequests.get(String(values[0]));
      return { rows: row ? ([{ request: row.request }] as Row[]) : [] };
    }

    if (text.includes("from sui402_merchant_change_requests")) {
      let rows = [...this.merchantChangeRequests.values()];
      if (text.includes("status = $1")) {
        rows = rows.filter((row) => row.status === values[0]);
      }
      if (text.includes("merchant_id = $1")) {
        rows = rows.filter((row) => row.merchant_id === values[0]);
      } else if (text.includes("merchant_id = $2")) {
        rows = rows.filter((row) => row.merchant_id === values[1]);
      }
      return {
        rows: rows
          .sort((left, right) => Date.parse(String(right.submitted_at)) - Date.parse(String(left.submitted_at)))
          .slice(0, Number(values.at(-1)))
          .map((row) => ({ request: row.request })) as Row[]
      };
    }

    if (text.includes("insert into sui402_console_rate_limits")) {
      const [key, windowMs] = values;
      const existing = this.rateLimits.get(String(key));
      const resetAt =
        !existing || existing.reset_at.getTime() <= Date.now()
          ? new Date(Date.now() + Number(windowMs))
          : existing.reset_at;
      const count = !existing || existing.reset_at.getTime() <= Date.now() ? 1 : existing.count + 1;
      this.rateLimits.set(String(key), { count, reset_at: resetAt });
      return { rows: [{ count, reset_at: resetAt }] as Row[] };
    }

    return { rows: [] };
  }
}

describe("Postgres console stores", () => {
  it("persists merchant, listing, and export objects", async () => {
    const postgres = new FakePostgres();
    const merchants = new PostgresMerchantStore({ client: postgres });
    const listings = new PostgresListingStore({ client: postgres });
    const exports = new PostgresArtifactExportStore({ client: postgres });
    const merchantChangeRequests = new PostgresMerchantChangeRequestStore({ client: postgres });
    const merchant = createGatewayMerchantConfig({
      id: "merchant-api",
      service: "Merchant API",
      network: "sui:testnet",
      merchant: MERCHANT,
      coinType: "0x2::sui::SUI",
      price: "1000",
      resourceScope: "api:*"
    });
    const listing = createListingFromManifest({
      id: merchant.id,
      name: merchant.service,
      providerBaseUrl: "http://localhost:4030",
      transport: "http",
      manifest: createGatewayManifest(merchant),
      tags: ["api"]
    });
    const exportRecord: ConsoleArtifactExport = {
      id: `${"b".repeat(64)}:blob-1`,
      kind: "payment-ledger",
      artifactId: "b".repeat(64),
      artifactKind: "audit-log",
      blobId: "blob-1",
      paymentCount: 2,
      createdAt: "2026-05-19T00:00:00.000Z"
    };
    const changeRequest: MerchantChangeRequest = {
      id: "change-1",
      status: "pending",
      merchantId: "merchant-api",
      changes: {
        merchant: `0x${"f".repeat(64)}`
      },
      requestedBy: "seller-admin",
      requestedByRoles: ["seller_admin"],
      reason: "Rotate payout wallet",
      submittedAt: "2026-05-19T00:00:00.000Z",
      reviewDueAt: "2026-05-22T00:00:00.000Z"
    };

    await merchants.upsert(merchant);
    await listings.upsert(listing);
    await exports.record(exportRecord);
    await merchantChangeRequests.submit(changeRequest);

    expect(await merchants.get("merchant-api")).toEqual(merchant);
    expect(await merchants.list()).toEqual([merchant]);
    expect(await listings.get("merchant-api")).toEqual(listing);
    expect(await listings.list()).toEqual([listing]);
    expect(await exports.list()).toEqual([exportRecord]);
    expect(await merchantChangeRequests.get("change-1")).toEqual(changeRequest);
    expect(await merchantChangeRequests.list({ merchantId: "merchant-api" })).toEqual([changeRequest]);
  });

  it("creates a bundle and rejects unsafe table names", async () => {
    const postgres = new FakePostgres();
    const bundle = createPostgresConsoleStoreBundle({ client: postgres });

    await expect(bundle.setup()).resolves.toBeUndefined();
    expect(() => new PostgresMerchantStore({ client: postgres, tableName: "bad;drop" })).toThrow(
      /Unsafe SQL identifier/
    );
    expect(() => new PostgresWindowRateLimitStore({ client: postgres, tableName: "bad;drop" })).toThrow(
      /Unsafe SQL identifier/
    );
  });

  it("shares public intake rate limit counters in Postgres", async () => {
    const postgres = new FakePostgres();
    const rateLimits = new PostgresWindowRateLimitStore({ client: postgres });

    await expect(rateLimits.consume("ip:user-agent", { max: 1, windowMs: 60_000 })).resolves.toEqual({
      allowed: true
    });
    await expect(rateLimits.consume("ip:user-agent", { max: 1, windowMs: 60_000 })).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number)
    });
  });
});
