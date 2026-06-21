import type { ExportRow, PaymentRow, ReadinessItem } from "./data.js";

export type GatewayMerchant = {
  id: string;
  service: string;
  network: "sui:testnet" | "sui:mainnet" | "sui:devnet" | "sui:localnet";
  merchant: string;
  coinType: string;
  price: string;
  resourceScope: string;
  upstreamUrl?: string;
  upstreamTimeoutMs?: number;
  sessionPackageId?: string;
  status: "active" | "paused";
  metadata?: Record<string, unknown>;
};

export type ServiceListing = {
  id: string;
  name: string;
  description?: string;
  providerBaseUrl: string;
  transport: "http" | "mcp";
  network: GatewayMerchant["network"];
  merchant: string;
  coinType: string;
  price: string;
  resourceScope: string;
  resourceScopeHash: string;
  sessionSupported: boolean;
  sessionManagerUrl?: string;
  mcpServerUrl?: string;
  protectedResourceUrl?: string;
  tags: string[];
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ConsoleOverviewResponse = {
  mode: "seeded" | "live";
  kpis: {
    verifiedPayments: number;
    activeMerchants: number;
    sessionVolume: number;
    indexedSessionSpends: number;
    indexedSessions: number;
    indexedSettlementEvents?: number;
  };
  payments: PaymentRow[];
  readiness: Array<{
    label: string;
    value: string;
    status: ReadinessItem["status"];
  }>;
  merchants: GatewayMerchant[];
  listings: ServiceListing[];
  exports: ExportRow[];
  merchantApplications: MerchantApplication[];
  merchantChangeRequests: MerchantChangeRequest[];
  settlements: SettlementSummary[];
  settlementCaveats?: string[];
  settlementReconciliation?: SettlementReconciliationSummary;
  auditEvents: AuditEvent[];
};

export type MerchantCreateInput = {
  id: string;
  service: string;
  merchant: string;
  network: "sui:testnet" | "sui:mainnet" | "sui:devnet" | "sui:localnet";
  coinType: string;
  price: string;
  resourceScope: string;
  upstreamUrl?: string;
  upstreamTimeoutMs?: number;
  sessionPackageId?: string;
  transport: "http" | "mcp";
};

export type MerchantApplicationSubmitInput = {
  id?: string;
  request: MerchantCreateInput;
  applicant?: {
    email?: string;
    organization?: string;
    notes?: string;
  };
  metadata?: Record<string, unknown>;
};

export type PublisherApiDraftInput = {
  apiUrl: string;
  openApiUrl?: string;
  openApiOperationId?: string;
  openApiMethod?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  openApiPath?: string;
  id?: string;
  service?: string;
  merchant: string;
  network: "sui:testnet" | "sui:mainnet" | "sui:devnet" | "sui:localnet";
  coinType?: string;
  price?: string;
  resourceScope?: string;
  upstreamTimeoutMs?: number;
  sessionPackageId?: string;
  transport?: "http" | "mcp";
  applicantEmail?: string;
  organization?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type MarketplaceApi = {
  id: string;
  name: string;
  description?: string;
  transport: "http" | "mcp";
  network: GatewayMerchant["network"];
  merchant: string;
  coinType: string;
  price: string;
  resourceScope: string;
  sessionSupported: boolean;
  protectedResourceUrl?: string;
  sessionManagerUrl?: string;
  tags: string[];
  status: "active" | "paused";
  updatedAt?: string;
  readiness?: MarketplaceReadiness;
  links?: MarketplaceApiLinks;
  commands?: MarketplaceCommands;
  paymentPlan?: MarketplacePaymentPlan;
  stats?: {
    verifiedPayments: number;
    sessionPayments: number;
    volume: string;
  };
  reliability?: MarketplaceReliability;
};

export type MarketplaceCommands = {
  curl: string;
  search: string;
  scan: string;
  sessionOnly?: string;
  sessionInspect?: string;
};

export type MarketplacePaymentPlan = {
  custody: "user_owned";
  authorizationMode: "live_402_challenge_plus_local_policy";
  network: GatewayMerchant["network"];
  merchant: string;
  coinType: string;
  amountAtomic: string;
  maxOneShotAmount: string;
  resourceScope: string;
  resourceScopeHash: string;
  protectedResourceUrl?: string;
  sessionSupported: boolean;
  sessionBehavior: "session_first_with_capped_one_shot_fallback" | "capped_one_shot";
  sessionManagerUrl?: string;
  notes: string[];
};

export type MarketplaceApiLinks = {
  apiPath?: string;
  apiUrl?: string;
  publicPagePath?: string;
  publicPageUrl?: string;
  scanMerchantPath?: string;
  scanMerchantUrl?: string;
  scanPagePath?: string;
  scanPageUrl?: string;
};

export type MarketplaceReadiness = {
  ready: boolean;
  level: "ready" | "needs_review" | "paused";
  reasons: string[];
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
};

export type MarketplaceReliability = {
  paidTestObserved: boolean;
  verifiedPayments: number;
  sessionPayments: number;
  oneShotPayments: number;
  recentIndexedPayments: number;
  firstVerifiedPaymentAt?: string;
  lastVerifiedPaymentAt?: string;
  evidenceWindow?: {
    from: string;
    to: string;
    payments: number;
  };
  notes: string[];
};

export type MarketplaceApisResponse = {
  schemaVersion?: string;
  generatedAt?: string;
  dataSource?: string;
  count: number;
  limit?: number;
  hasMore?: boolean;
  apis: MarketplaceApi[];
};

export type MarketplaceApiDetailResponse = {
  schemaVersion?: string;
  generatedAt?: string;
  dataSource?: string;
  api: MarketplaceApi;
  merchant?: {
    id: string;
    service: string;
    network: GatewayMerchant["network"];
    merchant: string;
    coinType: string;
    price: string;
    resourceScope: string;
    status: "active" | "paused";
    sessionsEnabled: boolean;
  };
  trust: {
    listingPublished: boolean;
    merchantPublished: boolean;
    upstreamConfigured: boolean;
    sessionsEnabled: boolean;
  };
  readiness?: MarketplaceReadiness;
  commands: MarketplaceCommands;
  paymentPlan?: MarketplacePaymentPlan;
  stats: {
    verifiedPayments: number;
    sessionPayments: number;
    volume: string;
  };
  reliability?: MarketplaceReliability;
  recentPayments: ScanPaymentRecord[];
  links: {
    protectedResourceUrl?: string;
    sessionManagerUrl?: string;
    scanMerchantPath: string;
  } & MarketplaceApiLinks;
};

export type MerchantApplicationNextSteps = {
  status: "pending" | "approved" | "rejected";
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
  network: GatewayMerchant["network"];
  coinType: string;
  price: string;
  resourceScope: string;
  transport: "http" | "mcp";
  selectedOpenApiEndpoint?: PublisherOpenApiEndpointPreview;
  reviewDraft?: PublisherReviewConfigDraftPreview;
  openApi?: {
    sourceUrl?: string;
    title?: string;
    version?: string;
    endpointCount: number;
    suggestedEndpoints: PublisherOpenApiEndpointPreview[];
    suggestedResourceScopes: string[];
  };
};

export type PublisherOpenApiEndpointPreview = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  suggestedResourceScope: string;
};

export type PublisherReviewConfigDraftPreview = {
  publishMode: "review_only";
  gatewayMerchant: {
    id?: string;
    service?: string;
    network?: string;
    merchant?: string;
    coinType?: string;
    price?: string;
    resourceScope?: string;
    upstreamUrl?: string;
    status?: string;
  };
  registryListing: {
    id?: string;
    name?: string;
    providerBaseUrl?: string;
    protectedResourceUrl?: string;
    sessionManagerUrl?: string;
    transport?: string;
    network?: string;
    merchant?: string;
    coinType?: string;
    price?: string;
    resourceScope?: string;
    status?: string;
  };
  gates: Array<{
    id: "ownership_verification" | "payout_wallet_proof" | "operator_review" | "paid_test_evidence";
    passed: boolean;
    label: string;
    description: string;
  }>;
};

export type PublisherApiDraftResponse = {
  application: MerchantApplication;
  abuseControls: MerchantApplicationAbuseControls;
  preview: PublisherApiDraftPreview;
  nextSteps: MerchantApplicationNextSteps;
};

export type PublisherApiPreviewResponse = {
  schemaVersion: "sui402.publisher-api-preview.v1";
  preview: PublisherApiDraftPreview;
  conflicts: {
    merchantApplicationExists: boolean;
    merchantOrListingExists: boolean;
  };
  note: string;
};

export type PublisherAuthContext =
  | {
      kind: "publisher_access_token";
      recommendation?: string;
    }
  | {
      kind: "publisher_session";
      sessionId: string;
      expiresAt: string;
    };

export type PublisherSessionResponse = {
  schemaVersion: "sui402.publisher-session.v1";
  applicationId: string;
  merchantId: string;
  tokenType: "Bearer";
  publisherSessionToken: string;
  expiresAt: string;
  ttlSeconds: number;
  commands: {
    status: string;
    probe: string;
  };
  note: string;
};

export type PublisherApiStatusResponse = {
  application: MerchantApplication;
  preview: PublisherApiDraftPreview;
  nextSteps: MerchantApplicationNextSteps;
  publisherAuth?: PublisherAuthContext;
};

export type PublisherWalletProofResponse = {
  application: MerchantApplication;
  walletProof: NonNullable<MerchantApplication["walletProof"]>;
  nextSteps: MerchantApplicationNextSteps;
  note: string;
};

export type PublisherApiProbeResponse = {
  ready: boolean;
  applicationId: string;
  merchantId: string;
  status: MerchantApplication["status"];
  publisherAuth?: PublisherAuthContext;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
  unpaidProbe?: {
    expectedStatus: 402;
    protectedResourceUrl: string;
    challengeIssued: boolean;
    note: string;
    challenge?: {
      id: string;
      network: string;
      recipient: string;
      coinType: string;
      amount: string;
      resource: string;
      expiresAt: string;
    };
  };
  paidProbe?: {
    supported: boolean;
    reason: string;
    nextAction?: {
      label: string;
      command: string;
      note?: string;
    };
    evidence?: {
      requiredForPublicLaunch: boolean;
      observed: boolean;
      status: "observed" | "missing" | "not_published";
      verifiedPayments: number;
      sessionPayments: number;
      volume: string;
      recentPayments: Array<{
        digest?: string;
        displayDigest?: string;
        kind?: string;
        amount?: string;
        coinType?: string;
        resource?: string;
        createdAt?: string;
      }>;
    };
  };
  paidTestWizard?: {
    schemaVersion: "sui402.publisher-paid-test-wizard.v1";
    title: string;
    readyForPublicLaunch: boolean;
    currentGate: "publish_gateway_listing" | "run_paid_test" | "complete";
    summary: string;
    commands: {
      checkStatus: string;
      rerunProbe: string;
      unpaidChallenge?: string;
      paidCall?: string;
      inspectMarketplace?: string;
      scanMerchant?: string;
    };
    steps: Array<{
      id: "publish_or_verify" | "confirm_unpaid_402" | "run_paid_call" | "rerun_probe";
      label: string;
      status: "done" | "current" | "blocked";
      description: string;
      command?: string;
    }>;
    safety: string[];
  };
};

export type ScanLookupKind = "payment" | "merchant" | "session" | "settlement";

export type ScanPaymentRecord = {
  id: string;
  digest: string;
  network: string;
  kind: "one-shot" | "session";
  challengeId: string;
  merchantId?: string;
  recipient: string;
  coinType: string;
  amount: string;
  resource: string;
  createdAt?: string;
  sessionId?: string;
  links?: ScanRecordLinks & {
    merchantApiPath?: string;
    merchantApiUrl?: string;
    merchantPublicPagePath?: string;
    merchantPublicPageUrl?: string;
    merchantMarketplacePath?: string;
    merchantMarketplaceUrl?: string;
  };
  receipt?: {
    id: string;
    signer: string;
    sequence: string;
    expiresAt: string;
  };
};

export type ScanMerchantRecord = {
  merchant?: {
    id: string;
    service: string;
    network: string;
    merchant: string;
    coinType: string;
    price: string;
    resourceScope: string;
    status: "active" | "paused";
    sessionsEnabled: boolean;
  };
  listing?: MarketplaceApi;
  stats: {
    verifiedPayments: number;
    sessionPayments: number;
    volume: string;
  };
  links?: ScanRecordLinks & {
    marketplacePath?: string;
    marketplaceUrl?: string;
  };
  recentPayments: ScanPaymentRecord[];
};

export type ScanSessionRecord = {
  sessionId: string;
  network?: string;
  packageId?: string;
  coinType?: string;
  payer?: string;
  payerHash?: string;
  identityRedaction?: {
    payer?: string;
  };
  merchant?: string;
  spendCount: number;
  spentAmount: string;
  spentTotal?: string;
  resourceScopeHashes: string[];
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastTxDigest?: string;
  links?: ScanRecordLinks;
  spends: Array<{
    id: string;
    txDigest: string;
    amount: string;
    challengeId: string;
    resourceScopeHash: string;
    payerHash?: string;
    senderHash?: string;
    identityRedaction?: {
      payer?: string;
      sender?: string;
    };
    indexedAt: string;
  }>;
};

export type ScanSettlementRecord = {
  id: string;
  network: string;
  packageId: string;
  coinType: string;
  txDigest: string;
  eventSeq?: string;
  kind: "receipt" | "batch";
  ledgerId?: string;
  receiptId?: string;
  payer?: string;
  merchant?: string;
  signer?: string;
  amount: string;
  sequence?: string;
  resourceScopeHash?: string;
  submitter?: string;
  sender?: string;
  timestampMs?: string;
  indexedAt: string;
  links?: ScanRecordLinks;
};

export type ScanRecordLinks = {
  apiPath?: string;
  apiUrl?: string;
  publicPagePath?: string;
  publicPageUrl?: string;
};

export type ScanLookupRecord = ScanPaymentRecord | ScanMerchantRecord | ScanSessionRecord | ScanSettlementRecord;

export type ScanLookupResult = {
  kind: ScanLookupKind;
  id: string;
  record: ScanLookupRecord;
};

export type MerchantApplication = {
  id: string;
  status: "pending" | "approved" | "rejected";
  request: {
    id: string;
    service: string;
    merchant: string;
    network?: string;
    coinType: string;
    price: string;
    resourceScope: string;
    upstreamUrl?: string;
    upstreamTimeoutMs?: number;
    transport?: "http" | "mcp";
  };
  verification?: {
    method: "well-known" | "dns-txt";
    status: "pending" | "verified" | "failed";
    token?: string;
    accessToken?: string;
    accessTokenPresent?: boolean;
    accessTokenHash?: string;
    verificationUrl: string;
    dnsTxtName?: string;
    dnsTxtValue?: string;
    expectedUpstreamUrl: string;
    checkedAt?: string;
    verifiedAt?: string;
    error?: string;
  };
  walletProof?: {
    schemaVersion: "sui402.publisher-wallet-proof.v1";
    status: "verified";
    method: "sui-personal-message";
    address: string;
    messageHash: string;
    signatureHash: string;
    applicationId: string;
    merchantId: string;
    network: string;
    coinType: string;
    price: string;
    resourceScope: string;
    upstreamUrl?: string;
    verifiedAt: string;
  };
  applicant?: {
    email?: string;
    organization?: string;
  };
  reviewer?: string;
  reviewReason?: string;
  publishedMerchantId?: string;
  reviewDraft?: PublisherReviewConfigDraftPreview;
  abuseControls?: MerchantApplicationAbuseControls;
  submittedAt: string;
  reviewDueAt?: string;
  reviewedAt?: string;
};

export type MerchantApplicationAbuseControls = {
  schemaVersion: "sui402.publisher-intake-abuse-controls.v1";
  reviewSlaHours: number;
  reviewDueAt?: string;
  status: MerchantApplication["status"];
  intakeRateLimit: {
    max: number;
    windowMs: number;
  };
  hostPolicy: {
    allowlistConfigured: boolean;
    blocklistConfigured: boolean;
  };
  requiredReviewChecks: string[];
  takedown: {
    pendingApplication: {
      method: "POST";
      path: string;
      body: {
        action: "reject";
        reason: string;
      };
    };
    publishedMerchant: {
      method: "PATCH";
      path: string;
      body: {
        status: "paused";
      };
      note: string;
    };
  };
  escalation: {
    operatorQueuePath: string;
    auditTrailPath: string;
    applicantContact: string;
    note: string;
  };
};

export type MerchantChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  merchantId: string;
  changes: {
    merchant?: string;
    network?: GatewayMerchant["network"];
    coinType?: string;
  };
  requestedBy?: string;
  requestedByRoles?: Array<"seller_viewer" | "seller_admin">;
  reason?: string;
  submittedAt: string;
  reviewDueAt?: string;
  reviewedAt?: string;
  reviewer?: string;
  reviewReason?: string;
  appliedMerchantId?: string;
  metadata?: Record<string, unknown>;
};

