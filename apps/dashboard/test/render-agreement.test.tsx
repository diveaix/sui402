import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarketplaceApiDetailPanel,
  PublisherProbeSummary,
  ScanResultCard,
  type MarketplaceRow
} from "../src/main.js";
import type {
  MarketplaceApiDetailResponse,
  PublisherApiProbeResponse,
  ScanLookupResult,
  ScanMerchantRecord,
  ScanPaymentRecord,
  ScanSessionRecord,
  ScanSettlementRecord
} from "../src/api.js";

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://dashboard.example.com/"
      }
    }
  });
});

it("renders the publisher paid-test wizard without implying custodial payment", () => {
    const probe: PublisherApiProbeResponse = {
      ready: false,
      applicationId: "application-probe",
      merchantId: "probe-api",
      status: "approved",
      publisherAuth: {
        kind: "publisher_session",
        sessionId: "psess_render_test",
        expiresAt: "2026-05-19T00:15:00.000Z"
      },
      checks: [
        { name: "application_review", ok: true, message: "Application is approved" },
        { name: "paid_test_observed", ok: false, message: "No verified paid test payment has been recorded for this API" }
      ],
      unpaidProbe: {
        expectedStatus: 402,
        protectedResourceUrl: "https://console.example.com/gateway/merchants/probe-api/pay",
        challengeIssued: false,
        note: "Live unpaid requests should issue a fresh challenge."
      },
      paidProbe: {
        supported: false,
        reason: "No verified paid call evidence has been recorded yet.",
        nextAction: {
          label: "Run paid test call",
          command: "sui402-pay curl https://console.example.com/gateway/merchants/probe-api/pay --max-one-shot-amount 2500",
          note: "Use a local non-custodial Sui wallet on sui:testnet."
        },
        evidence: {
          requiredForPublicLaunch: true,
          observed: false,
          status: "missing",
          verifiedPayments: 0,
          sessionPayments: 0,
          volume: "0",
          recentPayments: []
        }
      },
      paidTestWizard: {
        schemaVersion: "sui402.publisher-paid-test-wizard.v1",
        title: "Publisher paid-test wizard",
        readyForPublicLaunch: false,
        currentGate: "run_paid_test",
        summary: "Gateway and listing are published. Run the paid test command from a local non-custodial payer wallet, then rerun the probe.",
        commands: {
          checkStatus: 'curl -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "https://console.example.com/v1/publisher/apis/application-probe/status"',
          rerunProbe: 'curl -X POST -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "https://console.example.com/v1/publisher/apis/application-probe/probe"',
          unpaidChallenge: 'curl -i "https://console.example.com/gateway/merchants/probe-api/pay"',
          paidCall: "sui402-pay curl https://console.example.com/gateway/merchants/probe-api/pay --max-one-shot-amount 2500",
          inspectMarketplace: "sui402-pay marketplace detail probe-api",
          scanMerchant: "sui402-pay scan merchant probe-api"
        },
        steps: [
          {
            id: "publish_or_verify",
            label: "Verify ownership and publish gateway/listing",
            status: "done",
            description: "The gateway merchant and marketplace listing exist."
          },
          {
            id: "confirm_unpaid_402",
            label: "Confirm unpaid request returns HTTP 402",
            status: "done",
            description: "The protected resource should issue a fresh challenge.",
            command: 'curl -i "https://console.example.com/gateway/merchants/probe-api/pay"'
          },
          {
            id: "run_paid_call",
            label: "Run a capped paid call",
            status: "current",
            description: "Run this from a funded user-owned Sui wallet.",
            command: "sui402-pay curl https://console.example.com/gateway/merchants/probe-api/pay --max-one-shot-amount 2500"
          },
          {
            id: "rerun_probe",
            label: "Rerun readiness probe",
            status: "current",
            description: "The probe turns ready only after verified payment evidence is indexed.",
            command: 'curl -X POST -H "x-sui402-publisher-token: $SUI402_PUBLISHER_TOKEN" "https://console.example.com/v1/publisher/apis/application-probe/probe"'
          }
        ],
        safety: [
          "Uses a local non-custodial payer wallet.",
          "Caps one-shot fallback spend at the listed API price.",
          "Does not prove legal/KYB fitness, uptime, refundability, or external audit."
        ]
      }
    };

    const html = renderToStaticMarkup(<PublisherProbeSummary probe={probe} />);

    expect(html).toContain("Paid-test wizard");
    expect(html).toContain("short-lived publisher session psess_render_test");
    expect(html).toContain("Run a capped paid call");
    expect(html).toContain("sui402-pay curl https://console.example.com/gateway/merchants/probe-api/pay --max-one-shot-amount 2500");
    expect(html).toContain("Uses a local non-custodial payer wallet.");
    expect(html).toContain("Does not prove legal/KYB fitness");
});

