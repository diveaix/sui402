import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Sui402SpendingPolicySchema } from "@sui402/policy";

const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export const MerchantApplicationRequestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/),
  service: z.string().min(1),
  merchant: z.string().min(1),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).default("sui:testnet"),
  coinType: z.string().min(1),
  price: z.string().regex(/^\d+$/),
  resourceScope: z.string().min(1),
  upstreamUrl: z.string().url().optional(),
  upstreamTimeoutMs: z.number().int().positive().max(120_000).default(15_000),
  sessionPackageId: z.string().min(1).optional(),
  paymentPolicy: Sui402SpendingPolicySchema.optional(),
  transport: z.enum(["http", "mcp"]).default("http")
});

export const MerchantApplicationVerificationSchema = z.object({
  method: z.enum(["well-known", "dns-txt"]),
  status: z.enum(["pending", "verified", "failed"]),
  token: z.string().min(16),
  accessToken: z.string().min(16).optional(),
  verificationUrl: z.string().url(),
  dnsTxtName: z.string().min(1).optional(),
  dnsTxtValue: z.string().min(1).optional(),
  expectedUpstreamUrl: z.string().url(),
  checkedAt: z.string().datetime().optional(),
  verifiedAt: z.string().datetime().optional(),
  error: z.string().max(1000).optional()
});

export const MerchantApplicationSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  request: MerchantApplicationRequestSchema,
  verification: MerchantApplicationVerificationSchema.optional(),
  applicant: z
    .object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      organization: z.string().min(1).optional(),
      notes: z.string().max(4000).optional()
    })
    .default({}),
  submittedAt: z.string().datetime(),
  reviewDueAt: z.string().datetime().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewer: z.string().min(1).optional(),
  reviewReason: z.string().max(4000).optional(),
  publishedMerchantId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const MerchantApplicationSubmitSchema = z.object({
  id: z.string().min(1).optional(),
  request: MerchantApplicationRequestSchema,
  applicant: MerchantApplicationSchema.shape.applicant.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const PublisherApiDraftSchema = z.object({
  apiUrl: z.string().url(),
  openApiUrl: z.string().url().optional(),
  openApiOperationId: z.string().min(1).optional(),
  openApiMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  openApiPath: z.string().min(1).optional(),
  id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/).optional(),
  service: z.string().min(1).optional(),
  merchant: z.string().min(1),
  network: z.enum(["sui:mainnet", "sui:testnet", "sui:devnet", "sui:localnet"]).default("sui:testnet"),
  coinType: z.string().min(1).default("0x2::sui::SUI"),
  price: z.string().regex(/^\d+$/).default("1000000"),
  resourceScope: z.string().min(1).optional(),
  upstreamTimeoutMs: z.number().int().positive().max(120_000).default(15_000),
  sessionPackageId: z.string().min(1).optional(),
  transport: z.enum(["http", "mcp"]).default("http"),
  applicantEmail: z.string().email().optional(),
  organization: z.string().min(1).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const MerchantApplicationReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewer: z.string().min(1).optional(),
  reason: z.string().max(4000).optional()
});

export type MerchantApplicationRequest = z.infer<typeof MerchantApplicationRequestSchema>;
export type MerchantApplicationVerification = z.infer<typeof MerchantApplicationVerificationSchema>;
export type MerchantApplication = z.infer<typeof MerchantApplicationSchema>;
export type MerchantApplicationSubmit = z.infer<typeof MerchantApplicationSubmitSchema>;
export type PublisherApiDraft = z.infer<typeof PublisherApiDraftSchema>;
export type MerchantApplicationNextSteps = {
  status: MerchantApplication["status"];
  verificationRequired: boolean;
  readyForReview: boolean;
  phase: "submitted" | "verify_ownership" | "operator_review" | "published" | "rejected";
  selfServeActions: Array<{
    id: "publish_verification" | "run_verification" | "check_status" | "probe_readiness" | "inspect_marketplace" | "resubmit";
    label: string;
    description: string;
    command?: string;
  }>;
  operatorActions: Array<{
    id: "review_application" | "publish_listing" | "reject_application";
    label: string;
    description: string;
  }>;
  verificationDocument?: {
    sui402: "publisher-verification-v1";
    applicationId: string;
    merchantId: string;
    upstreamUrl: string;
    verificationToken: string;
  };
  verificationUrl?: string;
  dnsTxtName?: string;
  dnsTxtValue?: string;
  verifyCommand?: string;
  steps: string[];
};

export type PublisherApiDraftPreview = {
  merchantId: string;
  service: string;
  upstreamUrl: string;
  protectedResourcePath: string;
  verificationUrl: string;
  network: MerchantApplicationRequest["network"];
  coinType: string;
  price: string;
  resourceScope: string;
  transport: MerchantApplicationRequest["transport"];
  openApi?: PublisherOpenApiPreview;
  selectedOpenApiEndpoint?: PublisherOpenApiEndpoint;
  reviewDraft?: PublisherReviewConfigDraft;
};

export type PublisherReviewConfigDraft = {
  publishMode: "review_only";
  gatewayMerchant: Record<string, unknown>;
  registryListing: Record<string, unknown>;
  gates: Array<{
    id: "ownership_verification" | "payout_wallet_proof" | "operator_review" | "paid_test_evidence";
    passed: boolean;
    label: string;
    description: string;
  }>;
};

export const PublisherOpenApiEndpointSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    path: z.string().min(1),
    operationId: z.string().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    suggestedResourceScope: z.string().min(1)
  })
  .strict();