export type SettlementSummary = {
  merchantId: string;
  recipient: string;
  network: string;
  coinType: string;
  paymentCount: number;
  sessionPaymentCount: number;
  oneShotPaymentCount: number;
  receiptCount: number;
  totalAmount: string;
  firstPaymentAt?: string;
  lastPaymentAt?: string;
  latestExportBlobId?: string;
  exportedPaymentCount?: number;
};

export type SettlementReconciliationSummary = {
  receiptPaymentCount: number;
  indexedReceiptEventCount: number;
  settledCount: number;
  unsettledCount: number;
  mismatchedCount: number;
  duplicateCount: number;
  orphanedEventCount: number;
  settledAmount: string;
  unsettledAmount: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

const apiBaseUrl = import.meta.env.VITE_SUI402_CONSOLE_API_URL as string | undefined;
const adminKey = import.meta.env.VITE_SUI402_CONSOLE_ADMIN_API_KEY as string | undefined;

export function hasConsoleApi(): boolean {
  return Boolean(apiBaseUrl);
}

export async function fetchConsoleOverview(): Promise<ConsoleOverviewResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL("/v1/overview", apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Console overview request failed: ${response.status}`);
  }

  return response.json() as Promise<ConsoleOverviewResponse>;
}

export async function fetchMarketplaceApis(input: {
  query?: string;
  network?: GatewayMerchant["network"] | "";
  transport?: "http" | "mcp" | "";
  tag?: string;
  limit?: number;
} = {}): Promise<MarketplaceApisResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const url = new URL("/v1/marketplace/apis", apiBaseUrl);
  if (input.query) {
    url.searchParams.set("q", input.query);
  }
  if (input.network) {
    url.searchParams.set("network", input.network);
  }
  if (input.transport) {
    url.searchParams.set("transport", input.transport);
  }
  if (input.tag) {
    url.searchParams.set("tag", input.tag);
  }
  if (input.limit) {
    url.searchParams.set("limit", String(input.limit));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Marketplace API request failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<MarketplaceApisResponse>;
}

export async function fetchMarketplaceApiDetail(apiId: string): Promise<MarketplaceApiDetailResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL(`/v1/marketplace/apis/${encodeURIComponent(apiId)}`, apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Marketplace API detail request failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<MarketplaceApiDetailResponse>;
}

export async function fetchScanLookup(kind: ScanLookupKind, id: string): Promise<ScanLookupResult | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const encoded = encodeURIComponent(id);
  const path =
    kind === "payment"
      ? `/v1/scan/payments/${encoded}`
      : kind === "merchant"
        ? `/v1/scan/merchants/${encoded}`
        : kind === "session"
          ? `/v1/scan/sessions/${encoded}`
          : `/v1/scan/settlements/${encoded}`;

  const response = await fetch(new URL(path, apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Scan ${kind} lookup failed: ${response.status} ${await response.text()}`);
  }

  return { kind, id, record: (await response.json()) as ScanLookupRecord };
}