describe("dashboard marketplace/scan agreement rendering", () => {
  it("renders marketplace detail fields and commands from the public detail contract", () => {
    const row: MarketplaceRow = {
      id: "atlas-api",
      name: "Atlas API",
      description: "Market data priced per agent call.",
      network: "sui:testnet",
      transport: "http",
      price: "1000",
      coinType: "0x2::sui::SUI",
      resourceScope: "api:market-feed",
      status: "active",
      merchantAddress: "0x123",
      endpoint: "https://console.example.com/gateway/merchants/atlas-api/pay",
      tags: ["market", "agent"],
      sessionSupported: true,
      paymentCount: 1
    };
    const detail: MarketplaceApiDetailResponse = {
      schemaVersion: "sui402.marketplace.api.v1",
      api: {
        id: "atlas-api",
        name: "Atlas API",
        description: "Market data priced per agent call.",
        transport: "http",
        network: "sui:testnet",
        merchant: "0x123",
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:market-feed",
        sessionSupported: true,
        protectedResourceUrl: "https://console.example.com/gateway/merchants/atlas-api/pay",
        sessionManagerUrl: "https://console.example.com/gateway/merchants/atlas-api/sessions",
        tags: ["market", "agent"],
        status: "active",
        readiness: {
          ready: true,
          level: "ready",
          reasons: [],
          checks: [
            { name: "listing_active", ok: true, message: "Listing is active" },
            { name: "paid_test_observed", ok: true, message: "Verified paid test evidence exists" }
          ]
        },
        stats: {
          verifiedPayments: 1,
          sessionPayments: 0,
          volume: "1000"
        },
        reliability: {
          paidTestObserved: true,
          verifiedPayments: 1,
          sessionPayments: 0,
          oneShotPayments: 1,
          recentIndexedPayments: 1,
          firstVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
          lastVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
          evidenceWindow: {
            from: "2026-05-19T00:00:00.000Z",
            to: "2026-05-19T00:00:00.000Z",
            payments: 1
          },
          notes: ["Verified payment records exist in the public scan index."]
        }
      },
      merchant: {
        id: "atlas-api",
        service: "Atlas API",
        network: "sui:testnet",
        merchant: "0x123",
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:market-feed",
        status: "active",
        sessionsEnabled: true
      },
      trust: {
        listingPublished: true,
        merchantPublished: true,
        upstreamConfigured: true,
        sessionsEnabled: true
      },
      readiness: {
        ready: true,
        level: "ready",
        reasons: [],
        checks: [
          { name: "listing_active", ok: true, message: "Listing is active" },
          { name: "paid_test_observed", ok: true, message: "Verified paid test evidence exists" }
        ]
      },
      commands: {
        curl: "sui402-pay curl https://console.example.com/gateway/merchants/atlas-api/pay --max-one-shot-amount 1000",
        search: "sui402-pay search Atlas API",
        scan: "sui402-pay scan merchant atlas-api",
        sessionOnly: "sui402-pay curl https://console.example.com/gateway/merchants/atlas-api/pay --session-only",
        sessionInspect: "sui402-pay session inspect --merchant 0x123 --resource api:market-feed --amount 1000"
      },
      paymentPlan: {
        custody: "user_owned",
        authorizationMode: "live_402_challenge_plus_local_policy",
        network: "sui:testnet",
        merchant: "0x123",
        coinType: "0x2::sui::SUI",
        amountAtomic: "1000",
        maxOneShotAmount: "1000",
        resourceScope: "api:market-feed",
        resourceScopeHash: "hash-market-feed",
        protectedResourceUrl: "https://console.example.com/gateway/merchants/atlas-api/pay",
        sessionSupported: true,
        sessionBehavior: "session_first_with_capped_one_shot_fallback",
        sessionManagerUrl: "https://console.example.com/gateway/merchants/atlas-api/sessions",
        notes: ["The command caps one-shot fallback at the listed atomic price."]
      },
      stats: {
        verifiedPayments: 1,
        sessionPayments: 0,
        volume: "1000"
      },
      reliability: {
        paidTestObserved: true,
        verifiedPayments: 1,
        sessionPayments: 0,
        oneShotPayments: 1,
        recentIndexedPayments: 1,
        firstVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
        lastVerifiedPaymentAt: "2026-05-19T00:00:00.000Z",
        evidenceWindow: {
          from: "2026-05-19T00:00:00.000Z",
          to: "2026-05-19T00:00:00.000Z",
          payments: 1
        },
        notes: ["Verified payment records exist in the public scan index."]
      },
      recentPayments: [
        {
          id: "digest-atlas-1",
          digest: "digest-atlas-1",
          network: "sui:testnet",
          kind: "one-shot",
          challengeId: "challenge-atlas-1",
          merchantId: "atlas-api",
          recipient: "0x123",
          coinType: "0x2::sui::SUI",
          amount: "1000",
          resource: "api:market-feed"
        }
      ],
      links: {
        scanMerchantPath: "/v1/scan/merchants/atlas-api",
        protectedResourceUrl: "https://console.example.com/gateway/merchants/atlas-api/pay",
        sessionManagerUrl: "https://console.example.com/gateway/merchants/atlas-api/sessions"
      }
    };

    const html = renderToStaticMarkup(
      <MarketplaceApiDetailPanel
        row={row}
        detail={detail}
        loading={false}
        shareUrl="https://dashboard.example.com/marketplace/atlas-api"
        onClose={() => undefined}
        onScan={() => undefined}
      />
    );

    expect(html).toContain("Atlas API");
    expect(html).toContain("api:market-feed");
    expect(html).toContain("Ready for agent calls");
    expect(html).toContain("paid test observed");
    expect(html).toContain("Verified paid evidence observed");
    expect(html).toContain("1 public evidence records");
    expect(html).toContain("2026-05-19T00:00:00.000Z");
    expect(html).toContain("sui402-pay curl https://console.example.com/gateway/merchants/atlas-api/pay --max-one-shot-amount 1000");
    expect(html).toContain("sui402-pay search Atlas API");
    expect(html).toContain("sui402-pay scan merchant atlas-api");
    expect(html).toContain("sui402-pay curl https://console.example.com/gateway/merchants/atlas-api/pay --session-only");
    expect(html).toContain("sui402-pay session inspect --merchant 0x123 --resource api:market-feed --amount 1000");
    expect(html).toContain("Agent payment plan");
    expect(html).toContain("max one-shot");
    expect(html).toContain("session first with capped one shot fallback");
    expect(html).toContain("digest-atlas-1");
  });

  it("renders scan payment, merchant, session, and settlement records from public scan contracts", () => {
    const payment: ScanPaymentRecord = {
      id: "digest-atlas-1",
      digest: "digest-atlas-1",
      network: "sui:testnet",
      kind: "one-shot",
      challengeId: "challenge-atlas-1",
      merchantId: "atlas-api",
      recipient: "0x123",
      coinType: "0x2::sui::SUI",
      amount: "1000",
      resource: "api:market-feed"
    };
    const merchant: ScanMerchantRecord = {
      merchant: {
        id: "atlas-api",
        service: "Atlas API",
        network: "sui:testnet",
        merchant: "0x123",
        coinType: "0x2::sui::SUI",
        price: "1000",
        resourceScope: "api:market-feed",
        status: "active",
        sessionsEnabled: true
      },
      stats: {
        verifiedPayments: 1,
        sessionPayments: 0,
        volume: "1000"
      },
      recentPayments: [payment]
    };
    const session: ScanSessionRecord = {
      sessionId: "0xsession",
      network: "sui:testnet",
      coinType: "0x2::sui::SUI",
      payerHash: "sha256:payerhash",
      identityRedaction: {
        payer: "redacted_with_stable_hash"
      },
      merchant: "0xmerchant",
      spendCount: 1,
      spentAmount: "1000",
      resourceScopeHashes: ["scope-hash"],
      lastTxDigest: "session-spend-digest-1",
      spends: [
        {
          id: "session-spend-1",
          txDigest: "session-spend-digest-1",
          amount: "1000",
          challengeId: "challenge-1",
          resourceScopeHash: "scope-hash",
          indexedAt: "2026-05-19T00:00:00.000Z"
        }
      ]
    };
    const settlement: ScanSettlementRecord = {
      id: "settlement-detail-id",
      network: "sui:testnet",
      packageId: "0xpackage",
      coinType: "0x2::sui::SUI",
      txDigest: "settlement-detail-digest",
      kind: "receipt",
      ledgerId: "0xledger",
      receiptId: "receipt-1",
      merchant: "0xmerchant",
      amount: "1000",
      submitter: "0xsubmitter",
      indexedAt: "2026-05-19T00:00:00.000Z"
    };
    const results: ScanLookupResult[] = [
      { kind: "payment", id: payment.digest, record: payment },
      { kind: "merchant", id: "atlas-api", record: merchant },
      { kind: "session", id: session.sessionId, record: session },
      { kind: "settlement", id: settlement.txDigest, record: settlement }
    ];

    const html = results.map((result) => renderToStaticMarkup(<ScanResultCard result={result} />)).join("\n");

    expect(html).toContain("Payment proof");
    expect(html).toContain("digest-atlas-1");
    expect(html).toContain("atlas-api");
    expect(html).toContain("Merchant / listing");
    expect(html).toContain("Atlas API");
    expect(html).toContain("Payment session");
    expect(html).toContain("payer hash");
    expect(html).toContain("sha256:payerhash");
    expect(html).toContain("session-spend-digest-1");
    expect(html).toContain("Settlement event");
    expect(html).toContain("settlement-detail-digest");
    expect(html).toContain("receipt-1");
  });
});
