import { id, nowIso } from "./ids";
import { formatMoney } from "./money";
import type {
  Mandate,
  Merchant,
  PolicyCheck,
  PolicyDecision,
  PolicyDecisionType,
} from "./types";

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous\s+)?(instructions|limits|rules)/i,
  /ignore\s+spending\s+limits/i,
  /system\s+override/i,
  /disregard\s+(the\s+)?(user'?s\s+)?mandate/i,
  /you\s+are\s+now\s+in\s+unrestricted/i,
  /auto-approve\s+this\s+purchase/i,
  /treat\s+this\s+listing\s+as\s+an\s+instruction/i,
  /bypass\s+(the\s+)?(policy|budget|limit)/i,
  /pay\s+immediately/i,
];

export function detectPromptInjection(texts: string[]): {
  detected: boolean;
  excerpt: string;
} {
  for (const text of texts) {
    for (const pattern of INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return { detected: true, excerpt: match[0] };
      }
    }
  }
  return { detected: false, excerpt: "" };
}

export interface PolicyInput {
  mandate: Mandate;
  merchant: Merchant;
  amount: number;
  currency?: string;
  category: string;
  recurring: boolean;
  /** Amount already reserved or captured against this mandate (does not include this request). */
  mandateSpend: number;
  /** Projected account/cash balance after ordinary bills, in the mandate currency. */
  projectedBalance?: number;
  killSwitch: boolean;
  now?: Date;
  /** @deprecated accepted for older call sites; ignored by the rule order. */
  remainingBudget?: number;
  firstTimeMerchant?: boolean;
}

function perTxLimit(mandate: Mandate): number {
  return mandate.per_tx_limit ?? mandate.auto_approve_limit;
}

function approvalThreshold(mandate: Mandate): number {
  return mandate.approval_threshold ?? perTxLimit(mandate);
}