export const PublisherOpenApiPreviewSchema = z
  .object({
    sourceUrl: z.string().url().optional(),
    title: z.string().optional(),
    version: z.string().optional(),
    endpointCount: z.number().int().nonnegative(),
    suggestedEndpoints: z.array(PublisherOpenApiEndpointSchema),
    suggestedResourceScopes: z.array(z.string())
  })
  .strict();

export type PublisherOpenApiEndpoint = z.infer<typeof PublisherOpenApiEndpointSchema>;
export type PublisherOpenApiPreview = z.infer<typeof PublisherOpenApiPreviewSchema>;

export type MerchantApplicationQuery = {
  status?: MerchantApplication["status"];
  limit?: number;
};

export type MerchantApplicationStore = {
  submit(application: MerchantApplication): Promise<void> | void;
  update(application: MerchantApplication): Promise<void> | void;
  get(id: string): Promise<MerchantApplication | undefined> | MerchantApplication | undefined;
  list(query?: MerchantApplicationQuery): Promise<MerchantApplication[]> | MerchantApplication[];
};

export class MemoryMerchantApplicationStore implements MerchantApplicationStore {
  readonly #applications = new Map<string, MerchantApplication>();

  submit(application: MerchantApplication): void {
    this.#applications.set(application.id, application);
  }

  update(application: MerchantApplication): void {
    this.#applications.set(application.id, application);
  }

  get(id: string): MerchantApplication | undefined {
    return this.#applications.get(id);
  }

