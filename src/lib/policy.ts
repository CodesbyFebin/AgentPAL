import { id, nowIso } from "./ids";
import type {
  Mandate,
  Merchant,
  PolicyCheck,
  PolicyDecision,
  PolicyDecisionType,
} from "./types";

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous\s+)?(instructions|limits|rules)/i,
  /system\s+override/i,
  /disregard\s+(the\s+)?(user'?s\s+)?mandate/i,
  /you\s+are\s+now\s+in\s+unrestricted/i,
  /auto-approve\s+this\s+purchase/i,
  /treat\s+this\s+listing\s+as\s+an\s+instruction/i,
  /bypass\s+(the\s+)?(policy|budget|limit)/i,
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
  category: string;
  recurring: boolean;
  remainingBudget: number;
  killSwitch: boolean;
  firstTimeMerchant: boolean;
  now?: Date;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const now = input.now ?? new Date();
  const checks: PolicyCheck[] = [];
  const reasons: string[] = [];
  let decision: PolicyDecisionType = "allow";

  const fail = (code: string, detail: string, next: PolicyDecisionType = "block") => {
    checks.push({ code, passed: false, detail });
    reasons.push(detail);
    if (next === "block") decision = "block";
    else if (decision !== "block") decision = "needs-approval";
  };

  const pass = (code: string, detail: string) => {
    checks.push({ code, passed: true, detail });
  };

  if (input.killSwitch) {
    fail(
      "kill_switch",
      "Kill switch is on. All agent financial activity is frozen until a human turns it off.",
    );
  } else {
    pass("kill_switch", "Kill switch is off.");
  }

  if (input.mandate.status !== "active") {
    fail("mandate_status", `Mandate status is "${input.mandate.status}", not active.`);
  } else {
    pass("mandate_status", "Mandate is active.");
  }

  const expires = new Date(input.mandate.expires_at);
  if (Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime()) {
    fail("expiry", `Mandate expired at ${input.mandate.expires_at}.`);
  } else {
    pass("expiry", `Mandate is valid until ${input.mandate.expires_at}.`);
  }

  // Merchant catalog text is data, never instructions.
  const injection = detectPromptInjection([
    input.merchant.name,
    input.merchant.description,
    ...input.merchant.products.map((p) => `${p.name} ${p.sku}`),
  ]);
  if (injection.detected || input.merchant.injection_bait) {
    fail(
      "prompt_injection",
      `Blocked a prompt-injection attempt in merchant listing text (matched “${injection.excerpt || "injection bait flag"}”). Catalog copy is treated as untrusted data, not policy instructions.`,
    );
  } else {
    pass("prompt_injection", "No injection patterns in merchant listing data.");
  }

  if (!input.mandate.approved_merchants.includes(input.merchant.merchant_id)) {
    fail(
      "allowlist",
      `${input.merchant.name} is not on the mandate allowlist (${input.mandate.approved_merchants.join(", ") || "empty"}).`,
    );
  } else {
    pass("allowlist", `${input.merchant.name} is an approved provider on this mandate.`);
  }

  if (!input.mandate.allowed_categories.includes(input.category)) {
    fail(
      "category",
      `Category "${input.category}" is not allowed. Allowed: ${input.mandate.allowed_categories.join(", ") || "none"}.`,
    );
  } else {
    pass("category", `Category "${input.category}" is allowed by the mandate.`);
  }

  if (input.amount <= 0) {
    fail("amount", "Purchase amount must be greater than zero.");
  } else if (input.amount > input.remainingBudget + 1e-9) {
    fail(
      "budget",
      `$${input.amount.toFixed(2)} would exceed the remaining budget of $${input.remainingBudget.toFixed(2)} (max total $${input.mandate.max_total_spend.toFixed(2)}).`,
    );
  } else {
    pass(
      "budget",
      `$${input.amount.toFixed(2)} fits in the remaining budget of $${input.remainingBudget.toFixed(2)}.`,
    );
  }

  if (input.recurring) {
    fail(
      "recurring",
      "This is a recurring charge. MeshPaL always asks a human before an agent can start a subscription.",
      "needs-approval",
    );
  } else {
    pass("recurring", "One-time purchase, not a subscription.");
  }

  if (input.firstTimeMerchant && !input.mandate.approved_merchants.includes(input.merchant.merchant_id)) {
    fail(
      "first_time_merchant",
      `${input.merchant.name} has never been paid on behalf of this user. First-time merchants require human approval.`,
      "needs-approval",
    );
  } else if (input.firstTimeMerchant) {
    pass(
      "first_time_merchant",
      `${input.merchant.name} is new in the ledger but already pre-approved on the mandate allowlist, so first-time status does not require an extra approval.`,
    );
  } else {
    pass("first_time_merchant", `${input.merchant.name} already has a prior payment on this account.`);
  }

  if (input.amount > input.mandate.auto_approve_limit) {
    fail(
      "auto_approve_limit",
      `$${input.amount.toFixed(2)} is over the auto-approve limit of $${input.mandate.auto_approve_limit.toFixed(2)}. A human must approve this purchase.`,
      "needs-approval",
    );
  } else {
    pass(
      "auto_approve_limit",
      `$${input.amount.toFixed(2)} is within the auto-approve limit of $${input.mandate.auto_approve_limit.toFixed(2)}.`,
    );
  }

  const reason =
    decision === "allow"
      ? `Allowed: ${input.merchant.name} for $${input.amount.toFixed(2)} is within budget, on the allowlist, and under the auto-approve limit.`
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
  if (d === "allow") return "Allow";
  if (d === "block") return "Block";
  return "Needs approval";
}