/**
 * Deterministic AgentPaL Guard policy. Decision order:
 * 1. kill switch / revoked / expired / merchant not allowed / category not allowed / amount<=0 / injection => DENY
 * 2. currency mismatch / recurring without permission / amount > per-tx (or approval) limit => REQUIRE_APPROVAL
 * 3. mandateSpend+amount > totalLimit => DENY
 * 4. projectedBalance-amount < minimumBalance => REQUIRE_APPROVAL
 * 5. else ALLOW
 *
 * DENY always wins over a earlier REQUIRE_APPROVAL.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const now = input.now ?? new Date();
  const checks: PolicyCheck[] = [];
  const reasons: string[] = [];
  let decision: PolicyDecisionType = "ALLOW";

  const deny = (code: string, detail: string) => {
    checks.push({ code, passed: false, detail });
    reasons.push(detail);
    decision = "DENY";
  };

  const needApproval = (code: string, detail: string) => {
    checks.push({ code, passed: false, detail });
    reasons.push(detail);
    if (decision !== "DENY") decision = "REQUIRE_APPROVAL";
  };

  const pass = (code: string, detail: string) => {
    checks.push({ code, passed: true, detail });
  };

  const ccy = input.currency || input.mandate.currency || "USD";
  const amt = formatMoney(input.amount, ccy);
  const totalLimit = formatMoney(input.mandate.max_total_spend, input.mandate.currency || ccy);
  const txLimit = formatMoney(perTxLimit(input.mandate), input.mandate.currency || ccy);
  const threshold = formatMoney(approvalThreshold(input.mandate), input.mandate.currency || ccy);

  // --- 1. hard DENY ---
  if (input.killSwitch) {
    deny(
      "kill_switch",
      "Kill switch is on. All agent financial activity is frozen until a human turns it off.",
    );
  } else {
    pass("kill_switch", "Kill switch is off.");
  }

  if (input.mandate.status !== "active") {
    deny("mandate_status", `Mandate status is "${input.mandate.status}", not active.`);
  } else {
    pass("mandate_status", "Mandate is active.");
  }

  const expires = new Date(input.mandate.expires_at);
  if (Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime()) {
    deny("expiry", `Mandate expired at ${input.mandate.expires_at}.`);
  } else {
    pass("expiry", `Mandate is valid until ${input.mandate.expires_at}.`);
  }

  const injection = detectPromptInjection([
    input.merchant.name,
    input.merchant.description,
    ...input.merchant.products.map((p) => `${p.name} ${p.sku}`),
  ]);
  if (injection.detected || input.merchant.injection_bait) {
    deny(
      "prompt_injection",
      `DENY: merchant listing text is untrusted data and matched “${injection.excerpt || "injection bait flag"}”. No PayPal call is made.`,
    );
  } else {
    pass("prompt_injection", "No injection patterns in merchant listing data.");
  }

  if (!input.mandate.approved_merchants.includes(input.merchant.merchant_id)) {
    deny(
      "allowlist",
      `${input.merchant.name} is not on the mandate merchant allowlist (${input.mandate.approved_merchants.join(", ") || "empty"}).`,
    );
  } else {
    pass("allowlist", `${input.merchant.name} is an approved provider on this mandate.`);
  }

  if (!input.mandate.allowed_categories.includes(input.category)) {
    deny(
      "category",
      `Category "${input.category}" is not allowed. Allowed: ${input.mandate.allowed_categories.join(", ") || "none"}.`,
    );
  } else {
    pass("category", `Category "${input.category}" is allowed by the mandate.`);
  }

  if (input.amount <= 0) {
    deny("amount", "Purchase amount must be greater than zero.");
  } else {
    pass("amount", `${amt} is a positive amount.`);
  }

  // --- 2. REQUIRE_APPROVAL ---
  const mandateCcy = input.mandate.currency || "USD";
  if (input.currency && input.currency !== mandateCcy) {
    needApproval(
      "currency",
      `Currency mismatch: the request is ${input.currency} but the mandate is denominated in ${mandateCcy}. A human must approve.`,
    );
  } else {
    pass("currency", `Request currency ${ccy} matches the mandate.`);
  }

  if (input.recurring && !input.mandate.allow_recurring) {
    needApproval(
      "recurring",
      "This is a recurring charge and the mandate does not allow recurring payments (allowRecurring is off). A human must approve.",
    );
  } else if (input.recurring) {
    pass("recurring", "Recurring charges are permitted by this mandate.");
  } else {
    pass("recurring", "One-time purchase, not a subscription.");
  }

  if (input.amount > perTxLimit(input.mandate) || input.amount > approvalThreshold(input.mandate)) {
    needApproval(
      "per_tx_limit",
      `${amt} is over the per-transaction limit of ${txLimit} (approval threshold ${threshold}). A human must approve this purchase.`,
    );
  } else {
    pass("per_tx_limit", `${amt} is within the per-transaction limit of ${txLimit}.`);
  }

  // --- 3. DENY if total limit exceeded (wins over earlier REQUIRE_APPROVAL) ---
  const nextSpend = input.mandateSpend + input.amount;
  if (nextSpend > input.mandate.max_total_spend + 1e-9) {
    deny(
      "total_limit",
      `${amt} plus existing mandate spend of ${formatMoney(input.mandateSpend, mandateCcy)} would exceed the total limit of ${totalLimit}.`,
    );
  } else {
    pass(
      "total_limit",
      `Mandate spend ${formatMoney(input.mandateSpend, mandateCcy)} + ${amt} is within the total limit of ${totalLimit}.`,
    );
  }

  // --- 4. minimum balance ---
  const minimum = input.mandate.minimum_balance ?? 0;
  if (typeof input.projectedBalance === "number" && minimum > 0) {
    const after = input.projectedBalance - input.amount;
    if (after < minimum) {
      needApproval(
        "minimum_balance",
        `Projected balance ${formatMoney(input.projectedBalance, ccy)} minus ${amt} is ${formatMoney(after, ccy)}, which is under the mandate minimum balance of ${formatMoney(minimum, ccy)}. A human must approve.`,
      );
    } else {
      pass(
        "minimum_balance",
        `Projected post-purchase balance ${formatMoney(after, ccy)} stays at or above the minimum of ${formatMoney(minimum, ccy)}.`,
      );
    }
  } else {
    pass("minimum_balance", "No minimum-balance gate is configured on this mandate (or no projected balance was supplied).");
  }

  const reason =
    decision === "ALLOW"
      ? `ALLOW: ${input.merchant.name} for ${amt} is within the total limit, on the allowlist, and under the per-transaction limit.`
      : reasons[0] + (reasons.length > 1 ? ` Additional checks: ${reasons.slice(1).join(" ")}` : "");

  return {
    decision_id: id("pol"),
    merchant_id: input.merchant.merchant_id,
    amount: input.amount,
    decision,
    reason,
    checks,
    created_at: nowIso(),
  };
}

export function decisionLabel(d: PolicyDecisionType): string {
  if (d === "ALLOW") return "Allow";
  if (d === "DENY") return "Deny";
  return "Require approval";
}
