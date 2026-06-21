import {
  Activity,
  BadgeCheck,
  Boxes,
  Braces,
  Database,
  Gauge,
  KeyRound,
  LockKeyhole,
  Network,
  ScrollText,
  ShieldCheck,
  Store,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  pageId: string;
};

export type PaymentRow = {
  merchant: string;
  resource: string;
  network: string;
  amount: string;
  status: "verified" | "session" | "review";
  digest: string;
};

export type ReadinessItem = {
  label: string;
  value: string;
  status: "ready" | "warn" | "active";
  icon: LucideIcon;
};

export type ExportRow = {
  kind: "payment-ledger" | "receipt-bundle" | "audit-head";
  blobId: string;
  artifactId: string;
  paymentCount: number;
  createdAt: string;
};

export type KpiItem = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { label: "Overview", icon: Gauge, pageId: "overview" },
  { label: "Marketplace", icon: Boxes, pageId: "marketplace" },
  { label: "MCP", icon: Network, pageId: "mcp" },
  { label: "Publisher", icon: Store, pageId: "publisher" },
  { label: "Scan", icon: WalletCards, pageId: "scan" },
  { label: "Operator", icon: ShieldCheck, pageId: "operator" }
];

export const paymentRows: PaymentRow[] = [
  {
    merchant: "atlas-api",
    resource: "api:market-feed",
    network: "testnet",
    amount: "1,000,000 MIST",
    status: "verified",
    digest: "8tYq...31cd"
  },
  {
    merchant: "signal-mcp",
    resource: "mcp:premium_context",
    network: "testnet",
    amount: "0.25 SUI",
    status: "session",
    digest: "5Jd9...a110"
  },
  {
    merchant: "pricing-gateway",
    resource: "api:quote/*",
    network: "testnet",
    amount: "1 USDC",
    status: "verified",
    digest: "Af22...9c4b"
  },
  {
    merchant: "agent-store",
    resource: "mcp:tool_lookup",
    network: "testnet",
    amount: "0.05 SUI",
    status: "review",
    digest: "D1ef...9082"
  }
];

export const readinessItems: ReadinessItem[] = [
  { label: "Provider manifest", value: "3 published", status: "ready", icon: Braces },
  { label: "Replay protection", value: "Postgres unique digest", status: "ready", icon: LockKeyhole },
  { label: "Storage readiness", value: "Redis + Postgres", status: "active", icon: BadgeCheck },
  { label: "Audit status", value: "External review pending", status: "warn", icon: ScrollText }
];

export const exportRows: ExportRow[] = [
  {
    kind: "payment-ledger",
    blobId: "pending",
    artifactId: "local",
    paymentCount: 0,
    createdAt: "Not exported"
  }
];

export const kpis: KpiItem[] = [
  { label: "Verified payments", value: "3", detail: "seeded local proofs", icon: Activity },
  { label: "Active merchants", value: "2", detail: "demo registry entries", icon: Store },
  { label: "Session volume", value: "250M", detail: "MIST session proof", icon: WalletCards },
  { label: "Indexed sessions", value: "0", detail: "awaiting live indexer", icon: Database }
];

export function kpisFromOverview(input: {
  verifiedPayments: number;
  activeMerchants: number;
  sessionVolume: number;
  indexedSessionSpends?: number;
  indexedSessions?: number;
}): KpiItem[] {
  return [
    { label: "Verified payments", value: input.verifiedPayments.toLocaleString(), detail: "ledger records", icon: Activity },
    { label: "Active merchants", value: input.activeMerchants.toLocaleString(), detail: "gateway configured", icon: Store },
    { label: "Session volume", value: input.sessionVolume.toLocaleString(), detail: "session proofs", icon: WalletCards },
    {
      label: "Indexed sessions",
      value: (input.indexedSessions ?? 0).toLocaleString(),
      detail: `${(input.indexedSessionSpends ?? 0).toLocaleString()} chain spends`,
      icon: Database
    }
  ];
}

export function readinessFromOverview(
  items: Array<{ label: string; value: string; status: ReadinessItem["status"] }>
): ReadinessItem[] {
  const icons = [Braces, LockKeyhole, BadgeCheck, ScrollText];
  return items.map((item, index) => ({
    ...item,
    icon: icons[index] ?? BadgeCheck
  }));
}
