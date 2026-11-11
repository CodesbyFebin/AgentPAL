export type Currency = "USD" | "USDC" | "INR";

export type MandateStatus = "active" | "revoked" | "expired" | "completed";

export type Rail = "x402_usdc" | "paypal_sandbox" | "braintree_sandbox";

export type PolicyDecisionType = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

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
  /** Human title shown in Mandates & Safety. */
  title?: string;
  max_total_spend: number;
  /** Synonym kept for existing receipts: same value as per_tx_limit. */
  auto_approve_limit: number;
  /** Per-transaction limit. Amounts above this require approval. */
  per_tx_limit: number;
  /** Optional extra threshold; defaults to per_tx_limit. */
  approval_threshold: number;
  approved_merchants: string[];
  allowed_categories: string[];
  allow_recurring: boolean;
  /** Floor the projected post-purchase balance must stay above, same currency as the mandate. */
  minimum_balance: number;
  currency: Currency;
  expires_at: string;
  status: MandateStatus;
  signed_at: string;
  public_key: string;
  signature: string;
  revoked_at?: string;
  /** Optional UI space for the sidebar filter. Not part of policy evaluation. */
  space?: "My Money" | "Family" | "Business" | "Focus";
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
  braintree?: BraintreeRefs;
  x402?: { simulated: true; transfer_id: string };
  artifact?: DeliveryArtifact;
  idempotency_key?: string;
  payment_link_id?: string;
  finance_impact?: FinanceImpact;
  impact_explanation?: string;
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
  settlement_currency?: "USD";
  settlement_amount?: number;
  fx_rate?: number;
  fx_label?: string;
}

export interface BraintreeRefs {
  mode: "sandbox" | "mock";
  order_id?: string;
  transaction_id?: string;
  authorization_id?: string;
  capture_id?: string;
  refund_id?: string;
  status?: string;
  settlement_currency?: "USD";
  settlement_amount?: number;
  fx_rate?: number;
  fx_label?: string;
}

export interface DeliveryArtifact {
  kind: "api_credits" | "domain" | "generic" | "electronics";
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
  kind?: "payment" | "renewal";
  review_id?: string;
  subscription_id?: string;
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


export type AffordabilityVerdict =
  | "AFFORDABLE"
  | "AFFORDABLE_WITH_TRADEOFFS"
  | "NOT_RECOMMENDED";

export interface BankAccount {
  account_id: string;
  name: string;
  institution: string;
  type: "salary" | "savings";
  balance: number;
  currency: "INR";
  demo: true;
}

export interface LedgerTxn {
  txn_id: string;
  account_id: string;
  posted_at: string;
  amount: number;
  currency: "INR";
  category: string;
  merchant: string;
  note: string;
  demo: boolean;
  source: "seed" | "paypal_purchase";
  payment_id?: string;
  space?: "My Money" | "Family" | "Business" | "Focus";
}

export interface MonthlyBudget {
  budget_id: string;
  category: string;
  monthly_limit: number;
  currency: "INR";
  month: string;
}

export interface SavingsGoalAccount {
  savings_goal_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  monthly_contribution: number;
  currency: "INR";
  deadline?: string;
  priority: number;
}

export interface UpcomingBill {
  bill_id: string;
  name: string;
  amount: number;
  due_at: string;
  category: string;
  recurring: boolean;
  currency: "INR";
  paid?: boolean;
}

export interface FinanceFx {
  paypal_currency: "USD";
  inr_per_usd: number;
  label: string;
  source: "demo fixed rate";
}

export interface FinanceProfile {
  user_id: string;
  display_name: string;
  as_of: string;
  timezone: "Asia/Calcutta";
  currency: "INR";
  emergency_buffer: number;
  next_income_at: string;
  next_income_amount: number;
  fx: FinanceFx;
  demo: true;
}

export interface GoalContributionPause {
  savings_goal_id: string;
  name: string;
  contribution_paused: number;
  delayed_weeks: number;
  detail: string;
}

export interface FinanceImpact {
  verdict: AffordabilityVerdict;
  amount: number;
  currency: "INR";
  available_to_spend: number;
  safe_spending_limit: number;
  contributions_paused: GoalContributionPause[];
}

export interface AffordabilityAlternative {
  kind: "wait" | "cheaper" | "reduce_goals";
  detail: string;
  weeks?: number;
  amount?: number;
  sku?: string;
}

export interface AffordabilityResult {
  as_of: string;
  currency: "INR";
  request_amount: number;
  request_label?: string;
  total_balances: number;
  upcoming_bills_before_next_income: number;
  emergency_buffer: number;
  goal_contributions: number;
  available_to_spend: number;
  projected_eom_balance_without_purchase: number;
  projected_eom_balance_with_purchase: number;
  safe_spending_limit: number;
  verdict: AffordabilityVerdict;
  reasons: string[];
  tradeoffs: string[];
  alternatives: AffordabilityAlternative[];
  goal_impacts: GoalContributionPause[];
  fx: { inr: number; usd: number; rate: number; label: string };
  cash_flow?: {
    month: string;
    income: number;
    expenses: number;
    transfers: number;
    net: number;
    net_worth: number;
  };
}

export interface FinanceState {
  profile: FinanceProfile;
  accounts: BankAccount[];
  transactions: LedgerTxn[];
  budgets: MonthlyBudget[];
  savings_goals: SavingsGoalAccount[];
  bills: UpcomingBill[];
}

export interface IdempotencyRecord {
  key: string;
  payment_id: string;
  created_at: string;
}

export interface WebhookReceipt {
  event_id: string;
  event_type: string;
  payment_id?: string;
  verified: boolean;
  verification: "paypal" | "skipped_mock" | "skipped_no_webhook_id" | "failed";
  processed_at: string;
}

export type RecurringLifecycle = "suggested" | "active" | "paused" | "ended";
export type BillType = "bill" | "subscription" | "installment" | "income";
export type PriceChangeSource = "detected" | "user";

export interface PriceChange {
  change_id: string;
  previous: number;
  next: number;
  effective_at: string;
  source: PriceChangeSource;
  material: boolean;
}

export type SubscriptionStatus = RecurringLifecycle | "pending_renewal" | "past_due";

export interface ManagedSubscription {
  subscription_id: string;
  merchant_id: string;
  merchant_name: string;
  plan_name: string;
  amount: number;
  currency: Currency;
  interval: "monthly";
  /** suggested = detected or agent-spawned and not yet confirmed by the user. */
  status: SubscriptionStatus;
  lifecycle: RecurringLifecycle;
  bill_type: BillType;
  expected_amount_min: number;
  expected_amount_max: number;
  price_history: PriceChange[];
  paypal_subscription_id?: string;
  mandate_id?: string;
  /** Honest scope: only subscriptions created through AgentPaL are managed. */
  created_via: "moneymate_mesh";
  next_billing_at: string;
  last_renewal_amount?: number;
  notes?: string;
  created_at: string;
  cancelled_at?: string;
  cancel_reason?: string;
}

export interface RenewalIntelligence {
  previous_monthly_price: number;
  new_monthly_price: number;
  percent_change: number;
  monthly_increase: number;
  annual_increase: number;
  mandate_limit: number;
  other_subscriptions_total: number;
  projected_total: number;
  exceeds_by: number;
  currency: string;
}

export interface RenewalReview {
  review_id: string;
  subscription_id: string;
  mandate_id?: string;
  proposed_amount: number;
  previous_amount: number;
  price_increased: boolean;
  material: boolean;
  decision: PolicyDecisionType;
  reason: string;
  approval_id?: string;
  created_at: string;
  intelligence: RenewalIntelligence;
}

export type PaymentLinkUse = "single" | "multi";

export type PaymentLinkStatus = "active" | "revoked" | "expired" | "exhausted" | "disabled";

export interface PaymentLink {
  link_id: string;
  mandate_id: string;
  goal_id: string;
  merchant_id?: string;
  merchant_name?: string;
  product_sku?: string;
  description?: string;
  amount_cap: number;
  currency: Currency;
  expires_at: string;
  use_type: PaymentLinkUse;
  max_uses: number;
  use_count: number;
  status: PaymentLinkStatus;
  disabled_reason?: "kill_switch" | "mandate_revoked";
  payments: string[];
  public_key: string;
  signature: string;
  created_at: string;
  revoked_at?: string;
}

export interface SpendReservation {

