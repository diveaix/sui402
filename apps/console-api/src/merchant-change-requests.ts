import { randomUUID } from "node:crypto";
import { z } from "zod";

export const MerchantChangeRequestChangesSchema = z
  .object({
    merchant: z.string().min(1).optional(),
    network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).optional(),
    coinType: z.string().min(1).optional()
  })
  .strict()
  .refine((value) => value.merchant || value.network || value.coinType, {
    message: "Provide at least one high-risk merchant change"
  });

export const MerchantChangeRequestSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  merchantId: z.string().min(1),
  changes: MerchantChangeRequestChangesSchema,
  requestedBy: z.string().min(1).optional(),
  requestedByRoles: z.array(z.enum(["seller_viewer", "seller_admin"])).optional(),
  reason: z.string().max(4000).optional(),
  submittedAt: z.string().datetime(),
  reviewDueAt: z.string().datetime().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewer: z.string().min(1).optional(),
  reviewReason: z.string().max(4000).optional(),
  appliedMerchantId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const MerchantChangeRequestSubmitSchema = z.object({
  id: z.string().min(1).optional(),
  changes: MerchantChangeRequestChangesSchema,
  reason: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const MerchantChangeRequestReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewer: z.string().min(1).optional(),
  reason: z.string().max(4000).optional()
});

export type MerchantChangeRequest = z.infer<typeof MerchantChangeRequestSchema>;
export type MerchantChangeRequestSubmit = z.infer<typeof MerchantChangeRequestSubmitSchema>;
export type MerchantChangeRequestReview = z.infer<typeof MerchantChangeRequestReviewSchema>;

export type MerchantChangeRequestQuery = {
  merchantId?: string;
  status?: MerchantChangeRequest["status"];
  limit?: number;
};

export type MerchantChangeRequestStore = {
  submit(request: MerchantChangeRequest): Promise<void> | void;
  update(request: MerchantChangeRequest): Promise<void> | void;
  get(id: string): Promise<MerchantChangeRequest | undefined> | MerchantChangeRequest | undefined;
  list(query?: MerchantChangeRequestQuery): Promise<MerchantChangeRequest[]> | MerchantChangeRequest[];
};

export class MemoryMerchantChangeRequestStore implements MerchantChangeRequestStore {
  readonly #requests = new Map<string, MerchantChangeRequest>();

  submit(request: MerchantChangeRequest): void {
    this.#requests.set(request.id, request);
  }

  update(request: MerchantChangeRequest): void {
    this.#requests.set(request.id, request);
  }

  get(id: string): MerchantChangeRequest | undefined {
    return this.#requests.get(id);
  }

  list(query: MerchantChangeRequestQuery = {}): MerchantChangeRequest[] {
    return [...this.#requests.values()]
      .filter((request) => matchesMerchantChangeRequestQuery(request, query))
      .sort(compareMerchantChangeRequestsDescending)
      .slice(0, query.limit ?? 100);
  }
}

export function createMerchantChangeRequest(
  input: MerchantChangeRequestSubmit & {
    merchantId: string;
    requestedBy?: string;
    requestedByRoles?: MerchantChangeRequest["requestedByRoles"];
  },
  options: { now?: Date; reviewSlaHours?: number } = {}
): MerchantChangeRequest {
  const now = options.now ?? new Date();
  const reviewSlaHours = options.reviewSlaHours ?? 72;
  if (!Number.isFinite(reviewSlaHours) || reviewSlaHours <= 0) {
    throw new Error("Merchant change review SLA must be a positive number of hours");
  }

  return MerchantChangeRequestSchema.parse({
    id: input.id ?? `mchg_${randomUUID()}`,
    status: "pending",
    merchantId: input.merchantId,
    changes: input.changes,
    requestedBy: input.requestedBy,
    requestedByRoles: input.requestedByRoles,
    reason: input.reason,
    submittedAt: now.toISOString(),
    reviewDueAt: new Date(now.getTime() + reviewSlaHours * 60 * 60 * 1000).toISOString(),
    metadata: input.metadata
  });
}

export function reviewMerchantChangeRequest(
  request: MerchantChangeRequest,
  input: MerchantChangeRequestReview,
  appliedMerchantId?: string
): MerchantChangeRequest {
  if (request.status !== "pending") {
    throw new Error(`Merchant change request ${request.id} has already been ${request.status}`);
  }

  return MerchantChangeRequestSchema.parse({
    ...request,
    status: input.action === "approve" ? "approved" : "rejected",
    reviewedAt: new Date().toISOString(),
    reviewer: input.reviewer,
    reviewReason: input.reason,
    appliedMerchantId
  });
}

export function matchesMerchantChangeRequestQuery(
  request: MerchantChangeRequest,
  query: MerchantChangeRequestQuery
): boolean {
  return (
    (!query.merchantId || request.merchantId === query.merchantId) &&
    (!query.status || request.status === query.status)
  );
}

export function compareMerchantChangeRequestsDescending(
  left: MerchantChangeRequest,
  right: MerchantChangeRequest
): number {
  return Date.parse(right.submittedAt) - Date.parse(left.submittedAt) || right.id.localeCompare(left.id);
}
