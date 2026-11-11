import { appendEvent } from "./events";
import { assessFromFinance, budgetProgress } from "./finance-engine";
import { executeStep } from "./engine";
import { id, nowIso } from "./ids";
import { logAiCall } from "./ai-log";
import { authorizeTool, levelForTool, parseToolArgs, redactSecrets } from "./ai-permissions";
import { formatINR, toInr } from "./money";
import { lifecycleOf } from "./subscription-metrics";
import { consumeTradeoffApproval, findCoveringMandate, resolveCatalogSku } from "./tradeoff-approvals";
import type { Plan, PlanStep, StoreData } from "./types";

export const COACH_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_accounts",
      description: "Read demo account names and balances. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_transactions",
      description: "Read recent demo ledger transactions. Read-only.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" }, category: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_budget",
      description: "Read monthly category budgets and spend so far. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recurring",
      description: "Read subscriptions and upcoming bills managed here. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_goals",
      description: "Read savings goals and remaining monthly contributions. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_affordability",
      description: "Run the deterministic affordability engine for an INR amount. The model must not do the money math itself.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          label: { type: "string" },
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_payment",
      description: "Create a payment intent for the AgentPaL Guard policy engine. Never captures or sends money, never creates a mandate, and cannot accept trade-offs on the user's behalf. A human still has to approve if policy requires it.",
      parameters: {
        type: "object",
        properties: {
          sku: { type: "string" },
        },
        required: ["sku"],
      },
    },
  },
];

export function runCoachTool(
  store: StoreData,
  name: string,
  args: Record<string, unknown>,
  meta: { conversation_id?: string; user_id?: string } = {},
): unknown {
  const started = Date.now();
  const level = levelForTool(name);
  const loggedLevel = level === "unknown" ? undefined : level;
  const auth = authorizeTool(name);
  if (!auth.allowed) {
    const result = { error: auth.reason, executed: false, level: auth.level };
    logAiCall(store, {
      kind: "tool",
      name,
      level: auth.level === "unknown" ? undefined : auth.level,
      latency_ms: Date.now() - started,
      input_summary: JSON.stringify(args).slice(0, 400),
      output_summary: JSON.stringify(result).slice(0, 600),
      ok: false,
      error: auth.reason,
      conversation_id: meta.conversation_id,
      user_id: meta.user_id,
    });
    return result;
  }
  const parsed = parseToolArgs(name, args);
  if (!parsed.ok) {
    const result = { error: parsed.error, executed: false, level };
    logAiCall(store, {
      kind: "tool",
      name,
      level: loggedLevel,
      latency_ms: Date.now() - started,
      input_summary: JSON.stringify(args).slice(0, 400),
      output_summary: JSON.stringify(result).slice(0, 600),
      ok: false,
      error: parsed.error,
      conversation_id: meta.conversation_id,
      user_id: meta.user_id,
    });
    return result;
  }
  let ok = true;
  let result: unknown;
  try {
    result = dispatch(store, name, parsed.data);
  } catch (err) {
    ok = false;
    result = { error: err instanceof Error ? err.message : "tool failed", executed: false, level };
  }
  const decisionId =
    name === "propose_payment" && result && typeof result === "object" && "execution" in (result as object)
      ? ((result as { execution?: { payment?: { policy?: { decision_id?: string } } } }).execution?.payment?.policy?.decision_id)
      : undefined;
  logAiCall(store, {
    kind: "tool",
    name,
    level: loggedLevel,
    validated_args: parsed.data,
    policy_decision_id: decisionId,
    latency_ms: Date.now() - started,
    input_summary: redactSecrets(JSON.stringify(parsed.data).slice(0, 400)),
    output_summary: redactSecrets(JSON.stringify(result).slice(0, 600)),
    ok,
    error: ok ? undefined : String((result as { error?: string }).error),
    conversation_id: meta.conversation_id,
    user_id: meta.user_id,
  });
  return result;
}

function dispatch(store: StoreData, name: string, args: Record<string, unknown>): unknown {
  const fin = store.finance;
  switch (name) {
    case "get_accounts":
      return fin.accounts.map((a) => ({
        account_id: a.account_id,
        name: a.name,
        institution: a.institution,
        type: a.type,
        balance: a.balance,
        currency: a.currency,
        demo: true,
      }));
    case "get_transactions": {
      const limit = Number(args.limit ?? 20);
      const category = typeof args.category === "string" ? args.category : null;
      return [...fin.transactions]
        .reverse()
        .filter((t) => !category || t.category === category)
        .slice(0, limit);
    }
    case "get_budget":
      return budgetProgress(fin);
    case "get_recurring":
      return {
        bills: fin.bills,
        subscriptions: store.subscriptions.map((s) => ({
          subscription_id: s.subscription_id,
          plan_name: s.plan_name,
          amount: s.amount,
          status: s.status,
          lifecycle: lifecycleOf(s),
          bill_type: s.bill_type,
          raised_this_year: (s.price_history || []).filter((c) => c.next > c.previous && c.effective_at.startsWith("2026")).length,
        })),
        scope: "Only subscriptions created through AgentPaL are listed.",
      };
    case "get_goals":
      return fin.savings_goals;
    case "check_affordability": {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount)) throw new Error("amount is required");
      return assessFromFinance(fin, amount, { requestLabel: String(args.label || "purchase") });
    }
    case "propose_payment":
      // The model can never accept trade-offs for the user: no approvalId is ever passed from here.
      return proposePaymentIntent(store, String(args.sku || ""));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/**
 * Creates a payment intent only. Policy may ALLOW, REQUIRE_APPROVAL, or DENY. Nothing is captured here.
 * Authority comes only from a user-signed mandate (never created here); trade-offs can only be accepted
 * through a server-side approval record the user created with a click (approvalId). The coach path never
 * passes an approvalId.
 */