  reservation_id: string;
  mandate_id: string;
  intent_key: string;
  payment_id?: string;
  amount: number;
  currency: Currency;
  status: "reserved" | "released" | "captured";
  created_at: string;
}

export type AiPermissionLevel = "L1" | "L2" | "L3";

export interface AiCallLog {
  call_id: string;
  kind: "llm" | "tool";
  name: string;
  model?: string;
  provider?: string;
  at: string;
  latency_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  input_summary: string;
  output_summary: string;
  ok: boolean;
  error?: string;
  conversation_id?: string;
  user_id?: string;
  level?: AiPermissionLevel;
  validated_args?: Record<string, unknown>;
  policy_decision_id?: string;
}


export interface SubscriptionPriceHistoryRow {
  history_id: string;
  subscription_id: string;
  old_price: number;
  new_price: number;
  changed_at: string;
  source: PriceChangeSource;
  material: boolean;
  currency: Currency;
}

export interface RecurringRule {
  rule_id: string;
  subscription_id?: string;
  frequency: "monthly";
  expected_amount: number;
  expected_amount_min: number;
  expected_amount_max: number;
  category: string;
  bill_type: BillType;
}

export interface MerchantProfile {
  merchant_profile_id: string;
  merchant_id?: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  category?: string;
  risk_flags: string[];
}

export interface CategoryRecord {
  category_id: string;
  name: string;
  parent_id?: string;
  type: "income" | "expense" | "transfer" | "subscription";
}

export interface FinancialSnapshot {
  snapshot_id: string;
  date: string;
  month: string;
  balances: number;
  income: number;
  expenses: number;
  transfers: number;
  net_worth: number;
  currency: Currency;
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
  finance: FinanceState;
  idempotency: IdempotencyRecord[];
  webhook_receipts: WebhookReceipt[];
  subscriptions: ManagedSubscription[];
  renewal_reviews: RenewalReview[];
  reservations: SpendReservation[];
  payment_links: PaymentLink[];
  ai_calls: AiCallLog[];
  subscription_price_history: SubscriptionPriceHistoryRow[];
  recurring_rules: RecurringRule[];
  merchant_directory: MerchantProfile[];
  categories: CategoryRecord[];
  ai_tool_logs: AiCallLog[];
  financial_snapshots: FinancialSnapshot[];
  settings: Settings;
}
