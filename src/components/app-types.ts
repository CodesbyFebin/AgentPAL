import type {
  Approval,
  AuditEvent,
  FinanceState,
  Mandate,
  ManagedSubscription,
  Payment,
  PaymentLink,
  Receipt,
  RenewalReview,
  AiCallLog,
  PayPalToolCall,
} from "@/lib/types";
import type { SettlementStep } from "@/lib/settlement";
import type { PaymentMode } from "@/lib/payment-mode";

export type PageId =
  | "dashboard"
  | "transactions"
  | "subscriptions"
  | "budgets"
  | "coach"
  | "vault"
  | "links"
  | "agents"
  | "insights"
  | "reports"
  | "refunds"
  | "invoices"
  | "security"
  | "developer"
  | "settings"
  | "command-center"
  | "money-os"
  | "agent-mesh"
  | "hardening"
  | "analytics";

export const PAGES: { id: PageId; label: string; group?: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "command-center", label: "Command Center" },
  { id: "money-os", label: "Money OS" },
  { id: "agent-mesh", label: "AI Agent Mesh" },
  { id: "transactions", label: "Transactions" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "budgets", label: "Budgets" },
  { id: "coach", label: "AI Coach" },
  { id: "vault", label: "Payment Methods" },
  { id: "links", label: "Payment Links" },
  { id: "agents", label: "Agents" },
  { id: "insights", label: "Insights" },
  { id: "analytics", label: "Analytics" },
  { id: "reports", label: "Reports" },
  { id: "refunds", label: "Refunds & Disputes" },
  { id: "invoices", label: "Invoices & Plans" },
  { id: "security", label: "Security Center" },
  { id: "hardening", label: "Hardening" },
  { id: "developer", label: "Developer" },
  { id: "settings", label: "Settings" },
];

export type Snapshot = {
  goal: { goal_id: string; objective: string; budget: number; currency: string } | null;
  mandate: Mandate | null;
  mandates?: Mandate[];
  plan: { plan_id: string; steps: unknown[]; planner: string; skipped_steps?: Array<{ reason: string; message: string; product_sku?: string }> } | null;
  payments: Payment[];
  approvals: Approval[];
  verifications: unknown[];
  receipts: Receipt[];
  events: AuditEvent[];
  payment_links?: Array<PaymentLink & { url?: string; path?: string; qr_disclaimer?: string }>;
  settlement_timelines?: Record<string, SettlementStep[]>;
  merchants: { merchant_id: string; name: string; description: string; injection_bait: boolean }[];
  finance: FinanceState;
  subscriptions: ManagedSubscription[];
  renewal_reviews: RenewalReview[];
  ai_calls: AiCallLog[];
  webhook_receipts: unknown[];
  settings: { kill_switch: boolean; kill_switch_at?: string; public_key: string };
  modes: { planner: { planner: "offline" | "ai"; model?: string }; payment?: PaymentMode; paypal: "sandbox" | "mock"; webhook?: string; agentToolkit?: "live" | "mock" };
  paypal_tool_calls?: PayPalToolCall[];
};

export type RunFn = (label: string, fn: () => Promise<void>, next?: PageId) => Promise<void>;