export async function proposePaymentIntent(
  store: StoreData,
  sku: string,
  opts: { approvalId?: string; now?: Date } = {},
) {
  const found = resolveCatalogSku(store, sku);
  if (!found) throw new Error(`Unknown SKU ${sku}`);
  const { merchant, product } = found;

  // 1. Mandate first (checked for existence before anything reads its fields), signature re-verified.
  const mandate = findCoveringMandate(store, merchant, product);
  if (!mandate) {
    appendEvent(store, "coach.no_mandate", `No signed mandate covers ${product.name}; nothing was proposed.`, { sku });
    return {
      status: "no_mandate" as const,
      next_action: "show_mandate_signing_ui" as const,
      error: "no_matching_mandate",
      message: `No active signed mandate covers ${merchant.name} / ${product.category} in ${product.currency}. Sign one yourself (Coach → “Sign personal INR mandate”, or Agents → Mandates). The coach cannot create authority.`,
    };
  }

  // 2. Affordability for every currency (USD converted at the labelled demo FX rate).
  const inrAmount = toInr(product.amount, product.currency); // fixed demo FX, unsupported currencies throw
  const analysis = assessFromFinance(store.finance, inrAmount, { requestLabel: product.name });
  if (analysis.verdict === "NOT_RECOMMENDED") {
    return {
      status: "not_recommended" as const,
      error: "The affordability engine does not recommend this purchase. No payment intent was created.",
      analysis,
    };
  }
  if (analysis.verdict === "AFFORDABLE_WITH_TRADEOFFS") {
    const approval = consumeTradeoffApproval(
      store,
      opts.approvalId,
      { sku, amount: product.amount, currency: product.currency, merchant_id: merchant.merchant_id, mandate_id: mandate.mandate_id },
      opts.now,
    );
    if (!approval.ok) {
      appendEvent(store, "tradeoff.approval_rejected", `Trade-off approval ${approval.reason} for ${product.name}; nothing proposed.`, { sku, reason: approval.reason });
      return {
        status: "needs_user_approval" as const,
        next_action: "show_tradeoff_approval_ui" as const,
        approval_error: approval.reason,
        error: "This is only affordable with trade-offs. The user must accept them with the “Accept trade-offs & propose” button, which creates a single-use approval on the server. The coach cannot accept on their behalf. No intent was created.",
        analysis,
      };
    }
  }

  let goal = store.goals.find((g) => g.objective.includes(product.name));
  if (!goal) {
    goal = {
      goal_id: id("goal"),
      user_id: store.finance.profile.user_id,
      objective: `Buy ${product.name}`,
      budget: product.amount,
      currency: product.currency,
      created_at: nowIso(),
    };
    store.goals.push(goal);
  }

  const step: PlanStep = {
    step_id: id("step"),
    action: "purchase",
    merchant_id: merchant.merchant_id,
    merchant_name: merchant.name,
    category: product.category,
    amount: product.amount,
    currency: product.currency,
    rail: "paypal_sandbox",
    approval_required: product.amount > mandate.per_tx_limit,
    rationale: `Proposed ${product.name} at ${product.currency === "INR" ? formatINR(product.amount) : product.amount}. This is an intent only.`,
    product_sku: product.sku,
    recurring: product.recurring,
  };
  const plan: Plan = {
    plan_id: id("plan"),
    goal_id: goal.goal_id,
    mandate_id: mandate.mandate_id,
    steps: [step],
    planner: "ai",
    status: "approved",
    created_at: nowIso(),
  };
  store.plans.push(plan);
  appendEvent(store, "coach.proposed_payment", `Payment intent proposed for ${product.name} — policy engine will decide, nothing is captured yet.`, {
    goal_id: goal.goal_id,
    sku,
  });
  const execution = await executeStep(store, plan, step);
  if (execution.payment) {
    // Computed from the same affordability analysis that gated the proposal (INR at the demo FX rate).
    execution.payment.finance_impact = {
      verdict: analysis.verdict,
      amount: inrAmount,
      currency: "INR",
      available_to_spend: analysis.available_to_spend,
      safe_spending_limit: analysis.safe_spending_limit,
      contributions_paused: analysis.goal_impacts,
    };
  }
  return { intent_only: true, captured: false, execution };
}