  list(query: MerchantApplicationQuery = {}): MerchantApplication[] {
    return [...this.#applications.values()]
      .filter((application) => !query.status || application.status === query.status)
      .sort(compareApplicationsDescending)
      .slice(0, query.limit ?? 100);
  }
}

export function createMerchantApplication(
  input: MerchantApplicationSubmit,
  options: { now?: Date; reviewSlaHours?: number } = {}
): MerchantApplication {
  const now = options.now ?? new Date();
  const reviewSlaHours = options.reviewSlaHours ?? 72;
  if (!Number.isFinite(reviewSlaHours) || reviewSlaHours <= 0) {
    throw new Error("Merchant application review SLA must be a positive number of hours");
  }

  const id = input.id ?? `mapp_${randomUUID()}`;
  return MerchantApplicationSchema.parse({
    id,
    status: "pending",
    request: input.request,
    verification: input.request.upstreamUrl
      ? createMerchantApplicationVerification(id, input.request.id, input.request.upstreamUrl)
      : undefined,
    applicant: input.applicant ?? {},
    submittedAt: now.toISOString(),
    reviewDueAt: new Date(now.getTime() + reviewSlaHours * 60 * 60 * 1000).toISOString(),
    metadata: input.metadata
  });
}

export function publisherApiDraftToMerchantApplicationSubmit(input: PublisherApiDraft): MerchantApplicationSubmit {
  const upstreamUrl = canonicalUrl(input.apiUrl);
  const id = input.id ?? merchantIdFromUrl(upstreamUrl);
  const service = input.service ?? serviceNameFromUrl(upstreamUrl);

  return {
    request: {
      id,
      service,
      merchant: input.merchant,
      network: input.network,
      coinType: input.coinType,
      price: input.price,
      resourceScope: input.resourceScope ?? `api:${id}`,
      upstreamUrl,
      upstreamTimeoutMs: input.upstreamTimeoutMs,
      sessionPackageId: input.sessionPackageId,
      transport: input.transport
    },
    applicant: {
      email: input.applicantEmail,
      organization: input.organization ?? service,
      notes: input.notes
    },
    metadata: {
      ...input.metadata,
      apiUrl: upstreamUrl,
      openApiUrl: input.openApiUrl,
      openApiOperationId: input.openApiOperationId,
      openApiMethod: input.openApiMethod,
      openApiPath: input.openApiPath,
      submittedFrom: "publisher-api-draft"
    }
  };
}

export function publisherApiDraftPreview(
  application: MerchantApplication,
  providerBaseUrl?: string,
  openApi?: PublisherOpenApiPreview,
  selectedOpenApiEndpoint?: PublisherOpenApiEndpoint,
  reviewDraft?: PublisherReviewConfigDraft
): PublisherApiDraftPreview {
  return {
    merchantId: application.request.id,
    service: application.request.service,
    upstreamUrl: application.request.upstreamUrl ? canonicalUrl(application.request.upstreamUrl) : "",
    protectedResourcePath: `/gateway/merchants/${application.request.id}/pay`,
    verificationUrl: application.verification?.verificationUrl ?? "",
    network: application.request.network,
    coinType: application.request.coinType,
    price: application.request.price,
    resourceScope: application.request.resourceScope,
    transport: application.request.transport,
    openApi,
    selectedOpenApiEndpoint,
    reviewDraft,
    ...(providerBaseUrl
      ? { protectedResourcePath: new URL(`/gateway/merchants/${application.request.id}/pay`, providerBaseUrl).toString() }
      : {})
  };
}

export function buildPublisherOpenApiPreview(
  document: unknown,
  input: { merchantId: string; sourceUrl?: string; maxEndpoints?: number }
): PublisherOpenApiPreview {
  const root = asRecord(document);
  if (!root) {
    throw new Error("OpenAPI document must be a JSON object");
  }
  const info = asRecord(root.info);
  const paths = asRecord(root.paths);
  if (!paths) {
    throw new Error("OpenAPI document must include a paths object");
  }

  const maxEndpoints = input.maxEndpoints ?? 10;
  const endpoints: PublisherOpenApiPreview["suggestedEndpoints"] = [];
  let endpointCount = 0;
  for (const [path, pathItem] of Object.entries(paths)) {
    const methods = asRecord(pathItem);
    if (!methods) {
      continue;
    }

    for (const method of OPENAPI_METHODS) {
      const operation = asRecord(methods[method]);
      if (!operation) {
        continue;
      }

      endpointCount += 1;
      if (endpoints.length >= maxEndpoints) {
        continue;
      }

      const methodLabel = method.toUpperCase() as Uppercase<typeof method>;
      endpoints.push({
        method: methodLabel,
        path,
        operationId: typeof operation.operationId === "string" ? operation.operationId : undefined,
        summary: typeof operation.summary === "string" ? operation.summary : undefined,
        tags: Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
        suggestedResourceScope: `api:${input.merchantId}:${method}:${scopeSlugFromPath(path)}`
      });
    }
  }

  return PublisherOpenApiPreviewSchema.parse({
    sourceUrl: input.sourceUrl,
    title: typeof info?.title === "string" ? info.title : undefined,
    version: typeof info?.version === "string" ? info.version : undefined,
    endpointCount,
    suggestedEndpoints: endpoints,
    suggestedResourceScopes: [...new Set(endpoints.map((endpoint) => endpoint.suggestedResourceScope))]
  });
}

export function hasPublisherOpenApiSelection(input: Pick<PublisherApiDraft, "openApiOperationId" | "openApiMethod" | "openApiPath">): boolean {
  return Boolean(input.openApiOperationId || input.openApiMethod || input.openApiPath);
}

export function selectPublisherOpenApiEndpoint(
  openApi: PublisherOpenApiPreview,
  input: Pick<PublisherApiDraft, "openApiOperationId" | "openApiMethod" | "openApiPath">
): PublisherOpenApiEndpoint | undefined {
  if (!hasPublisherOpenApiSelection(input)) {
    return undefined;
  }

  if (input.openApiOperationId) {
    return openApi.suggestedEndpoints.find((endpoint) => endpoint.operationId === input.openApiOperationId);
  }

  if (!input.openApiMethod || !input.openApiPath) {
    throw new Error("Select an OpenAPI operation with openApiOperationId or both openApiMethod and openApiPath");
  }

  return openApi.suggestedEndpoints.find((endpoint) => endpoint.method === input.openApiMethod && endpoint.path === input.openApiPath);
}

export function createMerchantApplicationVerification(
  applicationId: string,
  merchantId: string,
  upstreamUrl: string
): MerchantApplicationVerification {
  const token = `sui402v_${randomBytes(24).toString("base64url")}`;
  const accessToken = createPublisherAccessToken();
  const expectedUpstreamUrl = canonicalUrl(upstreamUrl);
  return MerchantApplicationVerificationSchema.parse({
    method: "well-known",
    status: "pending",
    token,
    accessToken,
    verificationUrl: publisherVerificationUrl(upstreamUrl),
    dnsTxtName: publisherVerificationDnsTxtName(upstreamUrl),
    dnsTxtValue: publisherVerificationDnsTxtValue({
      applicationId,
      merchantId,
      upstreamUrl: expectedUpstreamUrl,
      token
    }),
    expectedUpstreamUrl,
    error: `Publish ${publisherVerificationFilename(upstreamUrl)} with verification token ${token} for merchant ${merchantId} and application ${applicationId}`
  });
}

export function createPublisherAccessToken(): string {
  return `sui402p_${randomBytes(32).toString("base64url")}`;
}

export function rotateMerchantApplicationPublisherAccessToken(
  application: MerchantApplication,
  options: { now?: Date } = {}
): { application: MerchantApplication; accessToken: string; rotatedAt: string } {
  if (!application.verification) {
    throw new Error(`Merchant application ${application.id} does not require publisher access-token rotation`);
  }

  const accessToken = createPublisherAccessToken();
  const rotatedAt = (options.now ?? new Date()).toISOString();
  const metadata = asRecord(application.metadata) ?? {};

  return {
    accessToken,
    rotatedAt,
    application: MerchantApplicationSchema.parse({
      ...application,
      verification: {
        ...application.verification,
        accessToken
      },
      metadata: {
        ...metadata,
        publisherAccessTokenRotatedAt: rotatedAt
      }
    })
  };
}

export function publisherVerificationUrl(upstreamUrl: string): string {
  return new URL("/.well-known/sui402-publisher.json", upstreamUrl).toString();
}

export function publisherVerificationFilename(_upstreamUrl: string): string {
  return "/.well-known/sui402-publisher.json";
}

export function publisherVerificationDnsTxtName(upstreamUrl: string): string {
  const hostname = new URL(upstreamUrl).hostname;
  return `_sui402-publisher.${hostname}`;
}

export function publisherVerificationDnsTxtValue(input: {
  applicationId: string;
  merchantId: string;
  upstreamUrl: string;
  token: string;
}): string {
  return [
    "sui402=publisher-verification-v1",
    `applicationId=${input.applicationId}`,
    `merchantId=${input.merchantId}`,
    `upstreamUrl=${input.upstreamUrl}`,
    `token=${input.token}`
  ].join(";");
}

export function canonicalUrl(value: string): string {
  return new URL(value).toString();
}

export function merchantIdFromUrl(value: string): string {
  const url = new URL(value);
  const pathSegment = url.pathname
    .split("/")
    .filter(Boolean)
    .at(0);
  const raw = `${url.hostname.replace(/^www\./, "")}${pathSegment ? `-${pathSegment}` : ""}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug.length >= 3) {
    return slug;
  }

  return `api-${slug || "publisher"}`;
}

export function serviceNameFromUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^www\./, "");
  const [firstLabel] = hostname.split(".");
  const words = (firstLabel || hostname)
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return words.length > 0 ? `${words.join(" ")} API` : "Publisher API";
}

export function merchantApplicationNextSteps(
  application: MerchantApplication,
  options: { publicBaseUrl?: string } = {}
): MerchantApplicationNextSteps {
  const verification = application.verification;
  const steps: string[] = [];
  const verificationVerified = !verification || verification.status === "verified";
  const readyForReview = application.status === "pending" && verificationVerified;
  let phase: MerchantApplicationNextSteps["phase"] = "submitted";
  const selfServeActions: MerchantApplicationNextSteps["selfServeActions"] = [];
  const operatorActions: MerchantApplicationNextSteps["operatorActions"] = [];
  const publicBaseUrl = options.publicBaseUrl;
  const publisherStatusUrl = verification
    ? publisherRoute(publicBaseUrl, `/v1/publisher/apis/${application.id}/status`)
    : undefined;
  const publisherProbeUrl = verification
    ? publisherRoute(publicBaseUrl, `/v1/publisher/apis/${application.id}/probe`)
    : undefined;
  const publisherStatusCommand = verification
    ? `curl -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${publisherStatusUrl}"`
    : undefined;
  const publisherProbeCommand = verification
    ? `curl -X POST -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "${publisherProbeUrl}"`
    : undefined;

  if (application.status === "pending" && verification) {
    if (verification.status === "verified") {
      phase = "operator_review";
      steps.push("Ownership proof is verified. Wait for operator review.");
      selfServeActions.push({
        id: "check_status",
        label: "Check review status",
        description: "Poll the token-gated publisher status route for the latest review phase and preview.",
        command: publisherStatusCommand
      });
      selfServeActions.push({
        id: "probe_readiness",
        label: "Probe readiness",
        description: "Check whether the approved gateway/listing is live. This will pass only after operator approval.",
        command: publisherProbeCommand
      });
      operatorActions.push({
        id: "review_application",
        label: "Review application",
        description: "Operator checks ownership proof, unsafe target controls, pricing, wallet, and abuse risk."
      });
      operatorActions.push({
        id: "publish_listing",
        label: "Publish listing",
        description: "Approving creates the gateway merchant and marketplace listing."
      });
      operatorActions.push({
        id: "reject_application",
        label: "Reject application",
        description: "Rejecting leaves the live gateway and marketplace untouched."
      });
    } else {
      phase = "verify_ownership";
      steps.push(`Publish the verification JSON at ${verification.verificationUrl}.`);
      if (verification.dnsTxtName && verification.dnsTxtValue) {
        steps.push(`Or publish DNS TXT ${verification.dnsTxtName} with value ${verification.dnsTxtValue}.`);
      }
      steps.push(`Run the verification check for application ${application.id}.`);
      steps.push("Wait for operator review after the proof is verified.");
      selfServeActions.push({
        id: "publish_verification",
        label: "Publish verification JSON",
        description: verification.dnsTxtName
          ? `Host the exact JSON at ${verification.verificationUrl}, or publish the DNS TXT fallback at ${verification.dnsTxtName}.`
          : `Host the exact JSON at ${verification.verificationUrl}.`
      });
      selfServeActions.push({
        id: "run_verification",
        label: "Run verification check",
        description: "Ask the console to fetch the well-known proof from your API domain.",
        command: `curl -X POST "${publisherRoute(publicBaseUrl, `/v1/merchant-applications/${application.id}/verify`)}"`
      });
      selfServeActions.push({
        id: "check_status",
        label: "Check status",
        description: "Poll the token-gated publisher status route after hosting the proof or DNS TXT record.",
        command: publisherStatusCommand
      });
    }
  } else if (application.status === "pending") {
    phase = "operator_review";
    steps.push("Wait for operator review.");
    operatorActions.push({
      id: "review_application",
      label: "Review application",
      description: "Operator reviews the non-upstream-backed application before publishing."
    });
  } else if (application.status === "approved") {
    phase = "published";
    steps.push(`Use marketplace search or the gateway listing for merchant ${application.publishedMerchantId ?? application.request.id}.`);
    if (publisherProbeCommand) {
      selfServeActions.push({
        id: "probe_readiness",
        label: "Probe paid launch readiness",
        description: "Confirm the published gateway/listing has unpaid challenge behavior and paid-test evidence.",
        command: publisherProbeCommand
      });
    }
    selfServeActions.push({
      id: "inspect_marketplace",
      label: "Inspect marketplace listing",
      description: "Confirm agents can discover the API and copy a paid call command.",
      command: `sui402-pay marketplace detail ${application.publishedMerchantId ?? application.request.id}`
    });
  } else {
    phase = "rejected";
    steps.push("Review the rejection reason, update the application, and resubmit when ready.");
    selfServeActions.push({
      id: "resubmit",
      label: "Resubmit after changes",
      description: "Fix the rejection reason and submit a new application."
    });
  }

  return {
    status: application.status,
    verificationRequired: Boolean(verification),
    readyForReview,
    phase,
    selfServeActions,
    operatorActions,
    verificationDocument: verification
      ? {
          sui402: "publisher-verification-v1",
          applicationId: application.id,
          merchantId: application.request.id,
          upstreamUrl: verification.expectedUpstreamUrl,
          verificationToken: verification.token
        }
      : undefined,
    verificationUrl: verification?.verificationUrl,
    dnsTxtName: verification?.dnsTxtName,
    dnsTxtValue: verification?.dnsTxtValue,
    verifyCommand: verification ? `curl -X POST "${publisherRoute(publicBaseUrl, `/v1/merchant-applications/${application.id}/verify`)}"` : undefined,
    steps
  };
}

function publisherRoute(baseUrl: string | undefined, pathname: string, query: Record<string, string> = {}): string {
  const route = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const search = new URLSearchParams(query).toString();
  if (!baseUrl) {
    return `${route}${search ? `?${search}` : ""}`;
  }

  const url = new URL(route, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function reviewMerchantApplication(
  application: MerchantApplication,
  input: z.infer<typeof MerchantApplicationReviewSchema>,
  publishedMerchantId?: string
): MerchantApplication {
  if (application.status !== "pending") {
    throw new Error(`Merchant application ${application.id} has already been ${application.status}`);
  }

  return MerchantApplicationSchema.parse({
    ...application,
    status: input.action === "approve" ? "approved" : "rejected",
    reviewedAt: new Date().toISOString(),
    reviewer: input.reviewer,
    reviewReason: input.reason,
    publishedMerchantId
  });
}

function compareApplicationsDescending(left: MerchantApplication, right: MerchantApplication): number {
  return Date.parse(right.submittedAt) - Date.parse(left.submittedAt) || right.id.localeCompare(left.id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function scopeSlugFromPath(path: string): string {
  const slug = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
  return (slug || "root").toLowerCase().slice(0, 80);
}
