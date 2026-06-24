import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  ExternalLink,
  Filter,
  Globe2,
  KeyRound,
  Network,
  PackageCheck,
  Plus,
  Radar,
  Route,
  Search,
  Server,
  ShieldCheck,
  Zap
} from "lucide-react";
import {
  createConsoleMerchant,
  createPublisherSession,
  fetchConsoleOverview,
  fetchMarketplaceApiDetail,
  fetchMarketplaceApis,
  fetchPublisherApiStatus,
  fetchScanLookup,
  hasConsoleApi,
  probePublisherApi,
  previewPublisherApiDraft,
  publishConsoleExport,
  reviewMerchantChangeRequest,
  reviewMerchantApplication,
  submitPublisherWalletProof,
  submitPublisherApiDraft,
  verifyMerchantApplication,
  type AuditEvent,
  type GatewayMerchant,
  type MarketplaceApi,
  type MarketplaceApiDetailResponse,
  type MarketplaceReadiness,
  type MerchantApplicationNextSteps,
  type MerchantApplication,
  type MerchantChangeRequest,
  type PublisherApiDraftPreview,
  type PublisherApiPreviewResponse,
  type PublisherApiProbeResponse,
  type PublisherSessionResponse,
  type ScanLookupKind,
  type ScanLookupResult,
  type ScanMerchantRecord,
  type ScanPaymentRecord,
  type ScanSessionRecord,
  type ScanSettlementRecord,
  type SettlementReconciliationSummary,
  type SettlementSummary,
  type ServiceListing
} from "./api.js";
import {
  kpis as seedKpis,
  exportRows as seedExportRows,
  kpisFromOverview,
  navItems,
  paymentRows as seedPaymentRows,
  readinessFromOverview,
  readinessItems as seedReadinessItems,
  type KpiItem,
  type ExportRow,
  type PaymentRow,
  type ReadinessItem
} from "./data.js";
import "./styles.css";

type MerchantDraft = {
  apiUrl: string;
  openApiUrl: string;
  openApiOperationId: string;
  openApiMethod: "" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  openApiPath: string;
  id: string;
  service: string;
  address: string;
  price: string;
  coinType: string;
  resourceScope: string;
  sessionPackageId: string;
  applicantEmail: string;
};

export type MarketplaceRow = {
  id: string;
  name: string;
  description: string;
  network: string;
  transport: "http" | "mcp";
  price: string;
  coinType: string;
  resourceScope: string;
  status: "active" | "paused" | "observed";
  merchantAddress: string;
  endpoint?: string;
  tags: string[];
  sessionSupported: boolean;
  paymentCount: number;
  updatedAt?: string;
  readiness?: MarketplaceReadiness;
};

type MarketplaceFilters = {
  query: string;
  network: "" | GatewayMerchant["network"];
  transport: "" | "http" | "mcp";
};

type DashboardDeepLink = {
  marketplaceApiId?: string;
  scanKind?: ScanLookupKind;
  scanId?: string;
};

type DashboardPageId = "overview" | "marketplace" | "mcp" | "publisher" | "scan" | "operator";

const dashboardPageHeaders: Record<DashboardPageId, { eyebrow: string; title: string; description: string; action?: string; actionPage?: DashboardPageId }> = {
  overview: {
    eyebrow: "Sui-native agent payments",
    title: "What is Sui402?",
    description: "A demo map for the full payment loop: publishers list APIs, agents pay with a Sui wallet, and anyone can inspect payment evidence.",
    action: "Add your API",
    actionPage: "publisher"
  },
  marketplace: {
    eyebrow: "Marketplace",
    title: "Find APIs agents can pay for",
    description: "Search the registry, copy a bounded agent command, and open provider details without touching operator workflows.",
    action: "Add your API",
    actionPage: "publisher"
  },
  mcp: {
    eyebrow: "Sui402 MCP server",
    title: "Our MCP server for paid agent tools",
    description: "Use @sui402/mcp to expose paid MCP tools, generate client config, issue Sui402 challenges, and verify payment proofs.",
    action: "Configure MCP",
    actionPage: "publisher"
  },
  publisher: {
    eyebrow: "Publisher portal",
    title: "List an API for paid access",
    description: "Submit an endpoint, price, scope, and payout wallet proof so agents can discover and pay for your API.",
    action: "Browse marketplace",
    actionPage: "marketplace"
  },
  scan: {
    eyebrow: "Sui402 scan",
    title: "Inspect payments and proofs",
    description: "Look up payment digests, merchants, sessions, and settlement records from one read-only evidence page."
  },
  operator: {
    eyebrow: "Operator console",
    title: "Review, reconcile, and export",
    description: "Approve publisher requests, review risky changes, inspect readiness, export ledgers, and audit sensitive actions."
  }
};

const initialDraft: MerchantDraft = {
  apiUrl: "",
  openApiUrl: "",
  openApiOperationId: "",
  openApiMethod: "",
  openApiPath: "",
  id: "",
  service: "",
  address: "",
  price: "1000000",
  coinType: "0x2::sui::SUI",
  resourceScope: "api:*",
  sessionPackageId: "0x35265692bed3c723ca401ddb7a533ea8b35238645bdc25ecc51dea31d9062b3b",
  applicantEmail: ""
};

/* Corner mark decorative component (DeepSurge inspired) */
function CornerMarks() {
  return (
    <>
      <div className="corner-mark tl" />
      <div className="corner-mark tr" />
      <div className="corner-mark bl" />
      <div className="corner-mark br" />
    </>
  );
}

