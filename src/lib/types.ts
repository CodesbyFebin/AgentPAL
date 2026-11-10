export type Currency = "USD" | "USDC";

export type MandateStatus = "active" | "revoked" | "expired" | "completed";

export type Rail = "x402_usdc" | "paypal_sandbox";

export type PolicyDecisionType = "allow" | "block" | "needs-approval";

export type PaymentStatus =
  | "proposed"
  | "awaiting_approval"
  | "awaiting_buyer"
  | "authorized"
  | "captured"
  | "settled"
  | "voided"
  | "refunded"
  | "denied"
  | "failed";

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface Goal {
  goal_id: string;
  user_id: string;
  objective: string;
  budget: number;
  currency: Currency;
  deadline?: string;
  created_at: string;
}

export interface Mandate {
  mandate_id: string;
  goal_id: string;
  max_total_spend: number;
  auto_approve_limit: number;
  approved_merchants: string[];
  allowed_categories: string[];
  expires_at: string;
  status: MandateStatus;
  signed_at: string;
  public_key: string;
  signature: string;
}

export interface PlanStep {
  step_id: string;
  action: string;
  merchant_id: string;
  merchant_name: string;
  category: string;
  amount: number;
  currency: Currency;
  rail: Rail;
  approval_required: boolean;
  rationale: string;
  product_sku: string;
  recurring: boolean;
}

export interface Plan {
  plan_id: string;
  goal_id: string;
  mandate_id: string;
  steps: PlanStep[];
  planner: "offline" | "ai";
  model?: string;
  status: "draft" | "approved" | "rejected";
  created_at: string;
}

export interface TrustPassport {
  merchant_id: string;
  name: string;
  trust_score: number;
  uptime: number;
  average_latency_ms: number;
  refund_policy: string;
  dispute_rate: number;
  data_retention: string;
  agent_commerce_ready: boolean;
  human_approval_required: boolean;
}

export interface Merchant {
  merchant_id: string;
  name: string;
  category: string;
  description: string;
  products: MerchantProduct[];
  trust_passport: TrustPassport;
  /** Demo toggle: deliver a failing artifact so verification -> void/refund can be shown. */
  fail_delivery: boolean;
  injection_bait: boolean;
}

export interface MerchantProduct {
  sku: string;
  name: string;
  amount: number;
  currency: Currency;
  category: string;
  recurring: boolean;
}

export interface PolicyCheck {
  code: string;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  decision_id: string;
  step_id?: string;
  merchant_id: string;
  amount: number;
  decision: PolicyDecisionType;
  reason: string;
  checks: PolicyCheck[];
  created_at: string;
}

export interface Payment {
  payment_id: string;
  plan_id: string;
  step_id: string;
  goal_id: string;
  mandate_id: string;
  merchant_id: string;
  merchant_name: string;
  rail: Rail;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  approval: "auto" | "human" | "none";
  paypal?: PayPalRefs;
  x402?: { simulated: true; transfer_id: string };
  artifact?: DeliveryArtifact;
  created_at: string;
  updated_at: string;
}

export interface PayPalRefs {
  mode: "sandbox" | "mock";
  order_id?: string;
  authorization_id?: string;
  capture_id?: string;
  refund_id?: string;
  approve_url?: string;
}

export interface DeliveryArtifact {
  kind: "api_credits" | "domain" | "generic";
  payload: Record<string, unknown>;
  delivered_at: string;
}

export interface OutcomeContract {
  contract_id: string;
  goal_id: string;
  step_id: string;
  deliverable: string;
  required_checks: string[];
  refund_policy: string;
  max_spend: number;
}

export interface Verification {
  verification_id: string;
  payment_id: string;
  contract_id: string;
  status: "passed" | "failed";
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  created_at: string;
}

export interface Approval {
  approval_id: string;
  payment_id: string;
  step_id: string;
  goal_id: string;
  merchant_name: string;
  amount: number;
  currency: Currency;
  reason: string;
  status: ApprovalStatus;
  created_at: string;
  resolved_at?: string;
}

export interface Receipt {
  receipt_id: string;
  goal_id: string;
  mandate_id: string;
  total_spent: number;
  currency: Currency;
  remaining_budget: number;
  outcome: "delivered" | "partial" | "failed";
  payments: string[];
  summary: string;
  audit_hash: string;
  event_ids: string[];
  public_key: string;
  signature: string;
  created_at: string;
}

export interface AuditEvent {
  event_id: string;
  type: string;
  at: string;
  message: string;
  /** Always present on financial events. */
  attribution: "paid by agent on behalf of user";
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface EvidenceDraft {
  evidence_id: string;
  payment_id: string;
  source: "ai" | "template";
  title: string;
  body: string;
  created_at: string;
}

export interface Settings {
  kill_switch: boolean;
  kill_switch_at?: string;
  signing: { publicKeyPem: string; privateKeyPem: string };
}

export interface StoreData {
  goals: Goal[];
  mandates: Mandate[];
  plans: Plan[];
  payments: Payment[];
  verifications: Verification[];
  receipts: Receipt[];
  events: AuditEvent[];
  approvals: Approval[];
  merchants: Merchant[];
  contracts: OutcomeContract[];
  evidence: EvidenceDraft[];
  settings: Settings;
}