export async function createConsoleMerchant(input: MerchantCreateInput): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (adminKey) {
    headers.set("authorization", `Bearer ${adminKey}`);
  }

  const response = await fetch(new URL("/v1/merchants", apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Merchant creation failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function submitMerchantApplication(input: MerchantApplicationSubmitInput): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL("/v1/merchant-applications", apiBaseUrl), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Merchant application failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function submitPublisherApiDraft(input: PublisherApiDraftInput): Promise<PublisherApiDraftResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL("/v1/publisher/apis/draft", apiBaseUrl), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Publisher API draft failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<PublisherApiDraftResponse>;
}

export async function previewPublisherApiDraft(input: PublisherApiDraftInput): Promise<PublisherApiPreviewResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL("/v1/publisher/apis/preview", apiBaseUrl), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Publisher API preview failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<PublisherApiPreviewResponse>;
}

export async function fetchPublisherApiStatus(
  applicationId: string,
  credential: { publisherSessionToken?: string; publisherAccessToken?: string }
): Promise<PublisherApiStatusResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers();
  if (credential.publisherSessionToken) {
    headers.set("authorization", `Bearer ${credential.publisherSessionToken}`);
  } else if (credential.publisherAccessToken) {
    headers.set("x-sui402-publisher-token", credential.publisherAccessToken);
  }

  const response = await fetch(new URL(`/v1/publisher/apis/${applicationId}/status`, apiBaseUrl), { headers });
  if (!response.ok) {
    throw new Error(`Publisher API status failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<PublisherApiStatusResponse>;
}

export async function submitPublisherWalletProof(
  applicationId: string,
  input: { message: string; signature: string }
): Promise<PublisherWalletProofResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL(`/v1/merchant-applications/${applicationId}/wallet-proof`, apiBaseUrl), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Publisher wallet proof failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<PublisherWalletProofResponse>;
}

export async function createPublisherSession(
  applicationId: string,
  publisherAccessToken: string,
  input: { ttlSeconds?: number } = {}
): Promise<PublisherSessionResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL(`/v1/publisher/apis/${applicationId}/session`, apiBaseUrl), {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "x-sui402-publisher-token": publisherAccessToken
    }),
    body: JSON.stringify({ ttlSeconds: input.ttlSeconds ?? 900 })
  });
  if (!response.ok) {
    throw new Error(`Publisher session exchange failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<PublisherSessionResponse>;
}

export async function probePublisherApi(
  applicationId: string,
  credential: { publisherSessionToken?: string; publisherAccessToken?: string }
): Promise<PublisherApiProbeResponse | undefined> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers();
  if (credential.publisherSessionToken) {
    headers.set("authorization", `Bearer ${credential.publisherSessionToken}`);
  } else if (credential.publisherAccessToken) {
    headers.set("x-sui402-publisher-token", credential.publisherAccessToken);
  }

  const response = await fetch(new URL(`/v1/publisher/apis/${applicationId}/probe`, apiBaseUrl), {
    method: "POST",
    headers
  });
  const body = (await response.json()) as PublisherApiProbeResponse | { error?: string; message?: string };
  if (!response.ok && !("ready" in body)) {
    throw new Error(`Publisher API probe failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body as PublisherApiProbeResponse;
}

export async function verifyMerchantApplication(applicationId: string): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const response = await fetch(new URL(`/v1/merchant-applications/${applicationId}/verify`, apiBaseUrl), {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Merchant verification failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function publishConsoleExport(kind: "payment-ledger" | "receipts" | "audit-head"): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (adminKey) {
    headers.set("authorization", `Bearer ${adminKey}`);
  }

  const path =
    kind === "payment-ledger"
      ? "/v1/exports/payment-ledger/walrus"
      : kind === "receipts"
        ? "/v1/exports/receipts/walrus"
        : "/v1/exports/audit-head/walrus";
  const response = await fetch(new URL(path, apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`Walrus export failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function reviewMerchantApplication(
  applicationId: string,
  input: { action: "approve" | "reject"; reason: string; reviewer: string }
): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (adminKey) {
    headers.set("authorization", `Bearer ${adminKey}`);
  }

  const response = await fetch(new URL(`/v1/merchant-applications/${applicationId}/review`, apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Application review failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function reviewMerchantChangeRequest(
  requestId: string,
  input: { action: "approve" | "reject"; reason: string; reviewer?: string }
): Promise<unknown> {
  if (!apiBaseUrl) {
    return undefined;
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (adminKey) {
    headers.set("authorization", `Bearer ${adminKey}`);
  }

  const response = await fetch(new URL(`/v1/merchant-change-requests/${requestId}/review`, apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Merchant change review failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