function App() {
  const handledHashRef = useRef<string | undefined>(undefined);
  const [environment, setEnvironment] = useState("Testnet");
  const [filter, setFilter] = useState<PaymentRow["status"] | "all">("all");
  const [activePage, setActivePage] = useState<DashboardPageId>(() => initialDashboardPage());
  const [draft, setDraft] = useState(initialDraft);
  const [publisherDetailsOpen, setPublisherDetailsOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [submittedApplication, setSubmittedApplication] = useState<MerchantApplication | undefined>();
  const [submittedNextSteps, setSubmittedNextSteps] = useState<MerchantApplicationNextSteps | undefined>();
  const [submittedPreview, setSubmittedPreview] = useState<PublisherApiDraftPreview | undefined>();
  const [publisherPreview, setPublisherPreview] = useState<PublisherApiPreviewResponse | undefined>();
  const [publisherPreviewLoading, setPublisherPreviewLoading] = useState(false);
  const [publisherResume, setPublisherResume] = useState({ applicationId: "", publisherAccessToken: "" });
  const [publisherResumeLoading, setPublisherResumeLoading] = useState(false);
  const [publisherAccessToken, setPublisherAccessToken] = useState<string | undefined>();
  const [publisherWalletSignature, setPublisherWalletSignature] = useState("");
  const [publisherWalletProofLoading, setPublisherWalletProofLoading] = useState(false);
  const [publisherSession, setPublisherSession] = useState<PublisherSessionResponse | undefined>();
  const [publisherSessionLoading, setPublisherSessionLoading] = useState(false);
  const [publisherProbe, setPublisherProbe] = useState<PublisherApiProbeResponse | undefined>();
  const [publisherProbeLoading, setPublisherProbeLoading] = useState(false);
  const [marketplaceFilters, setMarketplaceFilters] = useState<MarketplaceFilters>({
    query: "",
    network: "",
    transport: ""
  });
  const [marketplaceApis, setMarketplaceApis] = useState<MarketplaceApi[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | undefined>();
  const [selectedMarketplaceApi, setSelectedMarketplaceApi] = useState<MarketplaceRow | undefined>();
  const [marketplaceDetail, setMarketplaceDetail] = useState<MarketplaceApiDetailResponse | undefined>();
  const [marketplaceDetailLoading, setMarketplaceDetailLoading] = useState(false);
  const [marketplaceDetailError, setMarketplaceDetailError] = useState<string | undefined>();
  const [scanQuery, setScanQuery] = useState("");
  const [scanKind, setScanKind] = useState<ScanLookupKind | "auto">("auto");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  const [scanResult, setScanResult] = useState<ScanLookupResult | undefined>();
  const [exporting, setExporting] = useState<"payment-ledger" | "receipts" | "audit-head" | undefined>();
  const [apiState, setApiState] = useState<{
    mode: "seeded" | "live" | "local";
    kpis: KpiItem[];
    payments: PaymentRow[];
    readiness: ReadinessItem[];
    exports: ExportRow[];
    merchants: GatewayMerchant[];
    listings: ServiceListing[];
    merchantApplications: MerchantApplication[];
    merchantChangeRequests: MerchantChangeRequest[];
    settlements: SettlementSummary[];
    settlementCaveats?: string[];
    settlementReconciliation?: SettlementReconciliationSummary;
    auditEvents: AuditEvent[];
    error?: string;
  }>({
    mode: hasConsoleApi() ? "seeded" : "local",
    kpis: seedKpis,
    payments: seedPaymentRows,
    readiness: seedReadinessItems,
    exports: seedExportRows,
    merchants: [],
    listings: [],
    merchantApplications: [],
    merchantChangeRequests: [],
    settlements: [],
    auditEvents: []
  });

  async function refreshOverview() {
    try {
      const overview = await fetchConsoleOverview();
      if (!overview) {
        return;
      }

      setApiState({
        mode: overview.mode,
        kpis: kpisFromOverview(overview.kpis),
        payments: overview.payments,
        readiness: readinessFromOverview(overview.readiness),
        exports: overview.exports,
        merchants: overview.merchants,
        listings: overview.listings,
        merchantApplications: overview.merchantApplications,
        merchantChangeRequests: overview.merchantChangeRequests ?? [],
        settlements: overview.settlements,
        settlementCaveats: overview.settlementCaveats,
        settlementReconciliation: overview.settlementReconciliation,
        auditEvents: overview.auditEvents
      });
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Console API request failed"
      }));
    }
  }

  async function refreshMarketplace(filters: MarketplaceFilters = marketplaceFilters) {
    if (!hasConsoleApi()) {
      return;
    }

    setMarketplaceLoading(true);
    setMarketplaceError(undefined);
    try {
      const result = await fetchMarketplaceApis({
        query: filters.query || undefined,
        network: filters.network,
        transport: filters.transport,
        limit: 12
      });
      if (result) {
        setMarketplaceApis(result.apis);
      }
    } catch (error) {
      setMarketplaceError(error instanceof Error ? error.message : "Marketplace search failed");
    } finally {
      setMarketplaceLoading(false);
    }
  }

  function setDashboardDeepLink(link: DashboardDeepLink) {
    const hash = formatDashboardHash(link);
    handledHashRef.current = hash;
    window.history.replaceState(null, "", hash);
  }

  async function openMarketplaceApiById(apiId: string, options: { updateHash?: boolean } = {}) {
    const existingRow = marketplaceRows.find((row) => row.id === apiId);
    if (existingRow) {
      await selectMarketplaceApi(existingRow, options);
      return;
    }

    if (!hasConsoleApi()) {
      setMarketplaceDetailError("Connect VITE_SUI402_CONSOLE_API_URL to open a shared marketplace API link.");
      return;
    }

    setMarketplaceDetailLoading(true);
    setMarketplaceDetailError(undefined);
    try {
      const result = await fetchMarketplaceApiDetail(apiId);
      if (result) {
        setSelectedMarketplaceApi(marketplaceApiToRow(result.api));
        setMarketplaceDetail(result);
        if (options.updateHash) {
          setDashboardDeepLink({ marketplaceApiId: result.api.id });
        }
      }
    } catch (error) {
      setMarketplaceDetailError(error instanceof Error ? error.message : "Marketplace API detail failed");
    } finally {
      setMarketplaceDetailLoading(false);
    }
  }

  async function selectMarketplaceApi(row: MarketplaceRow, options: { updateHash?: boolean } = {}) {
    setSelectedMarketplaceApi(row);
    setMarketplaceDetail(undefined);
    setMarketplaceDetailError(undefined);
    if (options.updateHash) {
      setDashboardDeepLink({ marketplaceApiId: row.id });
    }

    if (!hasConsoleApi()) {
      return;
    }

    setMarketplaceDetailLoading(true);
    try {
      const result = await fetchMarketplaceApiDetail(row.id);
      setMarketplaceDetail(result);
    } catch (error) {
      setMarketplaceDetailError(error instanceof Error ? error.message : "Marketplace API detail failed");
    } finally {
      setMarketplaceDetailLoading(false);
    }
  }

  async function runScanLookup(input = scanQuery, selectedKind: ScanLookupKind | "auto" = scanKind) {
    const id = input.trim();
    if (!id) {
      setScanError("Enter a payment digest, merchant id, session id, or settlement id.");
      setScanResult(undefined);
      return;
    }
    if (!hasConsoleApi()) {
      setScanError("Connect VITE_SUI402_CONSOLE_API_URL to use live scan lookup.");
      setScanResult(undefined);
      return;
    }

    const candidateKinds = selectedKind === "auto" ? inferScanLookupKinds(id, apiState.merchants, apiState.listings) : [selectedKind];
    setScanLoading(true);
    setScanError(undefined);
    setScanResult(undefined);
    try {
      let lastError: unknown;
      for (const candidateKind of candidateKinds) {
        try {
          const result = await fetchScanLookup(candidateKind, id);
          if (result) {
            setScanResult(result);
            setScanKind(candidateKind);
            setDashboardDeepLink({ scanKind: candidateKind, scanId: id });
            return;
          }
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Scan lookup failed");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Scan lookup failed");
    } finally {
      setScanLoading(false);
    }
  }

  function navigateDashboardPage(pageId: DashboardPageId, targetId?: string) {
    setActivePage(pageId);
    const hash = pageId === "overview" ? "" : `#page=${pageId}`;
    handledHashRef.current = hash || undefined;
    window.history.replaceState(null, "", hash || window.location.pathname);

    window.setTimeout(() => {
      const target = document.getElementById(targetId ?? defaultTargetForDashboardPage(pageId));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function inspectPaymentDigest(digest: string) {
    setScanQuery(digest);
    setScanKind("payment");
    navigateDashboardPage("scan", "scan-explorer");
    void runScanLookup(digest, "payment");
  }

  useEffect(() => {
    void refreshOverview();
  }, []);

  useEffect(() => {
    void refreshMarketplace();
    // Run once at mount; explicit search controls refresh after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handlePageHash() {
      const nextPage = parseDashboardPage(window.location.hash);
      if (nextPage) {
        setActivePage(nextPage);
      }
    }

    handlePageHash();
    window.addEventListener("hashchange", handlePageHash);
    return () => window.removeEventListener("hashchange", handlePageHash);
  }, []);

  const visiblePayments = useMemo(
    () => apiState.payments.filter((row) => filter === "all" || row.status === filter),
    [apiState.payments, filter]
  );
  const fallbackMarketplaceRows = useMemo(
    () => buildMarketplaceRows(apiState.listings, apiState.merchants, apiState.payments),
    [apiState.listings, apiState.merchants, apiState.payments]
  );
  const marketplaceRows = useMemo(
    () => (marketplaceApis.length > 0 ? marketplaceApis.map(marketplaceApiToRow) : fallbackMarketplaceRows),
    [fallbackMarketplaceRows, marketplaceApis]
  );
  const mcpRows = useMemo(() => marketplaceRows.filter((row) => row.transport === "mcp" || row.resourceScope.startsWith("mcp:")), [marketplaceRows]);
  const marketplaceStats = useMemo(() => buildMarketplaceStats(marketplaceRows, apiState.payments), [marketplaceRows, apiState.payments]);
  const mcpStats = useMemo(() => buildMcpStats(mcpRows, apiState.payments), [mcpRows, apiState.payments]);
  const consoleModeLabel =
    apiState.error ? "Console API error" : hasConsoleApi() ? `${apiState.mode} console API` : "Local seeded preview";
  const latestPaymentDigest = apiState.payments[0]?.digest;
  const pageHeader = dashboardPageHeaders[activePage];
  const pageActionTarget = pageHeader.actionPage;

  useEffect(() => {
    function handleDashboardDeepLink() {
      const routeLink = parseDashboardPath(window.location.pathname);
      if (routeLink.marketplaceApiId) {
        setActivePage("marketplace");
        window.setTimeout(() => document.getElementById("registry")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        void openMarketplaceApiById(routeLink.marketplaceApiId);
        return;
      }

      if (routeLink.scanKind && routeLink.scanId) {
        setActivePage("scan");
        setScanQuery(routeLink.scanId);
        setScanKind(routeLink.scanKind);
        window.setTimeout(() => document.getElementById("scan-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        void runScanLookup(routeLink.scanId, routeLink.scanKind);
        return;
      }

      const hash = window.location.hash;
      if (!hash || hash === handledHashRef.current) {
        return;
      }

      const link = parseDashboardHash(hash);
      if (link.marketplaceApiId) {
        handledHashRef.current = hash;
        setActivePage("marketplace");
        window.setTimeout(() => document.getElementById("registry")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        void openMarketplaceApiById(link.marketplaceApiId);
        return;
      }

      if (link.scanKind && link.scanId) {
        handledHashRef.current = hash;
        setActivePage("scan");
        setScanQuery(link.scanId);
        setScanKind(link.scanKind);
        window.setTimeout(() => document.getElementById("scan-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        void runScanLookup(link.scanId, link.scanKind);
      }
    }

    handleDashboardDeepLink();
    window.addEventListener("hashchange", handleDashboardDeepLink);
    window.addEventListener("popstate", handleDashboardDeepLink);
    return () => {
      window.removeEventListener("hashchange", handleDashboardDeepLink);
      window.removeEventListener("popstate", handleDashboardDeepLink);
    };
    // Re-check the current deep link when marketplace rows move from loading to available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceRows]);

  useEffect(() => {
    if (selectedMarketplaceApi && !marketplaceRows.some((row) => row.id === selectedMarketplaceApi.id)) {
      setSelectedMarketplaceApi(undefined);
      setMarketplaceDetail(undefined);
      setMarketplaceDetailError(undefined);
    }
  }, [marketplaceRows, selectedMarketplaceApi]);

  useEffect(() => {
    const routeLink = parseDashboardPath(window.location.pathname);
    const hashLink = parseDashboardHash(window.location.hash);
    updateDashboardDocumentMetadata(
      buildDashboardDocumentMetadata({
        link:
          routeLink.marketplaceApiId || (routeLink.scanKind && routeLink.scanId)
            ? routeLink
            : hashLink,
        selectedMarketplaceApi,
        marketplaceDetail,
        marketplaceDetailLoading,
        marketplaceDetailError,
        scanResult,
        scanQuery,
        scanKind,
        scanLoading,
        scanError
      })
    );
  }, [
    selectedMarketplaceApi,
    marketplaceDetail,
    marketplaceDetailLoading,
    marketplaceDetailError,
    scanResult,
    scanQuery,
    scanKind,
    scanLoading,
    scanError
  ]);

  const applicationRows = useMemo(() => apiState.merchantApplications.slice(0, 5), [apiState.merchantApplications]);
  const pendingApplicationCount = apiState.merchantApplications.filter((application) => application.status === "pending").length;
  const merchantChangeRows = useMemo(() => apiState.merchantChangeRequests.slice(0, 5), [apiState.merchantChangeRequests]);
  const pendingMerchantChangeCount = apiState.merchantChangeRequests.filter((request) => request.status === "pending").length;
  const settlementRows = useMemo(() => apiState.settlements.slice(0, 5), [apiState.settlements]);
  const auditRows = useMemo(() => apiState.auditEvents.slice(0, 6), [apiState.auditEvents]);
  const setupPrompt = buildSetupPrompt(draft, environment);
  const publisherWalletProofMessage = useMemo(
    () => (submittedApplication ? buildPublisherWalletProofMessage(submittedApplication) : undefined),
    [submittedApplication]
  );
  const publisherDraftInput = useMemo(
    () => ({
      apiUrl: draft.apiUrl,
      openApiUrl: draft.openApiUrl || undefined,
      openApiOperationId: draft.openApiOperationId || undefined,
      openApiMethod: draft.openApiMethod || undefined,
      openApiPath: draft.openApiPath || undefined,
      id: draft.id || undefined,
      service: draft.service || undefined,
      merchant: draft.address,
      network: environment === "Mainnet" ? ("sui:mainnet" as const) : ("sui:testnet" as const),
      coinType: draft.coinType || undefined,
      price: draft.price || undefined,
      resourceScope: draft.resourceScope || undefined,
      upstreamTimeoutMs: 15000,
      sessionPackageId: draft.sessionPackageId || undefined,
      transport: "http" as const,
      applicantEmail: draft.applicantEmail || undefined,
      organization: draft.service || serviceFromUrl(draft.apiUrl) || "Publisher API",
      notes: `Publisher submitted API URL: ${draft.apiUrl}`,
      metadata: {
        upstreamUrl: draft.apiUrl,
        openApiUrl: draft.openApiUrl || undefined,
        openApiOperationId: draft.openApiOperationId || undefined,
        openApiMethod: draft.openApiMethod || undefined,
        openApiPath: draft.openApiPath || undefined,
        submittedFrom: "dashboard-add-api",
        flow: "publisher-api-draft"
      }
    }),
    [draft, environment]
  );

  async function publishExport(kind: "payment-ledger" | "receipts" | "audit-head") {
    try {
      setExporting(kind);
      await publishConsoleExport(kind);
      await refreshOverview();
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Walrus export failed"
      }));
    } finally {
      setExporting(undefined);
    }
  }

  async function reviewApplication(applicationId: string, action: "approve" | "reject") {
    try {
      await reviewMerchantApplication(applicationId, {
        action,
        reviewer: "dashboard-operator",
        reason: action === "approve" ? "Approved from operator console" : "Rejected from operator console"
      });
      await refreshOverview();
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Application review failed"
      }));
    }
  }

  async function reviewMerchantChange(requestId: string, action: "approve" | "reject") {
    try {
      await reviewMerchantChangeRequest(requestId, {
        action,
        reviewer: "dashboard-operator",
        reason: action === "approve" ? "Approved from operator console" : "Rejected from operator console"
      });
      await refreshOverview();
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Merchant change review failed"
      }));
    }
  }

  async function verifyApplication(applicationId: string) {
    try {
      await verifyMerchantApplication(applicationId);
      await refreshOverview();
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Application verification failed"
      }));
    }
  }

  async function previewPublisherDraft() {
    if (!draft.apiUrl) {
      setApiState((current) => ({
        ...current,
        error: "Paste an API endpoint before previewing"
      }));
      return;
    }

    setPublisherPreviewLoading(true);
    try {
      const result = await previewPublisherApiDraft(publisherDraftInput);
      if (result) {
        setPublisherPreview(result);
      }
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Publisher API preview failed"
      }));
    } finally {
      setPublisherPreviewLoading(false);
    }
  }

  async function startPublisherApiListing() {
    if (!draft.apiUrl) {
      setApiState((current) => ({
        ...current,
        error: "Paste an API endpoint first"
      }));
      return;
    }

    setPublisherDetailsOpen(true);
    setApiState((current) => ({ ...current, error: undefined }));
    await previewPublisherDraft();
  }

  async function resumePublisherApi() {
    const applicationId = publisherResume.applicationId.trim();
    const token = publisherResume.publisherAccessToken.trim();
    if (!applicationId || !token) {
      setApiState((current) => ({
        ...current,
        error: "Paste the merchant application id and private publisher access token to resume"
      }));
      return;
    }

    setPublisherResumeLoading(true);
    try {
      const status = await fetchPublisherApiStatus(applicationId, { publisherAccessToken: token });
      if (status) {
        setSubmittedApplication(status.application);
        setSubmittedNextSteps(status.nextSteps);
        setSubmittedPreview(status.preview);
        setPublisherAccessToken(token);
        setPublisherSession(undefined);
        setPublisherProbe(undefined);
        setPublished(true);
      }
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "Publisher API resume failed; make sure this is the private publisher access token, not the public verification token"
      }));
    } finally {
      setPublisherResumeLoading(false);
    }
  }

  async function submitPublisherWalletProofForDraft() {
    if (!submittedApplication || !publisherWalletProofMessage) {
      setApiState((current) => ({
        ...current,
        error: "Submit or resume a publisher API before attaching payout wallet proof"
      }));
      return;
    }
    const signature = publisherWalletSignature.trim();
    if (!signature) {
      setApiState((current) => ({
        ...current,
        error: "Paste the Sui personal-message signature from the payout wallet"
      }));
      return;
    }

    setPublisherWalletProofLoading(true);
    try {
      const result = await submitPublisherWalletProof(submittedApplication.id, {
        message: publisherWalletProofMessage,
        signature
      });
      if (result) {
        setSubmittedApplication(result.application);
        setSubmittedNextSteps(result.nextSteps);
        setPublisherWalletSignature("");
      }
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Publisher wallet proof failed"
      }));
    } finally {
      setPublisherWalletProofLoading(false);
    }
  }

  async function ensurePublisherSession(): Promise<PublisherSessionResponse | undefined> {
    const token = submittedApplication?.verification?.accessToken ?? publisherAccessToken;
    if (!submittedApplication || !token) {
      setApiState((current) => ({
        ...current,
        error: "Submit an upstream-backed publisher API and keep the private publisher access token before creating a publisher session"
      }));
      return undefined;
    }

    if (publisherSession && Date.parse(publisherSession.expiresAt) > Date.now() + 30_000) {
      return publisherSession;
    }

    setPublisherSessionLoading(true);
    try {
      const session = await createPublisherSession(submittedApplication.id, token, { ttlSeconds: 900 });
      if (session) {
        setPublisherSession(session);
      }
      return session;
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Publisher session exchange failed"
      }));
      return undefined;
    } finally {
      setPublisherSessionLoading(false);
    }
  }

  async function probeSubmittedPublisherApi() {
    if (!submittedApplication) {
      setApiState((current) => ({
        ...current,
        error: "Submit an upstream-backed publisher API before probing readiness"
      }));
      return;
    }

    setPublisherProbeLoading(true);
    try {
      const session = await ensurePublisherSession();
      if (!session) {
        return;
      }
      const result = await probePublisherApi(submittedApplication.id, {
        publisherSessionToken: session.publisherSessionToken
      });
      if (result) {
        setPublisherProbe(result);
      }
    } catch (error) {
      setApiState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Publisher API probe failed"
      }));
    } finally {
      setPublisherProbeLoading(false);
    }
  }

  return (
    <div className="app-shell">
      {/* Animated background gradient mesh */}
      <div className="bg-mesh" aria-hidden="true">
        <div className="bg-mesh-accent" />
      </div>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S4</div>
          <div>
            <strong>Sui402</strong>
            <span>Console</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item, i) => {
            const pageId = item.pageId as DashboardPageId;
            const isActive = activePage === pageId;
            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={`nav-item animate-slide-in stagger-${i + 1} ${isActive ? "active" : ""}`}
                key={item.label}
                onClick={() => navigateDashboardPage(pageId)}
                type="button"
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <span>Replay checks and scope binding are enforced before access.</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <form
            className="search scan-global-search"
            onSubmit={(event) => {
              event.preventDefault();
              navigateDashboardPage("scan", "scan-explorer");
              void runScanLookup();
            }}
          >
            <Search size={18} />
            <input
              aria-label="Search scan records"
              value={scanQuery}
              placeholder="Lookup digest, merchant, session, settlement..."
              onChange={(event) => setScanQuery(event.target.value)}
            />
            <select
              aria-label="Scan lookup type"
              value={scanKind}
              onChange={(event) => setScanKind(event.target.value as ScanLookupKind | "auto")}
            >
              <option value="auto">Auto</option>
              <option value="payment">Payment</option>
              <option value="merchant">Merchant</option>
              <option value="session">Session</option>
              <option value="settlement">Settlement</option>
            </select>
            <button type="submit">{scanLoading ? "Looking..." : "Lookup"}</button>
          </form>

          <div className="topbar-actions">
            <span className={`mode-chip ${apiState.error ? "error" : apiState.mode}`}>{apiState.error ? "API error" : apiState.mode}</span>
            <button
              className="select-button"
              onClick={() => setEnvironment(environment === "Testnet" ? "Mainnet" : "Testnet")}
            >
              {environment}
              <ChevronDown size={16} />
            </button>
            <button className="icon-button" aria-label="Refresh console data" onClick={() => void refreshOverview()}>
              <RefreshCw size={17} />
            </button>
            <div className="profile">
              <span>Operator</span>
              <div>S4</div>
            </div>
          </div>
        </header>

        <section className="page-heading" id="overview">
          <div>
            <span className="eyebrow">{pageHeader.eyebrow}</span>
            <h1>{pageHeader.title}</h1>
            <p>{pageHeader.description}</p>
          </div>
          {pageHeader.action && pageActionTarget ? (
            <button
              className="primary-button"
              onClick={() => {
                if (activePage === "mcp" && pageActionTarget === "publisher") {
                  setDraft({
                    ...draft,
                    resourceScope: draft.resourceScope.startsWith("mcp:") ? draft.resourceScope : "mcp:*",
                    service: draft.service || "MCP tool server"
                  });
                }
                navigateDashboardPage(pageActionTarget);
              }}
            >
              <Plus size={18} />
              {pageHeader.action}
            </button>
          ) : null}
        </section>

        <section className="product-map page-section" id="overview-page" hidden={activePage !== "overview"} aria-label="What is built in this demo">
          <article className="product-map-intro">
            <span className="eyebrow">Start here</span>
            <h2>This screen is three products in one demo.</h2>
            <p>
              If it felt confusing, that is on the product. The dashboard was showing operator data before explaining the system.
              The demoable path is simple: find an API or MCP tool, pay from an agent-owned Sui wallet, then inspect the proof.
            </p>
            <div className="demo-route" aria-label="Primary demo route">
              <span>1. Find API</span>
              <span>2. Pay on Sui</span>
              <span>3. Call endpoint</span>
              <span>4. Verify proof</span>
            </div>
          </article>

          <div className="product-map-cards">
            <article>
              <span className="status-dot ready" />
              <div>
                <strong>Agent buyer flow</strong>
                <p>Marketplace cards expose bounded <code>sui402-pay</code> commands for agents with their own Sui wallet.</p>
              </div>
              <button className="text-button" type="button" onClick={() => navigateDashboardPage("marketplace")}>
                Browse APIs
              </button>
            </article>
            <article>
              <span className="status-dot ready" />
              <div>
                <strong>MCP tool flow</strong>
                <p>Agents can discover paid MCP scopes, pay on Sui, and call tools with verifiable payment evidence.</p>
              </div>
              <button className="text-button" type="button" onClick={() => navigateDashboardPage("mcp")}>
                Open MCP
              </button>
            </article>
            <article>
              <span className="status-dot ready" />
              <div>
                <strong>Publisher intake</strong>
                <p>API owners can submit an endpoint, price, resource scope, payout wallet, and review proof.</p>
              </div>
              <button className="text-button" type="button" onClick={() => navigateDashboardPage("publisher")}>
                Add API
              </button>
            </article>
            <article>
              <span className="status-dot partial" />
              <div>
                <strong>Scan and operator console</strong>
                <p>Payments, sessions, reviews, exports, and audit events are visible here. Some rows use seeded demo data offline.</p>
              </div>
              <button className="text-button" type="button" onClick={() => navigateDashboardPage("scan")}>
                Inspect proof
              </button>
            </article>
          </div>
        </section>

        <section className="proof-strip page-section" hidden={activePage !== "overview"} aria-label="Demo data provenance">
          <article>
            <span>Data source</span>
            <strong>{consoleModeLabel}</strong>
            <small>{hasConsoleApi() ? "Live routes are queried from the console backend." : "Seeded records keep the demo deterministic offline."}</small>
          </article>
          <article>
            <span>Agent path</span>
            <strong>search -&gt; pay -&gt; retry -&gt; inspect</strong>
            <small>Every marketplace card exposes a bounded `sui402-pay` command.</small>
          </article>
          <article>
            <span>Latest evidence</span>
            <strong>{latestPaymentDigest ? shortValue(latestPaymentDigest) : "not indexed yet"}</strong>
            <small>{latestPaymentDigest ? "Use scan lookup to open the public proof." : "Run a paid call to create scan evidence."}</small>
          </article>
        </section>

        <section className="kpi-grid page-section" hidden={activePage !== "overview"} aria-label="Summary metrics">
          {apiState.kpis.map((item, i) => (
            <article className={`kpi-card animate-in stagger-${i + 1}`} key={item.label} style={{ position: "relative" }}>
              <CornerMarks />
              <div className="kpi-icon">
                <item.icon size={18} />
              </div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </section>

        <section className="panel marketplace-panel page-section" id="registry" hidden={activePage !== "marketplace"} aria-label="Sui402 marketplace scan">
          <div className="marketplace-hero">
            <div>
              <span className="eyebrow">Public marketplace</span>
              <h2>Find an API, copy the agent command, pay on Sui.</h2>
              <p>
                Agent-readable discovery backed by the same registry endpoint used by <code>sui402-pay search</code>.
              </p>
            </div>
            <div className="scan-badge">
              <Radar size={16} />
              {hasConsoleApi() ? "Marketplace API" : "Local preview"}
            </div>
          </div>

          <form
            className="marketplace-search"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshMarketplace(marketplaceFilters);
            }}
          >
            <label className="marketplace-query">
              Search paid APIs
              <span>
                <Search size={16} />
                <input
                  value={marketplaceFilters.query}
                  placeholder="weather, search, image, MCP..."
                  onChange={(event) => setMarketplaceFilters({ ...marketplaceFilters, query: event.target.value })}
                />
              </span>
            </label>
            <label>
              Network
              <select
                value={marketplaceFilters.network}
                onChange={(event) =>
                  setMarketplaceFilters({
                    ...marketplaceFilters,
                    network: event.target.value as MarketplaceFilters["network"]
                  })
                }
              >
                <option value="">All networks</option>
                <option value="sui:testnet">Testnet</option>
                <option value="sui:mainnet">Mainnet</option>
                <option value="sui:devnet">Devnet</option>
                <option value="sui:localnet">Localnet</option>
              </select>
            </label>
            <label>
              Transport
              <select
                value={marketplaceFilters.transport}
                onChange={(event) =>
                  setMarketplaceFilters({
                    ...marketplaceFilters,
                    transport: event.target.value as MarketplaceFilters["transport"]
                  })
                }
              >
                <option value="">HTTP + MCP</option>
                <option value="http">HTTP APIs</option>
                <option value="mcp">MCP tools</option>
              </select>
            </label>
            <button className="primary-button marketplace-search-button" type="submit" disabled={marketplaceLoading}>
              {marketplaceLoading ? "Searching..." : "Search"}
            </button>
          </form>

          {marketplaceError ? (
            <div className="marketplace-alert">
              <strong>Marketplace search failed</strong>
              <span>{marketplaceError}</span>
            </div>
          ) : null}

          <div className="marketplace-stats" aria-label="Marketplace ecosystem stats">
            <div>
              <Globe2 size={16} />
              <strong>{marketplaceStats.listings}</strong>
              <span>listed APIs</span>
            </div>
            <div>
              <Server size={16} />
              <strong>{marketplaceStats.sessionReady}</strong>
              <span>session-ready</span>
            </div>
            <div>
              <Route size={16} />
              <strong>{marketplaceStats.networks}</strong>
              <span>networks</span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <strong>{marketplaceStats.verifiedPayments}</strong>
              <span>verified proofs</span>
            </div>
          </div>

          <div className="marketplace-list">
            {marketplaceLoading && marketplaceRows.length === 0 ? (
              Array.from({ length: 3 }).map((_, index) => <div className="marketplace-card skeleton-card" key={index} />)
            ) : marketplaceRows.length === 0 ? (
              <div className="marketplace-empty">
                <Search size={18} />
                <strong>No APIs found</strong>
                <span>Try a broader query or add the first publisher API.</span>
              </div>
            ) : (
              marketplaceRows.slice(0, 8).map((row) => {
                const command = marketplaceCommandForRow(row);
                return (
                <article className="marketplace-card" key={row.id}>
                  <div className="marketplace-card-top">
                    <div>
                      <div className="marketplace-title">
                        <strong>{row.name}</strong>
                        <span className={`transport-chip ${row.transport}`}>{row.transport}</span>
                      </div>
                      <p>{row.description}</p>
                    </div>
                    <span className={`status ${row.status === "active" ? "verified" : row.status === "paused" ? "review" : "session"}`}>
                      {row.status}
                    </span>
                  </div>

                  <div className="marketplace-command">
                    <span>$</span>
                    <code>{command}</code>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(command)}
                    >
                      <Copy size={13} />
                      Copy
                    </button>
                  </div>

                  <div className="marketplace-meta">
                    <div>
                      <span>Price</span>
                      <strong>{formatPrice(row.price, row.coinType)}</strong>
                    </div>
                    <div>
                      <span>Network</span>
                      <strong>{formatNetwork(row.network)}</strong>
                    </div>
                    <div>
                      <span>Resource</span>
                      <strong>{row.resourceScope}</strong>
                    </div>
                    <div>
                      <span>Payments</span>
                      <strong>{row.paymentCount.toLocaleString()}</strong>
                    </div>
                  </div>

                  <div className="marketplace-card-footer">
                    <div className="tag-row">
                      {(row.tags.length > 0 ? row.tags : [row.sessionSupported ? "sessions" : "one-shot"]).slice(0, 3).map((tag) => (
                        <span key={`${row.id}-${tag}`}>{tag}</span>
                      ))}
                    </div>
                    <div className="marketplace-actions">
                      <span>{row.readiness ? readinessLabel(row.readiness) : row.sessionSupported ? "Session + one-shot" : "One-shot payments"}</span>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void selectMarketplaceApi(row, { updateHash: true })}
                      >
                        Details
                      </button>
                      {row.endpoint ? (
                        <a href={row.endpoint} target="_blank" rel="noreferrer">
                          Open
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
                );
              })
            )}
          </div>

          {selectedMarketplaceApi ? (
            <MarketplaceApiDetailPanel
              row={selectedMarketplaceApi}
              detail={marketplaceDetail}
              loading={marketplaceDetailLoading}
              error={marketplaceDetailError}
              shareUrl={shareUrlForPath(formatDashboardPath({ marketplaceApiId: marketplaceDetail?.api.id ?? selectedMarketplaceApi.id }))}
              onClose={() => {
                setSelectedMarketplaceApi(undefined);
                setMarketplaceDetail(undefined);
                setMarketplaceDetailError(undefined);
              }}
              onScan={(merchantId) => {
                setScanQuery(merchantId);
                setScanKind("merchant");
                navigateDashboardPage("scan", "scan-explorer");
                void runScanLookup(merchantId, "merchant");
              }}
            />
          ) : null}
        </section>

        <section className="panel mcp-panel page-section" id="mcp-page" hidden={activePage !== "mcp"} aria-label="Sui402 MCP tools">
          <div className="marketplace-hero">
            <div>
              <span className="eyebrow">Package: @sui402/mcp</span>
              <h2>Sui402 ships its own paid MCP server.</h2>
              <p>
                The bundled <code>sui402-mcp</code> server exposes MCP tools over stdio, returns a payment challenge when
                a tool is unpaid, verifies Sui payment proofs, and records successful tool calls.
              </p>
            </div>
            <div className="scan-badge">
              <Server size={16} />
              sui402-mcp
            </div>
          </div>

          <div className="mcp-explainer-grid">
            <article>
              <span>Server binary</span>
              <strong>sui402-mcp</strong>
              <p>Runs a paid MCP server from env config. Supports one tool or a JSON array of paid tool definitions.</p>
            </article>
            <article>
              <span>Client config</span>
              <strong>sui402-mcp-config</strong>
              <p>Generates Claude/Cursor-compatible <code>mcpServers</code> config with merchant, price, network, and tool metadata.</p>
            </article>
            <article>
              <span>Proof loop</span>
              <strong>challenge -&gt; pay -&gt; verify -&gt; record</strong>
              <p>Unpaid calls return a Sui402 challenge. Paid calls are verified on Sui and recorded to block digest replay.</p>
            </article>
          </div>

          <div className="mcp-server-commands">
            <ScanCodeRow label="install" value="npm install @sui402/mcp" />
            <ScanCodeRow
              label="run server"
              value="SUI402_MERCHANT_ADDRESS=0x... SUI402_PRICE=1000000 sui402-mcp"
            />
            <ScanCodeRow
              label="generate client config"
              value="sui402-mcp-config --merchant 0x... --price 1000000 --tool-name premium_context"
            />
          </div>

          <div className="mcp-section-heading">
            <div>
              <span className="eyebrow">MCP marketplace</span>
              <h2>Paid MCP tools listed for agents</h2>
              <p>These are MCP listings discovered from the registry via <code>transport: "mcp"</code> or <code>mcp:*</code> resource scopes.</p>
            </div>
          </div>

          <div className="marketplace-stats mcp-stats" aria-label="MCP marketplace stats">
            <div>
              <Network size={16} />
              <strong>{mcpStats.tools}</strong>
              <span>MCP tools</span>
            </div>
            <div>
              <Server size={16} />
              <strong>{mcpStats.sessionReady}</strong>
              <span>session-ready</span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <strong>{mcpStats.verifiedPayments}</strong>
              <span>tool payments</span>
            </div>
            <div>
              <Globe2 size={16} />
              <strong>{mcpStats.networks}</strong>
              <span>networks</span>
            </div>
          </div>

          <div className="mcp-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setMarketplaceFilters({ ...marketplaceFilters, transport: "mcp" });
                navigateDashboardPage("marketplace");
                void refreshMarketplace({ ...marketplaceFilters, transport: "mcp" });
              }}
            >
              Browse MCP in marketplace
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setDraft({
                  ...draft,
                  resourceScope: draft.resourceScope.startsWith("mcp:") ? draft.resourceScope : "mcp:*",
                  service: draft.service || "MCP tool server"
                });
                navigateDashboardPage("publisher");
              }}
            >
              List MCP server
            </button>
          </div>

          <div className="marketplace-list mcp-list">
            {mcpRows.length === 0 ? (
              <div className="marketplace-empty">
                <Network size={18} />
                <strong>No MCP tools listed yet</strong>
                <span>List an MCP server from the Publisher page or switch the marketplace filter to MCP tools.</span>
              </div>
            ) : (
              mcpRows.slice(0, 6).map((row) => {
                const command = marketplaceCommandForRow(row);
                return (
                  <article className="marketplace-card mcp-card" key={`mcp-${row.id}`}>
                    <div className="marketplace-card-top">
                      <div>
                        <div className="marketplace-title">
                          <strong>{row.name}</strong>
                          <span className="transport-chip mcp">mcp</span>
                        </div>
                        <p>{row.description}</p>
                      </div>
                      <span className={`status ${row.status === "active" ? "verified" : row.status === "paused" ? "review" : "session"}`}>
                        {row.status}
                      </span>
                    </div>
                    <div className="marketplace-command">
                      <span>$</span>
                      <code>{command}</code>
                      <button className="ghost-button" type="button" onClick={() => void navigator.clipboard?.writeText(command)}>
                        <Copy size={13} />
                        Copy
                      </button>
                    </div>
                    <div className="marketplace-meta">
                      <div>
                        <span>Tool scope</span>
                        <strong>{row.resourceScope}</strong>
                      </div>
                      <div>
                        <span>Price</span>
                        <strong>{formatPrice(row.price, row.coinType)}</strong>
                      </div>
                      <div>
                        <span>Network</span>
                        <strong>{formatNetwork(row.network)}</strong>
                      </div>
                      <div>
                        <span>Mode</span>
                        <strong>{row.sessionSupported ? "session" : "one-shot"}</strong>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="panel scan-explorer-panel page-section" id="scan-explorer" hidden={activePage !== "scan"} aria-label="Sui402 scan explorer">
          <div className="marketplace-hero">
            <div>
              <span className="eyebrow">Public scan</span>
              <h2>Inspect indexed payment, merchant, session, and settlement evidence.</h2>
              <p>
                These views are read-only and intentionally show sanitized indexed records: digests, amounts, receipts,
                sessions, and listing context without request payloads or private headers.
              </p>
            </div>
            <div className="scan-badge">
              <Radar size={16} />
              {scanResult ? scanResult.kind : "Explorer"}
            </div>
          </div>

          <form
            className="scan-lookup-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runScanLookup();
            }}
          >
            <label className="marketplace-query">
              Record identifier
              <span>
                <Search size={16} />
                <input
                  value={scanQuery}
                  placeholder="digest-atlas-1, atlas-api, 0xsession, settlement-digest-1..."
                  onChange={(event) => setScanQuery(event.target.value)}
                />
              </span>
            </label>
            <label>
              Type
              <select
                value={scanKind}
                onChange={(event) => setScanKind(event.target.value as ScanLookupKind | "auto")}
              >
                <option value="auto">Auto detect</option>
                <option value="payment">Payment</option>
                <option value="merchant">Merchant</option>
                <option value="session">Session</option>
                <option value="settlement">Settlement</option>
              </select>
            </label>
            <button className="primary-button marketplace-search-button" type="submit" disabled={scanLoading}>
              {scanLoading ? "Looking..." : "Inspect"}
            </button>
          </form>

          <div className="scan-suggestions" aria-label="Scan quick lookups">
            {apiState.payments.slice(0, 3).map((row) => (
              <button
                type="button"
                key={`payment-${row.digest}`}
                onClick={() => {
                  setScanQuery(row.digest);
                  void runScanLookup(row.digest, "payment");
                }}
              >
                payment <code>{shortValue(row.digest)}</code>
              </button>
            ))}
            {marketplaceRows.slice(0, 3).map((row) => (
              <button
                type="button"
                key={`merchant-${row.id}`}
                onClick={() => {
                  setScanQuery(row.id);
                  void runScanLookup(row.id, "merchant");
                }}
              >
                merchant <code>{row.id}</code>
              </button>
            ))}
          </div>

          {scanError ? (
            <div className="marketplace-alert">
              <strong>Scan lookup failed</strong>
              <span>{scanError}</span>
            </div>
          ) : null}

          <div className="scan-result-shell">
            {scanLoading ? (
              <div className="scan-loading-grid">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div className="scan-skeleton" key={index} />
                ))}
              </div>
            ) : scanResult ? (
              <ScanResultCard result={scanResult} />
            ) : (
              <div className="marketplace-empty scan-empty">
                <Radar size={18} />
                <strong>No scan record selected</strong>
                <span>Paste an identifier or use a quick lookup to inspect what the index currently proves.</span>
              </div>
            )}
          </div>
        </section>

        <section className="content-grid page-section" hidden={activePage !== "scan" && activePage !== "operator"}>
          <article className="panel activity-panel" id="payments" style={{ position: "relative" }}>
            <CornerMarks />
            <div className="panel-header">
              <div>
                <h2>Payment activity</h2>
                <p>Recent verified proofs across provider and gateway surfaces.</p>
              </div>
              <div className="filter-group" aria-label="Payment filters">
                {(["all", "verified", "session", "review"] as const).map((value) => (
                  <button
                    key={value}
                    className={filter === value ? "filter active" : "filter"}
                    onClick={() => setFilter(value)}
                  >
                    {value === "all" ? <Filter size={14} /> : null}
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Resource</th>
                    <th>Network</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Digest</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((row) => (
                    <tr key={row.digest}>
                      <td>{row.merchant}</td>
                      <td>{row.resource}</td>
                      <td>{row.network}</td>
                      <td>{row.amount}</td>
                      <td>
                        <span className={`status ${row.status}`}>{row.status}</span>
                      </td>
                      <td>
                        <button className="digest-button" onClick={() => inspectPaymentDigest(row.digest)} type="button">
                          {row.digest}
                          <ExternalLink size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-payment-list" aria-label="Mobile payment activity">
              {visiblePayments.map((row) => (
                <div className="mobile-payment-card" key={`mobile-${row.digest}`}>
                  <div>
                    <span>Merchant</span>
                    <strong>{row.merchant}</strong>
                  </div>
                  <div>
                    <span>Resource</span>
                    <strong>{row.resource}</strong>
                  </div>
                  <div>
                    <span>Network</span>
                    <strong>{row.network}</strong>
                  </div>
                  <div>
                    <span>Amount</span>
                    <strong>{row.amount}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <span className={`status ${row.status}`}>{row.status}</span>
                  </div>
                  <div>
                    <span>Digest</span>
                    <button className="digest-button" onClick={() => inspectPaymentDigest(row.digest)} type="button">
                      {row.digest}
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <aside className="right-rail">
            <article className="panel readiness-panel">
              <div className="panel-header compact">
                <h2>Readiness</h2>
                <button className="ghost-button">
                  Review
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="readiness-list">
                {apiState.readiness.map((item) => (
                  <div className="readiness-row" key={item.label}>
                    <div className={`readiness-icon ${item.status}`}>
                      <item.icon size={17} />
                    </div>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel manifest-panel" id="gateway">
              <div className="manifest-top">
                <KeyRound size={18} />
                <h2>Provider manifest health</h2>
              </div>
              <p>Network, merchant, price, resource scope, and session manager paths are discoverable.</p>
              <div className="manifest-code">/.well-known/sui402</div>
            </article>

            <article className="panel export-panel">
              <div className="manifest-top">
                <PackageCheck size={18} />
                <h2>Walrus exports</h2>
              </div>
              <div className="export-actions">
                <button
                  className="ghost-button"
                  disabled={Boolean(exporting)}
                  onClick={() => void publishExport("payment-ledger")}
                >
                  {exporting === "payment-ledger" ? "Exporting..." : "Ledger"}
                </button>
                <button
                  className="ghost-button"
                  disabled={Boolean(exporting)}
                  onClick={() => void publishExport("receipts")}
                >
                  {exporting === "receipts" ? "Exporting..." : "Receipts"}
                </button>
                <button
                  className="ghost-button"
                  disabled={Boolean(exporting)}
                  onClick={() => void publishExport("audit-head")}
                >
                  {exporting === "audit-head" ? "Anchoring..." : "Audit head"}
                </button>
              </div>
              <div className="export-list">
                {apiState.exports.length === 0 ? (
                  <div className="export-empty">
                    <strong>No exports yet</strong>
                    <span>Publish a ledger, receipt bundle, or audit head to see its Walrus blob ID here.</span>
                  </div>
                ) : (
                  apiState.exports.slice(0, 3).map((item) => (
                    <div className="export-row" key={`${item.kind}-${item.blobId}`}>
                      <div>
                        <strong>
                          {item.kind === "receipt-bundle"
                            ? "Receipt bundle"
                            : item.kind === "audit-head"
                              ? "Audit head"
                              : "Payment ledger"}
                        </strong>
                        <span>
                          {item.paymentCount.toLocaleString()} {item.kind === "audit-head" ? "events" : "records"}
                        </span>
                      </div>
                      <code>{item.blobId}</code>
                    </div>
                  ))
                )}
              </div>
            </article>
          </aside>
        </section>

        <section className="ops-grid page-section" id="operator-page" hidden={activePage !== "operator"} aria-label="Operator workflows">
          <article className="panel review-panel">
            <div className="panel-header">
              <div>
                <h2>Application review queue</h2>
                <p>{pendingApplicationCount.toLocaleString()} pending merchant applications need operator review.</p>
              </div>
              <span className="queue-count">{pendingApplicationCount}</span>
            </div>
            <div className="review-list">
              {applicationRows.length === 0 ? (
                <div className="empty-state">
                  <strong>No merchant applications</strong>
                  <span>Public seller intake will appear here after submissions.</span>
                </div>
              ) : (
                applicationRows.map((application) => (
                  <div className="review-row" key={application.id}>
                    <div className="review-main">
                      <div>
                        <strong>{application.request.service}</strong>
                        <span>{application.request.id}</span>
                      </div>
                      <span className={`status ${application.status === "approved" ? "verified" : application.status === "rejected" ? "review" : "session"}`}>
                        {application.status}
                      </span>
                    </div>
                    <div className="review-meta">
                      <span>{application.request.resourceScope}</span>
                      <span>{application.request.price} units</span>
                      {application.verification ? (
                        <span className={`verification-status ${application.verification.status}`}>
                          {application.verification.status === "verified" ? "Domain verified" : `Verify ${application.verification.status}`}
                        </span>
                      ) : null}
                      <span>{formatTimestamp(application.submittedAt)}</span>
                      {application.reviewDueAt ? (
                        <span className={isReviewOverdue(application) ? "review-overdue" : undefined}>
                          {isReviewOverdue(application) ? "Review overdue" : `Due ${formatTimestamp(application.reviewDueAt)}`}
                        </span>
                      ) : null}
                      {application.abuseControls ? (
                        <span>
                          SLA {application.abuseControls.reviewSlaHours}h · takedown {application.abuseControls.takedown.pendingApplication.path}
                        </span>
                      ) : null}
                      {application.abuseControls?.hostPolicy.blocklistConfigured ? <span>host blocklist active</span> : null}
                    </div>
                    {application.reviewDraft ? <PublisherReviewDraftCard reviewDraft={application.reviewDraft} compact /> : null}
                    {application.status === "pending" ? (
                      <div className="review-actions">
                        <button className="ghost-button" onClick={() => void reviewApplication(application.id, "reject")}>
                          Reject
                        </button>
                        {application.verification && application.verification.status !== "verified" ? (
                          <button className="ghost-button" onClick={() => void verifyApplication(application.id)}>
                            Check proof
                          </button>
                        ) : null}
                        <button
                          className="primary-button mini"
                          disabled={Boolean(application.verification && application.verification.status !== "verified")}
                          onClick={() => void reviewApplication(application.id, "approve")}
                        >
                          Approve
                        </button>
                      </div>
                    ) : (
                      <div className="review-decision">
                        <span>{application.reviewer ?? "operator"}</span>
                        <span>{application.reviewReason ?? application.publishedMerchantId ?? "reviewed"}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel review-panel risk-review-panel">
            <div className="panel-header">
              <div>
                <h2>High-risk change queue</h2>
                <p>{pendingMerchantChangeCount.toLocaleString()} payout, network, or coin changes need operator review.</p>
              </div>
              <span className="queue-count risk">{pendingMerchantChangeCount}</span>
            </div>
            <div className="review-list">
              {merchantChangeRows.length === 0 ? (
                <div className="empty-state">
                  <strong>No high-risk merchant changes</strong>
                  <span>Seller-submitted payout wallet, network, and coin requests will appear here.</span>
                </div>
              ) : (
                merchantChangeRows.map((request) => (
                  <div className="review-row risk-row" key={request.id}>
                    <div className="review-main">
                      <div>
                        <strong>{request.merchantId}</strong>
                        <span>{request.id}</span>
                      </div>
                      <span className={`status ${request.status === "approved" ? "verified" : request.status === "rejected" ? "review" : "session"}`}>
                        {request.status}
                      </span>
                    </div>
                    <div className="review-meta">
                      {merchantChangeFields(request).map((field) => (
                        <span className="risk-field" key={`${request.id}-${field}`}>
                          {field}: {merchantChangeValue(request, field)}
                        </span>
                      ))}
                      <span>seller {request.requestedBy ?? "unknown"}</span>
                      <span>{formatTimestamp(request.submittedAt)}</span>
                      {request.reviewDueAt ? (
                        <span className={isReviewDueOverdue(request.reviewDueAt, request.status) ? "review-overdue" : undefined}>
                          {isReviewDueOverdue(request.reviewDueAt, request.status)
                            ? "Review overdue"
                            : `Due ${formatTimestamp(request.reviewDueAt)}`}
                        </span>
                      ) : null}
                    </div>
                    {request.reason ? <p className="review-reason">{request.reason}</p> : null}
                    {request.status === "pending" ? (
                      <div className="review-actions">
                        <button className="ghost-button" onClick={() => void reviewMerchantChange(request.id, "reject")}>
                          Reject
                        </button>
                        <button className="primary-button mini" onClick={() => void reviewMerchantChange(request.id, "approve")}>
                          Approve change
                        </button>
                      </div>
                    ) : (
                      <div className="review-decision">
                        <span>{request.reviewer ?? "operator"}</span>
                        <span>{request.reviewReason ?? request.appliedMerchantId ?? "reviewed"}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel settlement-panel">
            <div className="panel-header">
              <div>
                <h2>Settlement reconciliation</h2>
                <p>Grouped verified payments with export context for finance and support.</p>
              </div>
            </div>
            <div className="settlement-list">
              {apiState.settlementReconciliation ? (
                <div className="reconciliation-strip">
                  <div>
                    <strong>{apiState.settlementReconciliation.settledCount.toLocaleString()}</strong>
                    <span>settled</span>
                  </div>
                  <div>
                    <strong>{apiState.settlementReconciliation.unsettledCount.toLocaleString()}</strong>
                    <span>unsettled</span>
                  </div>
                  <div>
                    <strong>
                      {(
                        apiState.settlementReconciliation.mismatchedCount +
                        apiState.settlementReconciliation.duplicateCount +
                        apiState.settlementReconciliation.orphanedEventCount
                      ).toLocaleString()}
                    </strong>
                    <span>exceptions</span>
                  </div>
                </div>
              ) : null}
              {(apiState.settlementCaveats ?? []).length > 0 ? (
                <div className="settlement-caveats">
                  {(apiState.settlementCaveats ?? []).map((caveat) => (
                    <span key={caveat}>{caveat}</span>
                  ))}
                </div>
              ) : null}
              {settlementRows.length === 0 ? (
                <div className="empty-state">
                  <strong>No settlement rows</strong>
                  <span>Verified payments will be grouped here by merchant, recipient, network, and coin.</span>
                </div>
              ) : (
                settlementRows.map((summary) => (
                  <div className="settlement-row" key={`${summary.merchantId}-${summary.network}-${summary.coinType}`}>
                    <div>
                      <strong>{summary.merchantId}</strong>
                      <span>{shortValue(summary.recipient)}</span>
                    </div>
                    <div>
                      <strong>{summary.totalAmount}</strong>
                      <span>
                        {summary.paymentCount.toLocaleString()} payments, {summary.receiptCount.toLocaleString()} receipts
                      </span>
                    </div>
                    <div>
                      <strong>{summary.network.replace("sui:", "")}</strong>
                      <span>{summary.latestExportBlobId ? `export ${shortValue(summary.latestExportBlobId)}` : "not exported"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel audit-panel" id="security">
            <div className="panel-header">
              <div>
                <h2>Audit trail</h2>
                <p>Recent sensitive console actions captured by the backend.</p>
              </div>
            </div>
            <div className="audit-list">
              {auditRows.length === 0 ? (
                <div className="empty-state">
                  <strong>No audit events</strong>
                  <span>Merchant, export, indexer, and review actions will appear here.</span>
                </div>
              ) : (
                auditRows.map((event) => (
                  <div className="audit-row" key={event.id}>
                    <div>
                      <strong>{event.action}</strong>
                      <span>{event.actorId ?? "public"}</span>
                    </div>
                    <div>
                      <span>{event.targetType ?? "target"}</span>
                      <code>{event.targetId ?? event.requestId ?? shortValue(event.id)}</code>
                    </div>
                    <time>{formatTimestamp(event.createdAt)}</time>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="panel onboarding-panel page-section" id="add-api" hidden={activePage !== "publisher"} style={{ position: "relative" }}>
          <CornerMarks />
          <div className="panel-header add-api-header">
            <div>
              <span className="eyebrow">Publisher onboarding</span>
              <h2>Add your API</h2>
              <p>List an endpoint so agents can discover it, pay on Sui, and call it through Sui402.</p>
            </div>
            {published ? (
              <span className="published">
                <Check size={15} />
                Submitted for review
              </span>
            ) : null}
          </div>

          <form
            className="add-api-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!publisherDetailsOpen) {
                void startPublisherApiListing();
                return;
              }

              void submitPublisherApiDraft(publisherDraftInput)
                .then((result) => {
                  if (result) {
                    setSubmittedApplication(result.application);
                    setSubmittedNextSteps(result.nextSteps);
                    setSubmittedPreview(result.preview);
                    setPublisherAccessToken(result.application.verification?.accessToken);
                    setPublisherSession(undefined);
                    setPublisherProbe(undefined);
                  }
                  return refreshOverview();
                })
                .then(() => setPublished(true))
                .catch((error: unknown) => {
                  setApiState((current) => ({
                    ...current,
                    error: error instanceof Error ? error.message : "API application failed"
                  }));
                });
            }}
          >
            <div className="api-url-row">
              <label>
                API endpoint
                <span className="url-input-shell">
                  <span>https://</span>
                  <input
                    required
                    inputMode="url"
                    value={stripProtocol(draft.apiUrl)}
                    placeholder="api.example.com/v1/search"
                    onChange={(event) => {
                      const apiUrl = normalizeUrlInput(event.target.value);
                      const nextId = slugFromUrl(apiUrl);
                      setDraft({
                        ...draft,
                        apiUrl,
                        id: draft.id && draft.id !== slugFromUrl(draft.apiUrl) ? draft.id : nextId,
                        service: draft.service && draft.service !== serviceFromUrl(draft.apiUrl) ? draft.service : serviceFromUrl(apiUrl),
                        resourceScope:
                          draft.resourceScope && draft.resourceScope !== `api:${slugFromUrl(draft.apiUrl)}`
                            ? draft.resourceScope
                            : `api:${nextId || "*"}`
                      });
                    }}
                  />
                </span>
              </label>
              <button className="primary-button submit-button" type="button" onClick={() => void startPublisherApiListing()}>
                <Plus size={17} />
                Add API
              </button>
            </div>

            <div className="publisher-start-note">
              Paste a URL first. We will infer the listing name, marketplace ID, and default paid scope before asking for payout details.
            </div>

            <div className="publisher-finish-flow" hidden={!publisherDetailsOpen}>
            <label className="openapi-field">
              OpenAPI URL optional
              <input
                aria-describedby="openapi-url-help"
                inputMode="url"
                value={draft.openApiUrl}
                placeholder="https://api.example.com/openapi.json"
                onChange={(event) => {
                  setDraft({ ...draft, openApiUrl: normalizeUrlInput(event.target.value) });
                  setPublisherPreview(undefined);
                }}
              />
              <small id="openapi-url-help">
                Paste a public JSON spec to preview endpoints and suggested resource scopes. It will not change pricing or publish
                anything automatically.
              </small>
            </label>

            <div className="publisher-preview-controls">
              <button className="ghost-button" type="button" onClick={() => void previewPublisherDraft()}>
                <Route size={14} />
                {publisherPreviewLoading ? "Previewing..." : "Preview endpoints"}
              </button>
              {publisherPreview?.conflicts.merchantApplicationExists || publisherPreview?.conflicts.merchantOrListingExists ? (
                <span className="publisher-preview-warning">
                  Existing draft/listing uses this id. Change the API slug before submitting.
                </span>
              ) : publisherPreview ? (
                <span className="publisher-preview-ok">Preview only — no token or application created.</span>
              ) : null}
            </div>

            {publisherPreview?.preview.openApi ? (
              <PublisherOpenApiPreviewCard
                openApi={publisherPreview.preview.openApi}
                selectedEndpoint={publisherPreview.preview.selectedOpenApiEndpoint}
                onSelectEndpoint={(endpoint) => {
                  setDraft({
                    ...draft,
                    openApiOperationId: endpoint.operationId ?? "",
                    openApiMethod: endpoint.operationId ? "" : (endpoint.method as MerchantDraft["openApiMethod"]),
                    openApiPath: endpoint.operationId ? "" : endpoint.path,
                    resourceScope: endpoint.suggestedResourceScope
                  });
                }}
              />
            ) : null}

            <div className="publisher-advanced">
              <div className="publisher-fields-header">
                <div>
                  <strong>Finish the listing</strong>
                  <span>Most publishers only need these four things: name, payout wallet, price, and contact.</span>
                </div>
              </div>

              <div className="publisher-fields">
                <label>
                  API name
                  <input
                    required={publisherDetailsOpen}
                    value={draft.service}
                    placeholder="Weather API"
                    onChange={(event) => setDraft({ ...draft, service: event.target.value })}
                  />
                  <small>The human-readable name buyers see in the marketplace.</small>
                </label>
                <label>
                  Publisher wallet
                  <input
                    required={publisherDetailsOpen}
                    value={draft.address}
                    placeholder="0x..."
                    onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                  />
                  <small>Your Sui address for payout and ownership proof.</small>
                </label>
                <label>
                  Price
                  <input required={publisherDetailsOpen} value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
                  <small>Amount charged per call or session, in the selected token's base units.</small>
                </label>
                <label>
                  Contact email
                  <input
                    type="email"
                    value={draft.applicantEmail}
                    placeholder="ops@example.com"
                    onChange={(event) => setDraft({ ...draft, applicantEmail: event.target.value })}
                  />
                  <small>Optional. Used for review/support, not shown as the payment identity.</small>
                </label>
              </div>

              <details className="publisher-developer-options">
                <summary>Developer options</summary>
                <p>
                  Leave these auto-filled unless you are wiring a specific OpenAPI operation, custom coin, or reusable paid session.
                </p>
                <div className="publisher-fields">
                  <label className="openapi-field">
                    OpenAPI operationId
                    <input
                      aria-describedby="openapi-operation-help"
                      value={draft.openApiOperationId}
                      placeholder="searchForecast"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          openApiOperationId: event.target.value.trim(),
                          openApiMethod: "",
                          openApiPath: ""
                        })
                      }
                    />
                    <small id="openapi-operation-help">
                      Optional. If this matches an imported operation, Sui402 will use that endpoint's suggested paid access scope.
                      {draft.openApiMethod && draft.openApiPath
                        ? ` Selected by method/path: ${draft.openApiMethod} ${draft.openApiPath}.`
                        : ""}
                    </small>
                  </label>
                <label>
                  Listing URL slug
                  <input
                    required={publisherDetailsOpen}
                    value={draft.id}
                    placeholder="weather-api"
                    onChange={(event) => setDraft({ ...draft, id: slugify(event.target.value) })}
                  />
                  <small>Stable slug for your listing URL and agent search results.</small>
                </label>
                <label>
                  Paid access scope
                  <input
                    required={publisherDetailsOpen}
                    value={draft.resourceScope}
                    onChange={(event) => setDraft({ ...draft, resourceScope: event.target.value })}
                  />
                  <small>Developer identifier for what the payment unlocks, for example <code>api:weather-api</code> or <code>api:weather/*</code>.</small>
                </label>
                <label>
                  Payment coin type
                  <input
                    value={draft.coinType}
                    onChange={(event) => setDraft({ ...draft, coinType: event.target.value })}
                  />
                  <small>Advanced Sui coin type buyers pay with. Default is native SUI.</small>
                </label>
                <label>
                  Session package ID
                  <input
                    value={draft.sessionPackageId}
                    onChange={(event) => setDraft({ ...draft, sessionPackageId: event.target.value })}
                  />
                  <small>Operator/developer setting for reusable paid sessions. One-shot API calls can keep the default.</small>
                </label>
                </div>
              </details>
              <div className="publisher-submit-row">
                <span>Ready when endpoint, payout wallet, and price look right.</span>
                <button className="primary-button submit-button" type="submit">
                  Submit listing for review
                </button>
              </div>
            </div>

            <div className="setup-prompt">
              <div>
                <strong>Set up Sui402 with a prompt</strong>
                <span>Copy this into your coding agent to add payment middleware to the publisher API.</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(setupPrompt)}
              >
                <Copy size={14} />
                Copy
              </button>
              <code>{setupPrompt}</code>
            </div>

            <div className="publisher-resume-card">
              <div>
                <strong>Resume an existing draft</strong>
                <span>
                  Paste the merchant application id and private publisher access token from your original create response. The token stays in
                  memory only.
                </span>
              </div>
              <div className="publisher-resume-fields">
                <input
                  aria-label="Merchant application id"
                  value={publisherResume.applicationId}
                  placeholder="mapp_..."
                  onChange={(event) => setPublisherResume({ ...publisherResume, applicationId: event.target.value.trim() })}
                />
                <input
                  aria-label="Private publisher access token"
                  type="password"
                  value={publisherResume.publisherAccessToken}
                  placeholder="sui402p_..."
                  onChange={(event) => setPublisherResume({ ...publisherResume, publisherAccessToken: event.target.value.trim() })}
                />
                <button className="ghost-button" type="button" onClick={() => void resumePublisherApi()}>
                  <KeyRound size={14} />
                  {publisherResumeLoading ? "Resuming..." : "Resume status"}
                </button>
              </div>
              <small>Do not paste the public .well-known verification token here; status/probe routes reject it.</small>
            </div>

            {submittedApplication?.verification ? (
              <div className="verification-card">
                <div>
                  <strong>Prove API ownership</strong>
                  <span>
                    Publish this JSON at {submittedNextSteps?.verificationUrl ?? submittedApplication.verification.verificationUrl}, or use the
                    DNS TXT fallback, then check proof before operator review.
                  </span>
                  {submittedNextSteps?.dnsTxtName && submittedNextSteps.dnsTxtValue ? (
                    <span>
                      DNS TXT: <code>{submittedNextSteps.dnsTxtName}</code>
                    </span>
                  ) : null}
                  {submittedPreview ? (
                    <span>
                      Gateway preview: <code>{submittedPreview.protectedResourcePath}</code>
                    </span>
                  ) : null}
                </div>
                {publisherWalletProofMessage ? (
                  <div className={`publisher-wallet-proof${submittedApplication.walletProof ? " verified" : ""}`}>
                    <div>
                      <strong>Payout wallet proof</strong>
                      <span>
                        {submittedApplication.walletProof
                          ? `Verified ${submittedApplication.walletProof.address} at ${formatTimestamp(submittedApplication.walletProof.verifiedAt)}.`
                          : "Sign this exact personal message with the payout wallet, then paste the signature. This proves wallet control; it does not replace API ownership proof."}
                      </span>
                    </div>
                    <code>{publisherWalletProofMessage}</code>
                    <div className="publisher-wallet-proof-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(publisherWalletProofMessage)}
                      >
                        <Copy size={14} />
                        Copy message
                      </button>
                      <input
                        aria-label="Sui personal-message signature"
                        value={publisherWalletSignature}
                        placeholder="Paste Sui personal-message signature"
                        onChange={(event) => setPublisherWalletSignature(event.target.value.trim())}
                      />
                      <button className="ghost-button" type="button" onClick={() => void submitPublisherWalletProofForDraft()}>
                        <ShieldCheck size={14} />
                        {publisherWalletProofLoading ? "Verifying..." : "Submit wallet proof"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {submittedPreview?.openApi ? (
                  <PublisherOpenApiPreviewCard
                    openApi={submittedPreview.openApi}
                    selectedEndpoint={submittedPreview.selectedOpenApiEndpoint}
                  />
                ) : null}
                {submittedPreview?.reviewDraft ? <PublisherReviewDraftCard reviewDraft={submittedPreview.reviewDraft} /> : null}
                <div className="publisher-session-card">
                  <div>
                    <strong>Publisher session</strong>
                    <span>
                      Use a short-lived Bearer session for status/probe calls instead of sending the long-lived publisher access token
                      from the browser.
                    </span>
                    {publisherSession ? (
                      <small>
                        Active until {formatTimestamp(publisherSession.expiresAt)}. Rotating the publisher access token invalidates this
                        session.
                      </small>
                    ) : (
                      <small>Create a session after saving the draft, then use the session-authenticated commands below.</small>
                    )}
                  </div>
                  <button className="ghost-button" type="button" onClick={() => void ensurePublisherSession()}>
                    <KeyRound size={14} />
                    {publisherSessionLoading ? "Creating..." : publisherSession ? "Refresh session" : "Create session"}
                  </button>
                  {publisherSession ? (
                    <div className="publisher-session-commands">
                      <ScanCodeRow label="status with session" value={publisherSession.commands.status} />
                      <ScanCodeRow label="probe with session" value={publisherSession.commands.probe} />
                    </div>
                  ) : null}
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(buildVerificationDocument(submittedApplication, submittedNextSteps))}
                >
                  <Copy size={14} />
                  Copy JSON
                </button>
                <button className="ghost-button" type="button" onClick={() => void verifyApplication(submittedApplication.id)}>
                  <ShieldCheck size={14} />
                  Check proof
                </button>
                {submittedNextSteps?.dnsTxtName && submittedNextSteps.dnsTxtValue ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() =>
                      void navigator.clipboard?.writeText(`${submittedNextSteps.dnsTxtName} TXT ${submittedNextSteps.dnsTxtValue}`)
                    }
                  >
                    <Copy size={14} />
                    Copy DNS TXT
                  </button>
                ) : null}
                <button className="ghost-button" type="button" onClick={() => void probeSubmittedPublisherApi()}>
                  <Radar size={14} />
                  {publisherProbeLoading ? "Probing..." : "Probe readiness"}
                </button>
                <code>{buildVerificationDocument(submittedApplication, submittedNextSteps)}</code>
                {submittedNextSteps?.steps.length ? (
                  <div className="next-steps-list">
                    {submittedNextSteps.steps.map((step) => (
                      <span key={step}>{step}</span>
                    ))}
                  </div>
                ) : null}
                {submittedNextSteps ? <PublisherWorkflow nextSteps={submittedNextSteps} /> : null}
                {publisherProbe ? <PublisherProbeSummary probe={publisherProbe} /> : null}
              </div>
            ) : null}
            </div>
          </form>

          <div className="onboarding-note">
            <span>After approval, paid gateway calls proxy to this upstream URL with Sui402 verification headers.</span>
          </div>
        </section>

        <section className="panel onboarding-panel operator-panel page-section" hidden={activePage !== "operator"} style={{ position: "relative" }}>
          <CornerMarks />
          <div className="panel-header">
            <div>
              <h2>Operator quick publish</h2>
              <p>Create a gateway merchant directly when you have console operator credentials.</p>
            </div>
          </div>

          <form
            className="merchant-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createConsoleMerchant({
                id: draft.id || slugFromUrl(draft.apiUrl) || "publisher-api",
                service: draft.service || serviceFromUrl(draft.apiUrl) || "Publisher API",
                merchant: draft.address,
                network: environment === "Mainnet" ? "sui:mainnet" : "sui:testnet",
                coinType: draft.coinType,
                price: draft.price,
                resourceScope: draft.resourceScope || `api:${draft.id || "*"}`,
                upstreamUrl: draft.apiUrl || undefined,
                upstreamTimeoutMs: 15000,
                sessionPackageId: draft.sessionPackageId || undefined,
                transport: draft.resourceScope.startsWith("mcp:") ? "mcp" : "http"
              })
                .then(() => refreshOverview())
                .then(() => setPublished(true))
                .catch((error: unknown) => {
                  setApiState((current) => ({
                    ...current,
                    error: error instanceof Error ? error.message : "Merchant publish failed"
                  }));
                });
            }}
          >
            <label>
              Merchant id
              <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: slugify(event.target.value) })} />
            </label>
            <label>
              Merchant address
              <input
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.target.value })}
              />
            </label>
            <label>
              Resource scope
              <input
                value={draft.resourceScope}
                onChange={(event) => setDraft({ ...draft, resourceScope: event.target.value })}
              />
            </label>
            <label className="wide-field">
              Session package id
              <input
                value={draft.sessionPackageId}
                onChange={(event) => setDraft({ ...draft, sessionPackageId: event.target.value })}
              />
            </label>
            <button className="primary-button submit-button" type="submit">
              Publish directly
            </button>
          </form>
        </section>

        {/* Footer */}
        <div className="powered-by">
          <span>Powered by</span>
          <span className="sui-badge">
            <Zap size={12} />
            Sui
          </span>
        </div>
      </main>
    </div>
  );
}

export function MarketplaceApiDetailPanel({
  row,
  detail,
  loading,
  error,
  shareUrl,
  onClose,
  onScan
}: {
  row: MarketplaceRow;
  detail?: MarketplaceApiDetailResponse;
  loading: boolean;
  error?: string;
  shareUrl: string;
  onClose: () => void;
  onScan: (merchantId: string) => void;
}) {
  const api = detail?.api;
  const command = detail?.commands.curl ?? (row.endpoint ? `sui402-pay curl ${row.endpoint}` : `sui402-pay search ${row.name}`);
  const searchCommand = detail?.commands.search ?? `sui402-pay search ${row.name}`;
  const scanCommand = detail?.commands.scan ?? `sui402-pay scan merchant ${row.id}`;
  const paymentPlan = detail?.paymentPlan ?? api?.paymentPlan;
  const merchantAddress = detail?.merchant?.merchant ?? api?.merchant ?? row.merchantAddress;
  const price = api?.price ?? row.price;
  const coinType = api?.coinType ?? row.coinType;
  const network = api?.network ?? row.network;
  const resourceScope = api?.resourceScope ?? row.resourceScope;
  const status = api?.status ?? row.status;
  const stats = detail?.stats ?? api?.stats;
  const reliability = detail?.reliability ?? api?.reliability;
  const trust = detail?.trust;
  const readiness = detail?.readiness ?? api?.readiness ?? row.readiness;

  return (
    <article className="marketplace-detail-panel" aria-label={`Marketplace details for ${row.name}`}>
      <div className="marketplace-detail-header">
        <div>
          <span className="eyebrow">API detail</span>
          <h3>{api?.name ?? row.name}</h3>
          <p>{api?.description ?? row.description}</p>
        </div>
        <div className="marketplace-detail-actions">
          <span className={`status ${status === "paused" ? "review" : status === "observed" ? "session" : "verified"}`}>{status}</span>
          <button className="ghost-button" type="button" onClick={() => void navigator.clipboard?.writeText(shareUrl)}>
            <Copy size={13} />
            Copy link
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {loading ? <div className="marketplace-alert">Loading live marketplace detail...</div> : null}
      {error ? (
        <div className="marketplace-alert">
          <strong>Live detail failed</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="marketplace-detail-grid">
        <ScanFact label="price" value={formatPrice(price, coinType)} />
        <ScanFact label="network" value={formatNetwork(network)} />
        <ScanFact label="transport" value={api?.transport ?? row.transport} />
        <ScanFact label="resource" value={resourceScope} />
        <ScanFact label="merchant" value={shortValue(merchantAddress)} />
        <ScanFact label="payments" value={(stats?.verifiedPayments ?? row.paymentCount).toLocaleString()} />
        <ScanFact label="sessions" value={(stats?.sessionPayments ?? 0).toLocaleString()} />
        <ScanFact label="volume" value={stats?.volume ?? "0"} />
      </div>

      {reliability ? (
        <div className="marketplace-detail-readiness">
          <div>
            <strong>{reliability.paidTestObserved ? "Verified paid evidence observed" : "No paid evidence yet"}</strong>
            <span>
              {reliability.lastVerifiedPaymentAt
                ? `Last verified payment: ${reliability.lastVerifiedPaymentAt}`
                : "Agents should wait for an indexed paid test before autonomous calls."}
            </span>
          </div>
          <div className="marketplace-readiness-checks">
            <span className={reliability.paidTestObserved ? "ok" : "warn"}>paid test observed</span>
            <span className={reliability.sessionPayments > 0 ? "ok" : "warn"}>{reliability.sessionPayments.toLocaleString()} session payments</span>
            <span className={reliability.recentIndexedPayments > 0 ? "ok" : "warn"}>
              {reliability.recentIndexedPayments.toLocaleString()} public evidence records
            </span>
          </div>
        </div>
      ) : null}

      <div className="marketplace-detail-trust">
        {[
          ["listing published", trust?.listingPublished ?? row.status === "active"],
          ["merchant indexed", trust?.merchantPublished ?? Boolean(detail?.merchant)],
          ["upstream configured", trust?.upstreamConfigured ?? Boolean(row.endpoint)],
          ["sessions enabled", trust?.sessionsEnabled ?? row.sessionSupported]
        ].map(([label, ok]) => (
          <span key={String(label)} className={ok ? "ok" : "warn"}>
            {ok ? "✓" : "!"} {label}
          </span>
        ))}
      </div>

      {readiness ? (
        <div className="marketplace-detail-readiness">
          <div>
            <strong>{readiness.ready ? "Ready for agent calls" : "Needs review before promotion"}</strong>
            <span>{readiness.ready ? "All marketplace readiness checks passed." : readiness.reasons.join("; ")}</span>
          </div>
          <div className="marketplace-readiness-checks">
            {readiness.checks.map((check) => (
              <span key={check.name} className={check.ok ? "ok" : "warn"}>
                {check.name.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="scan-subsection">
        <strong>Agent commands</strong>
        <ScanCodeRow label="call" value={command} />
        <ScanCodeRow label="search" value={searchCommand} />
        <ScanCodeRow label="scan" value={scanCommand} />
        {detail?.commands.sessionOnly ? <ScanCodeRow label="session-only" value={detail.commands.sessionOnly} /> : null}
        {detail?.commands.sessionInspect ? <ScanCodeRow label="session inspect" value={detail.commands.sessionInspect} /> : null}
      </div>

      {paymentPlan ? (
        <div className="marketplace-payment-plan">
          <strong>Agent payment plan</strong>
          <div>
            <ScanFact label="custody" value={paymentPlan.custody.replace(/_/g, " ")} />
            <ScanFact label="authorization mode" value={paymentPlan.authorizationMode.replace(/_/g, " ")} />
            <ScanFact label="network" value={formatNetwork(paymentPlan.network)} />
            <ScanFact label="max one-shot" value={paymentPlan.maxOneShotAmount} />
            <ScanFact label="session behavior" value={paymentPlan.sessionBehavior.replace(/_/g, " ")} />
            <ScanFact label="resource hash" value={shortValue(paymentPlan.resourceScopeHash)} />
          </div>
          {paymentPlan.notes.length > 0 ? <span>{paymentPlan.notes[0]}</span> : null}
        </div>
      ) : null}

      {row.endpoint || detail?.links.protectedResourceUrl ? <ScanCodeRow label="protected URL" value={detail?.links.protectedResourceUrl ?? row.endpoint!} /> : null}
      {detail?.links.sessionManagerUrl ? <ScanCodeRow label="session manager" value={detail.links.sessionManagerUrl} /> : null}

      <div className="marketplace-detail-footer">
        <div className="tag-row">
          {(api?.tags ?? row.tags).slice(0, 5).map((tag) => (
            <span key={`${row.id}-detail-${tag}`}>{tag}</span>
          ))}
        </div>
        <button className="ghost-button" type="button" onClick={() => onScan(api?.id ?? row.id)}>
          Inspect scan record
        </button>
      </div>

      {detail ? (
        <div className="scan-subsection">
          <strong>Recent indexed payments</strong>
          {detail.recentPayments.length === 0 ? (
            <span className="scan-muted">No indexed payments for this API yet.</span>
          ) : (
            <div className="scan-mini-list">
              {detail.recentPayments.slice(0, 5).map((payment) => (
                <button type="button" key={payment.digest} onClick={() => void navigator.clipboard?.writeText(payment.digest)}>
                  <span>{payment.kind}</span>
                  <code>{shortValue(payment.digest)}</code>
                  <strong>{formatPrice(payment.amount, payment.coinType)}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function ScanResultCard({ result }: { result: ScanLookupResult }) {
  const shareUrl = shareUrlForPath(formatDashboardPath({ scanKind: result.kind, scanId: result.id }));

  if (result.kind === "payment") {
    const record = result.record as ScanPaymentRecord;
    return (
      <article className="scan-result-card">
        <div className="scan-result-heading">
          <div>
            <span className="eyebrow">Payment proof</span>
            <h3>{shortValue(record.digest)}</h3>
          </div>
          <span className={`status ${record.kind === "session" ? "session" : "verified"}`}>{record.kind}</span>
        </div>
        <div className="scan-fact-grid">
          <ScanFact label="amount" value={formatPrice(record.amount, record.coinType)} />
          <ScanFact label="network" value={formatNetwork(record.network)} />
          <ScanFact label="merchant" value={record.merchantId ?? shortValue(record.recipient)} />
          <ScanFact label="access" value={record.resource} />
          <ScanFact label="challenge" value={shortValue(record.challengeId)} />
          <ScanFact label="created" value={formatTimestamp(record.createdAt)} />
        </div>
        <ScanCodeRow label="share link" value={shareUrl} />
        <ScanCodeRow label="digest" value={record.digest} />
        {record.sessionId ? <ScanCodeRow label="session" value={record.sessionId} /> : null}
        {record.receipt ? (
          <div className="scan-subsection">
            <strong>Receipt</strong>
            <div className="scan-fact-grid compact">
              <ScanFact label="id" value={shortValue(record.receipt.id)} />
              <ScanFact label="sequence" value={record.receipt.sequence} />
              <ScanFact label="expires" value={formatTimestamp(record.receipt.expiresAt)} />
            </div>
            <details className="scan-technical-fields">
              <summary>Technical receipt fields</summary>
              <div className="scan-fact-grid compact">
                <ScanFact label="receipt signer" value={shortValue(record.receipt.signer)} />
              </div>
            </details>
          </div>
        ) : null}
      </article>
    );
  }

  if (result.kind === "merchant") {
    const record = result.record as ScanMerchantRecord;
    const merchant = record.merchant;
    return (
      <article className="scan-result-card">
        <div className="scan-result-heading">
          <div>
            <span className="eyebrow">Merchant / listing</span>
            <h3>{merchant?.service ?? record.listing?.name ?? result.id}</h3>
          </div>
          <span className={`status ${merchant?.status === "paused" ? "review" : "verified"}`}>{merchant?.status ?? "listed"}</span>
        </div>
        <div className="scan-fact-grid">
          <ScanFact label="merchant id" value={merchant?.id ?? record.listing?.id ?? result.id} />
          <ScanFact label="wallet" value={shortValue(merchant?.merchant ?? record.listing?.merchant ?? "unknown")} />
          <ScanFact label="network" value={formatNetwork(merchant?.network ?? record.listing?.network ?? "unknown")} />
          <ScanFact label="price" value={formatPrice(merchant?.price ?? record.listing?.price ?? "0", merchant?.coinType ?? record.listing?.coinType ?? "")} />
          <ScanFact label="resource" value={merchant?.resourceScope ?? record.listing?.resourceScope ?? "unknown"} />
          <ScanFact label="verified payments" value={record.stats.verifiedPayments.toLocaleString()} />
          <ScanFact label="session payments" value={record.stats.sessionPayments.toLocaleString()} />
          <ScanFact label="volume" value={record.stats.volume} />
        </div>
        {record.listing?.protectedResourceUrl ? <ScanCodeRow label="protected URL" value={record.listing.protectedResourceUrl} /> : null}
        <ScanCodeRow label="share link" value={shareUrl} />
        <div className="scan-subsection">
          <strong>Recent payments</strong>
          {record.recentPayments.length === 0 ? (
            <span className="scan-muted">No indexed payments for this merchant yet.</span>
          ) : (
            <div className="scan-mini-list">
              {record.recentPayments.slice(0, 5).map((payment) => (
                <button
                  type="button"
                  key={payment.digest}
                  onClick={() => void navigator.clipboard?.writeText(payment.digest)}
                >
                  <span>{payment.kind}</span>
                  <code>{shortValue(payment.digest)}</code>
                  <strong>{formatPrice(payment.amount, payment.coinType)}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  if (result.kind === "session") {
    const record = result.record as ScanSessionRecord;
    return (
      <article className="scan-result-card">
        <div className="scan-result-heading">
          <div>
            <span className="eyebrow">Payment session</span>
            <h3>{shortValue(record.sessionId)}</h3>
          </div>
          <span className="status session">{record.spendCount.toLocaleString()} spends</span>
        </div>
        <div className="scan-fact-grid">
          <ScanFact label="spent" value={formatPrice(record.spentAmount, record.coinType ?? "")} />
          <ScanFact label="network" value={formatNetwork(record.network ?? "unknown")} />
          <ScanFact
            label={record.payerHash ? "payer hash" : "payer"}
            value={record.payerHash ? shortValue(record.payerHash) : record.payer ? shortValue(record.payer) : "redacted"}
          />
          <ScanFact label="merchant" value={shortValue(record.merchant ?? "unknown")} />
          <ScanFact label="first seen" value={formatTimestamp(record.firstSeenAt)} />
          <ScanFact label="last seen" value={formatTimestamp(record.lastSeenAt)} />
        </div>
        <ScanCodeRow label="share link" value={shareUrl} />
        <ScanCodeRow label="session id" value={record.sessionId} />
        {record.lastTxDigest ? <ScanCodeRow label="last tx digest" value={record.lastTxDigest} /> : null}
        <div className="scan-subsection">
          <strong>Recent spends</strong>
          <div className="scan-mini-list">
            {record.spends.slice(0, 5).map((spend) => (
              <button type="button" key={spend.id} onClick={() => void navigator.clipboard?.writeText(spend.txDigest)}>
                <span>{formatTimestamp(spend.indexedAt)}</span>
                <code>{shortValue(spend.txDigest)}</code>
                <strong>{spend.amount}</strong>
              </button>
            ))}
          </div>
        </div>
      </article>
    );
  }

  const record = result.record as ScanSettlementRecord;
  return (
    <article className="scan-result-card">
      <div className="scan-result-heading">
        <div>
          <span className="eyebrow">Settlement event</span>
          <h3>{shortValue(record.txDigest)}</h3>
        </div>
        <span className="status verified">{record.kind}</span>
      </div>
      <div className="scan-fact-grid">
        <ScanFact label="amount" value={formatPrice(record.amount, record.coinType)} />
        <ScanFact label="network" value={formatNetwork(record.network)} />
        <ScanFact label="merchant" value={shortValue(record.merchant ?? "unknown")} />
        <ScanFact label="submitter" value={shortValue(record.submitter ?? record.sender ?? "unknown")} />
        <ScanFact label="receipt" value={shortValue(record.receiptId ?? "unknown")} />
        <ScanFact label="indexed" value={formatTimestamp(record.indexedAt)} />
    </div>
      <ScanCodeRow label="share link" value={shareUrl} />
      <ScanCodeRow label="tx digest" value={record.txDigest} />
      {record.ledgerId ? <ScanCodeRow label="ledger id" value={record.ledgerId} /> : null}
      {record.resourceScopeHash ? <ScanCodeRow label="resource hash" value={record.resourceScopeHash} /> : null}
    </article>
  );
}

function ScanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="scan-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScanCodeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="scan-code-row">
      <span>{label}</span>
      <code>{value}</code>
      <button className="ghost-button" type="button" onClick={() => void navigator.clipboard?.writeText(value)}>
        <Copy size={13} />
        Copy
      </button>
    </div>
  );
}

function PublisherOpenApiPreviewCard({
  openApi,
  selectedEndpoint,
  onSelectEndpoint
}: {
  openApi: NonNullable<PublisherApiDraftPreview["openApi"]>;
  selectedEndpoint?: PublisherApiDraftPreview["selectedOpenApiEndpoint"];
  onSelectEndpoint?: (endpoint: NonNullable<PublisherApiDraftPreview["openApi"]>["suggestedEndpoints"][number]) => void;
}) {
  return (
    <div className="publisher-openapi-preview">
      <div>
        <span>OpenAPI import</span>
        <strong>
          {openApi.title ?? "Imported API"} {openApi.version ? `v${openApi.version}` : ""}
        </strong>
        <small>
          {openApi.endpointCount.toLocaleString()} endpoints found
          {openApi.sourceUrl ? ` from ${openApi.sourceUrl}` : ""}
        </small>
      </div>
      {selectedEndpoint ? (
        <div className="publisher-openapi-selected">
          <small>Selected paid operation</small>
          <span>{selectedEndpoint.method}</span>
          <strong>{selectedEndpoint.path}</strong>
          <code>{selectedEndpoint.suggestedResourceScope}</code>
        </div>
      ) : null}
      {openApi.suggestedEndpoints.length > 0 ? (
        <div className="publisher-openapi-endpoints" aria-label="Suggested OpenAPI resource scopes">
          <small>Suggested scopes to review. Copy one into Resource scope if it matches the paid route you want to launch.</small>
          {openApi.suggestedEndpoints.slice(0, 4).map((endpoint) => (
            <div key={`${endpoint.method}:${endpoint.path}`}>
              <span>{endpoint.method}</span>
              <strong>{endpoint.path}</strong>
              <code>{endpoint.suggestedResourceScope}</code>
              <button
                aria-label={`Copy resource scope for ${endpoint.method} ${endpoint.path}`}
                className="ghost-button publisher-openapi-copy"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(endpoint.suggestedResourceScope)}
              >
                <Copy size={13} />
                Copy scope
              </button>
              {onSelectEndpoint ? (
                <button
                  aria-label={`Use OpenAPI endpoint ${endpoint.method} ${endpoint.path}`}
                  className="ghost-button publisher-openapi-copy"
                  type="button"
                  onClick={() => onSelectEndpoint(endpoint)}
                >
                  <Check size={13} />
                  Use endpoint
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <small>No operation paths were found in this OpenAPI document.</small>
      )}
    </div>
  );
}

function PublisherReviewDraftCard({
  reviewDraft,
  compact = false
}: {
  reviewDraft: NonNullable<PublisherApiDraftPreview["reviewDraft"]>;
  compact?: boolean;
}) {
  return (
    <div className={`publisher-review-draft${compact ? " compact" : ""}`}>
      <div>
        <span>Review draft</span>
        <strong>Gateway + marketplace candidate</strong>
        {compact ? null : (
          <small>This is not published yet. Operators still need to clear every gate before agents should trust it as ready.</small>
        )}
      </div>
      <div className="publisher-review-draft-grid">
        <div>
          <span>Gateway merchant</span>
          <strong>{reviewDraft.gatewayMerchant.id ?? "pending"}</strong>
          <small>{reviewDraft.gatewayMerchant.upstreamUrl ?? "No upstream URL"}</small>
          <code>{reviewDraft.gatewayMerchant.resourceScope ?? "No resource scope"}</code>
        </div>
        <div>
          <span>Marketplace listing</span>
          <strong>{reviewDraft.registryListing.name ?? reviewDraft.registryListing.id ?? "pending"}</strong>
          <small>{reviewDraft.registryListing.protectedResourceUrl ?? "No protected resource URL"}</small>
          <code>
            {reviewDraft.registryListing.price ?? "0"} {shortCoinType(reviewDraft.registryListing.coinType ?? "")}
          </code>
        </div>
      </div>
      <div className="publisher-review-gates">
        {reviewDraft.gates.map((gate) => (
          <div key={gate.id} className={gate.passed ? "passed" : "pending"}>
            <span>{gate.passed ? <Check size={13} /> : "!"}</span>
            <div>
              <strong>{gate.label}</strong>
              <small>{gate.description}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublisherWorkflow({ nextSteps }: { nextSteps: MerchantApplicationNextSteps }) {
  const phaseLabels: Array<{ id: MerchantApplicationNextSteps["phase"]; label: string }> = [
    { id: "submitted", label: "Submitted" },
    { id: "verify_ownership", label: "Verify" },
    { id: "operator_review", label: "Review" },
    { id: "published", label: "Published" }
  ];
  const activeIndex = Math.max(
    0,
    phaseLabels.findIndex((phase) => phase.id === nextSteps.phase)
  );

  return (
    <div className="publisher-workflow">
      <div className="publisher-workflow-heading">
        <div>
          <strong>Launch workflow</strong>
          <span>
            {nextSteps.readyForReview
              ? "Ownership proof is verified. Operator review can publish or reject this API."
              : nextSteps.phase === "verify_ownership"
                ? "Publisher-owned steps are still required before review."
                : "Track what is self-serve and what is operator-gated."}
          </span>
        </div>
        <span className={`status ${nextSteps.readyForReview || nextSteps.phase === "published" ? "verified" : "review"}`}>
          {nextSteps.readyForReview ? "ready for review" : nextSteps.phase.replace(/_/g, " ")}
        </span>
      </div>

      <div className="publisher-phase-strip" aria-label="Publisher launch phases">
        {phaseLabels.map((phase, index) => (
          <div
            className={index < activeIndex ? "done" : index === activeIndex ? "active" : undefined}
            key={phase.id}
          >
            <span>{index + 1}</span>
            <strong>{phase.label}</strong>
          </div>
        ))}
      </div>

      <div className="publisher-action-grid">
        <PublisherActionList title="Publisher can do" empty="No publisher action right now." actions={nextSteps.selfServeActions} />
        <PublisherActionList title="Operator gate" empty="No operator action yet." actions={nextSteps.operatorActions} />
      </div>
    </div>
  );
}

function PublisherActionList({
  title,
  empty,
  actions
}: {
  title: string;
  empty: string;
  actions: Array<{ id: string; label: string; description: string; command?: string }>;
}) {
  return (
    <div className="publisher-action-list">
      <strong>{title}</strong>
      {actions.length === 0 ? (
        <span className="publisher-action-empty">{empty}</span>
      ) : (
        actions.map((action) => (
          <div className="publisher-action" key={action.id}>
            <span>{action.label}</span>
            <p>{action.description}</p>
            {action.command ? <code>{action.command}</code> : null}
          </div>
        ))
      )}
    </div>
  );
}

export function PublisherProbeSummary({ probe }: { probe: PublisherApiProbeResponse }) {
  return (
    <div className={`publisher-probe ${probe.ready ? "ready" : "pending"}`}>
      <div className="publisher-probe-heading">
        <div>
          <strong>{probe.ready ? "Ready for unpaid challenge" : "Readiness checks pending"}</strong>
          <span>{probe.merchantId}</span>
          {probe.publisherAuth ? (
            <small>
              Authenticated with{" "}
              {probe.publisherAuth.kind === "publisher_session"
                ? `short-lived publisher session ${probe.publisherAuth.sessionId}`
                : "publisher access token compatibility path"}
            </small>
          ) : null}
        </div>
        <span className={`status ${probe.ready ? "verified" : "review"}`}>{probe.ready ? "ready" : "pending"}</span>
      </div>
      <div className="publisher-probe-checks">
        {probe.checks.map((check) => (
          <div key={check.name} className={check.ok ? "ok" : "warn"}>
            <span>{check.name.replace(/_/g, " ")}</span>
            <strong>{check.ok ? "pass" : "needs work"}</strong>
            <small>{check.message}</small>
          </div>
        ))}
      </div>
      {probe.unpaidProbe ? (
        <div className="publisher-probe-callout">
          <span>Expected unpaid response</span>
          <strong>HTTP {probe.unpaidProbe.expectedStatus}</strong>
          <code>{probe.unpaidProbe.protectedResourceUrl}</code>
        </div>
      ) : null}
      {probe.paidProbe ? (
        <div className={`publisher-paid-evidence ${probe.paidProbe.evidence?.observed ? "ready" : "missing"}`}>
          <div>
            <span>Paid test evidence</span>
            <strong>{probe.paidProbe.evidence?.observed ? "verified payment observed" : "missing before public launch"}</strong>
            <small>{probe.paidProbe.reason}</small>
          </div>
          {probe.paidProbe.evidence ? (
            <div className="publisher-paid-evidence-stats">
              <span>{probe.paidProbe.evidence.verifiedPayments.toLocaleString()} verified</span>
              <span>{probe.paidProbe.evidence.sessionPayments.toLocaleString()} session</span>
              <span>{probe.paidProbe.evidence.volume} volume</span>
            </div>
          ) : null}
          {probe.paidProbe.nextAction ? (
            <div className="publisher-paid-action">
              <span>{probe.paidProbe.nextAction.label}</span>
              <code>{probe.paidProbe.nextAction.command}</code>
              {probe.paidProbe.nextAction.note ? <small>{probe.paidProbe.nextAction.note}</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {probe.paidTestWizard ? (
        <div className="publisher-paid-wizard">
          <div className="publisher-paid-wizard-heading">
            <div>
              <span>Paid-test wizard</span>
              <strong>{probe.paidTestWizard.title}</strong>
              <small>{probe.paidTestWizard.summary}</small>
            </div>
            <span className={`status ${probe.paidTestWizard.readyForPublicLaunch ? "verified" : "review"}`}>
              {probe.paidTestWizard.currentGate.replace(/_/g, " ")}
            </span>
          </div>
          <div className="publisher-paid-wizard-steps">
            {probe.paidTestWizard.steps.map((step, index) => (
              <div key={step.id} className={step.status}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                  {step.command ? <code>{step.command}</code> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="publisher-paid-wizard-commands">
            <ScanCodeRow label="check status" value={probe.paidTestWizard.commands.checkStatus} />
            <ScanCodeRow label="rerun probe" value={probe.paidTestWizard.commands.rerunProbe} />
            {probe.paidTestWizard.commands.unpaidChallenge ? (
              <ScanCodeRow label="unpaid 402" value={probe.paidTestWizard.commands.unpaidChallenge} />
            ) : null}
            {probe.paidTestWizard.commands.paidCall ? (
              <ScanCodeRow label="paid call" value={probe.paidTestWizard.commands.paidCall} />
            ) : null}
          </div>
          <div className="publisher-paid-wizard-safety">
            {probe.paidTestWizard.safety.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function inferScanLookupKinds(id: string, merchants: GatewayMerchant[], listings: ServiceListing[]): ScanLookupKind[] {
  if (merchants.some((merchant) => merchant.id === id) || listings.some((listing) => listing.id === id)) {
    return ["merchant", "payment", "session", "settlement"];
  }

  const normalized = id.toLowerCase();
  if (normalized.includes("settlement") || normalized.includes("ledger")) {
    return ["settlement", "payment", "session", "merchant"];
  }
  if (normalized.startsWith("0x") && normalized.length >= 40) {
    return ["session", "payment", "settlement", "merchant"];
  }

  return ["payment", "merchant", "settlement", "session"];
}

function buildMarketplaceRows(
  listings: ServiceListing[],
  merchants: GatewayMerchant[],
  payments: PaymentRow[]
): MarketplaceRow[] {
  const paymentsByMerchant = countPaymentsByMerchant(payments);
  const merchantsById = new Map(merchants.map((merchant) => [merchant.id, merchant]));

  if (listings.length > 0) {
    return listings.map((listing) => {
      const merchant = merchantsById.get(listing.id);
      return {
        id: listing.id,
        name: listing.name,
        description: listing.description ?? describeResource(listing.resourceScope, listing.transport),
        network: listing.network,
        transport: listing.transport,
        price: listing.price,
        coinType: listing.coinType,
        resourceScope: listing.resourceScope,
        status: listing.status,
        merchantAddress: listing.merchant,
        endpoint: listing.protectedResourceUrl ?? listing.mcpServerUrl ?? merchant?.upstreamUrl,
        tags: listing.tags,
        sessionSupported: listing.sessionSupported,
        paymentCount: paymentsByMerchant.get(listing.id) ?? 0,
        readiness: undefined,
        updatedAt: listing.updatedAt
      };
    });
  }

  if (merchants.length > 0) {
    return merchants.map((merchant) => ({
      id: merchant.id,
      name: merchant.service,
      description: describeResource(merchant.resourceScope, merchant.resourceScope.startsWith("mcp:") ? "mcp" : "http"),
      network: merchant.network,
      transport: merchant.resourceScope.startsWith("mcp:") ? "mcp" : "http",
      price: merchant.price,
      coinType: merchant.coinType,
      resourceScope: merchant.resourceScope,
      status: merchant.status,
      merchantAddress: merchant.merchant,
      endpoint: merchant.upstreamUrl,
      tags: merchant.resourceScope.startsWith("mcp:") ? ["mcp", "tools"] : ["api", "data"],
      sessionSupported: Boolean(merchant.sessionPackageId),
      paymentCount: paymentsByMerchant.get(merchant.id) ?? 0,
      readiness: undefined
    }));
  }

  return [...new Map(payments.map((payment) => [payment.merchant, payment])).values()].map((payment) => ({
    id: payment.merchant,
    name: titleize(payment.merchant),
    description: describeResource(payment.resource, payment.resource.startsWith("mcp:") ? "mcp" : "http"),
    network: payment.network,
    transport: payment.resource.startsWith("mcp:") ? "mcp" : "http",
    price: payment.amount.replace(/[^\d]/g, "") || "0",
    coinType: payment.amount.toLowerCase().includes("sui") || payment.amount.toLowerCase().includes("mist") ? "0x2::sui::SUI" : "coin",
    resourceScope: payment.resource,
    status: "observed",
    merchantAddress: "observed from payment ledger",
    tags: payment.resource.startsWith("mcp:") ? ["mcp", "observed"] : ["api", "observed"],
    sessionSupported: payment.status === "session",
    paymentCount: paymentsByMerchant.get(payment.merchant) ?? 1,
    readiness: undefined
  }));
}

function marketplaceApiToRow(api: MarketplaceApi): MarketplaceRow {
  return {
    id: api.id,
    name: api.name,
    description: api.description ?? describeResource(api.resourceScope, api.transport),
    network: api.network,
    transport: api.transport,
    price: api.price,
    coinType: api.coinType,
    resourceScope: api.resourceScope,
    status: api.status,
    merchantAddress: api.merchant,
    endpoint: api.protectedResourceUrl,
    tags: api.tags ?? [],
    sessionSupported: api.sessionSupported,
    paymentCount: api.stats?.verifiedPayments ?? 0,
    updatedAt: api.updatedAt,
    readiness: api.readiness
  };
}

function readinessLabel(readiness: MarketplaceReadiness): string {
  if (readiness.ready) {
    return "Ready for agents";
  }

  return readiness.level === "paused" ? "Paused" : "Needs review";
}

function marketplaceCommandForRow(row: MarketplaceRow): string {
  if (row.transport === "mcp" || row.resourceScope.startsWith("mcp:")) {
    return row.endpoint
      ? `sui402-pay mcp call ${row.endpoint} --scope ${row.resourceScope} --max-session-amount ${row.price}`
      : `sui402-pay marketplace detail ${row.id}`;
  }

  if (!row.endpoint) {
    return `sui402-pay marketplace detail ${row.id}`;
  }

  return `sui402-pay curl ${row.endpoint} --max-one-shot-amount ${row.price}`;
}

function shortCoinType(coinType: string): string {
  return coinType.split("::").at(-1) ?? coinType;
}

function buildMarketplaceStats(rows: MarketplaceRow[], payments: PaymentRow[]) {
  const verifiedPayments =
    payments.length > 0
      ? payments.filter((payment) => payment.status === "verified" || payment.status === "session").length
      : rows.reduce((total, row) => total + row.paymentCount, 0);

  return {
    listings: rows.length.toLocaleString(),
    sessionReady: rows.filter((row) => row.sessionSupported).length.toLocaleString(),
    networks: new Set(rows.map((row) => row.network)).size.toLocaleString(),
    verifiedPayments: verifiedPayments.toLocaleString()
  };
}

function buildMcpStats(rows: MarketplaceRow[], payments: PaymentRow[]) {
  const mcpPaymentCount = payments.filter((payment) => payment.resource.startsWith("mcp:")).length;
  return {
    tools: rows.length.toLocaleString(),
    sessionReady: rows.filter((row) => row.sessionSupported).length.toLocaleString(),
    verifiedPayments: (mcpPaymentCount || rows.reduce((total, row) => total + row.paymentCount, 0)).toLocaleString(),
    networks: new Set(rows.map((row) => row.network)).size.toLocaleString()
  };
}

function countPaymentsByMerchant(payments: PaymentRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const payment of payments) {
    counts.set(payment.merchant, (counts.get(payment.merchant) ?? 0) + 1);
  }
  return counts;
}

function describeResource(resourceScope: string, transport: "http" | "mcp"): string {
  if (transport === "mcp") {
    return "Paid MCP tool surface with Sui402 proof verification and optional session spend.";
  }

  if (resourceScope.includes("quote") || resourceScope.includes("price")) {
    return "Metered API endpoint for quote, pricing, or market intelligence workloads.";
  }

  if (resourceScope.includes("market") || resourceScope.includes("data")) {
    return "Paid data API listed through the gateway registry for agent discovery.";
  }

  return "Hosted Sui402 API with discoverable payment manifest and gateway access path.";
}

function formatNetwork(value: string): string {
  return value.replace(/^sui:/, "");
}

type DashboardDocumentMetadata = {
  title: string;
  description: string;
};

const defaultDashboardDocumentMetadata: DashboardDocumentMetadata = {
  title: "Sui402 Console - Machine Payment Dashboard",
  description: "Sui402 Console - Hosted payment operations for AI agents, APIs, and MCP tools on Sui."
};

function buildDashboardDocumentMetadata(input: {
  link: DashboardDeepLink;
  selectedMarketplaceApi?: MarketplaceRow;
  marketplaceDetail?: MarketplaceApiDetailResponse;
  marketplaceDetailLoading: boolean;
  marketplaceDetailError?: string;
  scanResult?: ScanLookupResult;
  scanQuery: string;
  scanKind: ScanLookupKind | "auto";
  scanLoading: boolean;
  scanError?: string;
}): DashboardDocumentMetadata {
  if (input.link.marketplaceApiId || input.selectedMarketplaceApi || input.marketplaceDetail) {
    const api = input.marketplaceDetail?.api;
    const row = input.selectedMarketplaceApi;
    const id = api?.id ?? row?.id ?? input.link.marketplaceApiId ?? "API";
    const name = cleanMetadataText(api?.name ?? row?.name ?? id);
    const status = input.marketplaceDetailLoading ? "Loading" : input.marketplaceDetailError ? "Unavailable" : undefined;
    return {
      title: `${status ? `${status}: ` : ""}${name} | Sui402 Marketplace`,
      description: cleanMetadataText(
        input.marketplaceDetailError ??
          api?.description ??
          row?.description ??
          `Discover ${id} in the Sui402 marketplace, inspect agent payment readiness, and copy a Sui402 pay command.`
      )
    };
  }

  if (input.link.scanId || input.scanResult || input.scanQuery.trim()) {
    const kind = input.scanResult?.kind ?? (input.scanKind === "auto" ? undefined : input.scanKind) ?? input.link.scanKind;
    const id = input.scanResult?.id ?? input.link.scanId ?? input.scanQuery.trim();
    const label = scanMetadataLabel(kind, id);
    const status = input.scanLoading ? "Loading" : input.scanError ? "Unavailable" : undefined;
    return {
      title: `${status ? `${status}: ` : ""}${label} | Sui402 Scan`,
      description: cleanMetadataText(input.scanError ?? scanMetadataDescription(input.scanResult, kind, id))
    };
  }

  return defaultDashboardDocumentMetadata;
}

function updateDashboardDocumentMetadata(metadata: DashboardDocumentMetadata) {
  if (typeof document === "undefined") {
    return;
  }

  document.title = metadata.title;
  setMetaTag("name", "description", metadata.description);
  setMetaTag("property", "og:title", metadata.title);
  setMetaTag("property", "og:description", metadata.description);
  setMetaTag("property", "og:type", "website");
  setMetaTag("property", "og:url", window.location.href);
  setMetaTag("name", "twitter:card", "summary");
  setMetaTag("name", "twitter:title", metadata.title);
  setMetaTag("name", "twitter:description", metadata.description);
  setCanonicalUrl(window.location.href);
}

function setMetaTag(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonicalUrl(href: string) {
  let element = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

function scanMetadataLabel(kind: ScanLookupKind | undefined, id: string): string {
  const renderedId = id ? shortValue(id) : "Lookup";
  if (!kind) {
    return `Lookup ${renderedId}`;
  }

  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${renderedId}`;
}

function scanMetadataDescription(result: ScanLookupResult | undefined, kind: ScanLookupKind | undefined, id: string): string {
  if (!result) {
    return `Inspect ${kind ?? "Sui402"} payment evidence for ${id || "a digest, merchant, session, or settlement"} without exposing request payloads or payment headers.`;
  }

  if (result.kind === "payment") {
    const record = result.record as ScanPaymentRecord;
    return `Inspect a ${record.kind} Sui402 payment of ${formatPrice(record.amount, record.coinType)} for ${record.resource} on ${formatNetwork(record.network)}.`;
  }

  if (result.kind === "merchant") {
    const record = result.record as ScanMerchantRecord;
    const merchantId = record.merchant?.id ?? record.listing?.id ?? result.id;
    return `Inspect Sui402 merchant ${merchantId}: ${record.stats.verifiedPayments.toLocaleString()} verified payment(s), ${record.stats.sessionPayments.toLocaleString()} session payment(s), and ${record.stats.volume} indexed volume.`;
  }

  if (result.kind === "session") {
    const record = result.record as ScanSessionRecord;
    return `Inspect Sui402 session ${shortValue(record.sessionId)} with ${record.spendCount.toLocaleString()} spend(s) totaling ${record.spentAmount}.`;
  }

  const record = result.record as ScanSettlementRecord;
  return `Inspect Sui402 ${record.kind} settlement ${shortValue(record.txDigest)} for ${formatPrice(record.amount, record.coinType)} on ${formatNetwork(record.network)}.`;
}

function cleanMetadataText(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function formatDashboardHash(link: DashboardDeepLink): string {
  const params = new URLSearchParams();
  if (link.marketplaceApiId) {
    params.set("marketplace", link.marketplaceApiId);
  }
  if (link.scanKind && link.scanId) {
    params.set("scanKind", link.scanKind);
    params.set("scanId", link.scanId);
  }

  const rendered = params.toString();
  return rendered ? `#${rendered}` : "";
}

function formatDashboardPath(link: DashboardDeepLink): string {
  if (link.marketplaceApiId) {
    return `/marketplace/${encodeURIComponent(link.marketplaceApiId)}`;
  }

  if (link.scanKind && link.scanId) {
    return `/scan/${encodeURIComponent(link.scanKind)}/${encodeURIComponent(link.scanId)}`;
  }

  return "/";
}

function parseDashboardPath(pathname: string): DashboardDeepLink {
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments[0] === "marketplace" && segments[1]) {
    return { marketplaceApiId: segments[1] };
  }

  if (segments[0] === "scan" && segments[1] && segments[2]) {
    const scanKind = segments[1];
    return {
      scanKind: scanKind === "payment" || scanKind === "merchant" || scanKind === "session" || scanKind === "settlement" ? scanKind : undefined,
      scanId: segments.slice(2).join("/")
    };
  }

  return {};
}

function parseDashboardHash(hash: string): DashboardDeepLink {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const marketplaceApiId = params.get("marketplace") ?? undefined;
  const scanKind = params.get("scanKind");
  const scanId = params.get("scanId") ?? undefined;

  return {
    marketplaceApiId,
    scanKind: scanKind === "payment" || scanKind === "merchant" || scanKind === "session" || scanKind === "settlement" ? scanKind : undefined,
    scanId
  };
}

function initialDashboardPage(): DashboardPageId {
  const pathLink = parseDashboardPath(window.location.pathname);
  if (pathLink.marketplaceApiId) {
    return "marketplace";
  }

  if (pathLink.scanKind && pathLink.scanId) {
    return "scan";
  }

  const hashPage = parseDashboardPage(window.location.hash);
  const hashLink = parseDashboardHash(window.location.hash);
  if (hashLink.marketplaceApiId) {
    return "marketplace";
  }

  if (hashLink.scanKind && hashLink.scanId) {
    return "scan";
  }

  return hashPage ?? "overview";
}

function parseDashboardPage(hash: string): DashboardPageId | undefined {
  const page = new URLSearchParams(hash.replace(/^#/, "")).get("page");
  return isDashboardPageId(page) ? page : undefined;
}

function isDashboardPageId(value: string | null | undefined): value is DashboardPageId {
  return value === "overview" || value === "marketplace" || value === "mcp" || value === "publisher" || value === "scan" || value === "operator";
}

function defaultTargetForDashboardPage(pageId: DashboardPageId): string {
  switch (pageId) {
    case "marketplace":
      return "registry";
    case "mcp":
      return "mcp-page";
    case "publisher":
      return "add-api";
    case "scan":
      return "scan-explorer";
    case "operator":
      return "operator-page";
    case "overview":
    default:
      return "overview-page";
  }
}

function shareUrlForPath(path: string): string {
  const url = new URL(window.location.href);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function formatPrice(price: string, coinType: string): string {
  if (coinType === "0x2::sui::SUI" && /^\d+$/.test(price)) {
    const mist = Number(price);
    if (Number.isSafeInteger(mist)) {
      const sui = mist / 1_000_000_000;
      if (sui >= 1 || mist % 1_000_000_000 === 0) {
        return `${trimDecimals(sui)} SUI`;
      }
      if (mist >= 1_000_000) {
        return `${trimDecimals(sui)} SUI`;
      }
    }
  }

  return `${price} ${coinSymbol(coinType)}`;
}

function coinSymbol(coinType: string): string {
  const symbol = coinType.split("::").at(-1);
  return symbol && symbol !== coinType ? symbol : coinType;
}

function trimDecimals(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

function shortValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//i, "");
}

function slugFromUrl(value: string): string {
  try {
    const parsed = new URL(normalizeUrlInput(value));
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/^\/|\/$/g, "");
    return slugify(path ? `${host}-${path.split("/")[0]}` : host);
  } catch {
    return slugify(value);
  }
}

function serviceFromUrl(value: string): string {
  try {
    const parsed = new URL(normalizeUrlInput(value));
    const host = parsed.hostname.replace(/^www\./, "");
    return titleize(host.split(".")[0] || "Publisher API");
  } catch {
    return "Publisher API";
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function titleize(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function buildSetupPrompt(draft: MerchantDraft, environment: string): string {
  const apiUrl = draft.apiUrl || "https://api.example.com";
  const merchant = draft.address || "0xYOUR_PUBLISHER_WALLET";
  const resource = draft.resourceScope || `api:${draft.id || "your-api"}`;
  return `Add Sui402 payments to ${apiUrl}. Protect the paid API with @sui402/server, charge ${draft.price} units of ${draft.coinType} on ${environment === "Mainnet" ? "sui:mainnet" : "sui:testnet"}, pay merchant ${merchant}, use resource scope ${resource}, and expose /.well-known/sui402 for agent discovery.`;
}

function buildVerificationDocument(application: MerchantApplication, nextSteps?: MerchantApplicationNextSteps): string {
  if (nextSteps?.verificationDocument) {
    return JSON.stringify(nextSteps.verificationDocument, null, 2);
  }

  const verification = application.verification;
  if (!verification) {
    return "";
  }

  return JSON.stringify(
    {
      sui402: "publisher-verification-v1",
      applicationId: application.id,
      merchantId: application.request.id,
      upstreamUrl: verification.expectedUpstreamUrl,
      verificationToken: verification.token
    },
    null,
    2
  );
}

function buildPublisherWalletProofMessage(application: MerchantApplication): string {
  return [
    "Sui402 publisher payout wallet proof",
    `applicationId=${application.id}`,
    `merchantId=${application.request.id}`,
    `payoutWallet=${application.request.merchant}`,
    `network=${application.request.network ?? "sui:testnet"}`,
    `coinType=${application.request.coinType}`,
    `price=${application.request.price}`,
    `resourceScope=${application.request.resourceScope}`,
    `upstreamUrl=${application.request.upstreamUrl ?? "none"}`
  ].join("\n");
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function isReviewOverdue(application: MerchantApplication): boolean {
  return (
    application.status === "pending" &&
    Boolean(application.reviewDueAt) &&
    Date.parse(application.reviewDueAt!) < Date.now()
  );
}

function isReviewDueOverdue(reviewDueAt: string, status: "pending" | "approved" | "rejected"): boolean {
  return status === "pending" && Date.parse(reviewDueAt) < Date.now();
}

function merchantChangeFields(request: MerchantChangeRequest): Array<keyof MerchantChangeRequest["changes"]> {
  return (["merchant", "network", "coinType"] as const).filter((field) => request.changes[field]);
}

function merchantChangeValue(request: MerchantChangeRequest, field: keyof MerchantChangeRequest["changes"]): string {
  const value = request.changes[field];
  if (!value) {
    return "";
  }

  return field === "merchant" ? shortValue(value) : value;
}

const rootElement = typeof document === "undefined" ? undefined : document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
