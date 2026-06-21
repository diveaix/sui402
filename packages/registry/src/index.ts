import express, { type Request, type Response } from "express";
import { z } from "zod";
import { SUI402_VERSION, Sui402NetworkSchema, type Sui402ProviderManifest } from "@sui402/protocol";

export const Sui402ListingTransportSchema = z.enum(["http", "mcp"]);
export type Sui402ListingTransport = z.infer<typeof Sui402ListingTransportSchema>;

export const Sui402ServiceListingInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  providerBaseUrl: z.string().url(),
  transport: Sui402ListingTransportSchema,
  network: Sui402NetworkSchema,
  merchant: z.string().min(1),
  coinType: z.string().min(1),
  price: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  resourceScopeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sessionSupported: z.boolean().default(false),
  sessionManagerUrl: z.string().url().optional(),
  mcpServerUrl: z.string().url().optional(),
  protectedResourceUrl: z.string().url().optional(),
  tags: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)).max(20).default([]),
  status: z.enum(["active", "paused"]).default("active"),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type Sui402ServiceListingInput = z.input<typeof Sui402ServiceListingInputSchema>;

export const Sui402ServiceListingSchema = Sui402ServiceListingInputSchema.extend({
  version: z.literal(SUI402_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Sui402ServiceListing = z.infer<typeof Sui402ServiceListingSchema>;

export type ListingQuery = {
  network?: string;
  transport?: Sui402ListingTransport;
  tag?: string;
  merchant?: string;
  status?: "active" | "paused";
  limit?: number;
};

export type ListingStore = {
  upsert(listing: Sui402ServiceListing): Promise<void> | void;
  get(id: string): Promise<Sui402ServiceListing | undefined> | Sui402ServiceListing | undefined;
  list(query?: ListingQuery): Promise<Sui402ServiceListing[]> | Sui402ServiceListing[];
};

export class MemoryListingStore implements ListingStore {
  readonly #listings = new Map<string, Sui402ServiceListing>();

  upsert(listing: Sui402ServiceListing): void {
    this.#listings.set(listing.id, listing);
  }

  get(id: string): Sui402ServiceListing | undefined {
    return this.#listings.get(id);
  }

  list(query: ListingQuery = {}): Sui402ServiceListing[] {
    const limit = query.limit ?? 100;
    return [...this.#listings.values()]
      .filter((listing) => matchesQuery(listing, query))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit);
  }
}

export type RegistryRouterOptions = {
  store: ListingStore;
  adminAuth?: express.RequestHandler;
  adminApiKey?: string;
  maxLimit?: number;
};

export function createRegistryRouter(options: RegistryRouterOptions): express.Router {
  const router = express.Router();
  const maxLimit = options.maxLimit ?? 100;
  const adminAuth = options.adminAuth ?? requireAdmin(options.adminApiKey);

  router.get("/listings", async (req, res, next) => {
    try {
      const listings = await options.store.list({
        network: readOptionalQuery(req.query.network),
        transport: readTransportQuery(req.query.transport),
        tag: readOptionalQuery(req.query.tag),
        merchant: readOptionalQuery(req.query.merchant),
        status: readStatusQuery(req.query.status),
        limit: readLimitQuery(req.query.limit, maxLimit)
      });

      res.json({
        version: SUI402_VERSION,
        count: listings.length,
        listings
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ error: "invalid_listing", message: "Listing id is required" });
        return;
      }

      const listing = await options.store.get(id);
      if (!listing) {
        res.status(404).json({ error: "listing_not_found", message: "Listing not found" });
        return;
      }

      res.json(listing);
    } catch (error) {
      next(error);
    }
  });

  router.post("/listings", express.json({ limit: "1mb" }), adminAuth, async (req, res, next) => {
    try {
      const listing = createServiceListing(req.body);
      await options.store.upsert(listing);
      res.status(201).json(listing);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "invalid_listing", issues: error.issues });
        return;
      }

      next(error);
    }
  });

  return router;
}

export function createServiceListing(
  input: Sui402ServiceListingInput,
  now = new Date()
): Sui402ServiceListing {
  const parsed = Sui402ServiceListingInputSchema.parse(input);
  const timestamp = now.toISOString();
  return {
    version: SUI402_VERSION,
    ...parsed,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createListingFromManifest(input: {
  id: string;
  name: string;
  providerBaseUrl: string;
  transport: Sui402ListingTransport;
  manifest: Sui402ProviderManifest;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): Sui402ServiceListing {
  const baseUrl = new URL(input.providerBaseUrl);
  const absolute = (path: string | undefined): string | undefined => (path ? new URL(path, baseUrl).toString() : undefined);

  return createServiceListing({
    id: input.id,
    name: input.name,
    description: input.description,
    providerBaseUrl: baseUrl.toString(),
    transport: input.transport,
    network: input.manifest.network,
    merchant: input.manifest.merchant,
    coinType: input.manifest.coinType,
    price: input.manifest.price,
    resourceScope: input.manifest.resourceScope,
    resourceScopeHash: input.manifest.resourceScopeHash,
    sessionSupported: input.manifest.sessions.enabled,
    sessionManagerUrl: absolute(input.manifest.endpoints.sessionManager),
    protectedResourceUrl: absolute(input.manifest.endpoints.protectedResource),
    tags: input.tags ?? [],
    metadata: input.metadata
  });
}

function matchesQuery(listing: Sui402ServiceListing, query: ListingQuery): boolean {
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

function requireAdmin(apiKey: string | undefined): express.RequestHandler {
  return (req, res, next) => {
    if (!apiKey) {
      res.status(403).json({ error: "registry_read_only", message: "Registry writes are disabled" });
      return;
    }

    const bearer = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const header = req.header("x-sui402-admin-key");
    if (bearer !== apiKey && header !== apiKey) {
      res.status(401).json({ error: "unauthorized", message: "Invalid registry admin key" });
      return;
    }

    next();
  };
}

function readOptionalQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return readOptionalQuery(value[0]);
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTransportQuery(value: unknown): Sui402ListingTransport | undefined {
  const parsed = readOptionalQuery(value);
  return parsed ? Sui402ListingTransportSchema.parse(parsed) : undefined;
}

function readStatusQuery(value: unknown): "active" | "paused" | undefined {
  const parsed = readOptionalQuery(value);
  if (!parsed) {
    return undefined;
  }

  if (parsed !== "active" && parsed !== "paused") {
    throw new Error("status query must be active or paused");
  }

  return parsed;
}

function readLimitQuery(value: unknown, maxLimit: number): number {
  const parsed = readOptionalQuery(value);
  if (!parsed) {
    return maxLimit;
  }

  const limit = Number(parsed);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit query must be a positive integer");
  }

  return Math.min(limit, maxLimit);
}
