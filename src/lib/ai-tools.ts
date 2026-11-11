import { PIXELFORGE_ID } from "./catalog";
import { appendEvent } from "./events";
import { assessFromFinance, budgetProgress } from "./finance-engine";
import { createSignedMandate, executeStep } from "./engine";
import { id, nowIso } from "./ids";
import { logAiCall } from "./ai-log";
import { authorizeTool, levelForTool, parseToolArgs, redactSecrets } from "./ai-permissions";
import { formatINR } from "./money";
import { lifecycleOf } from "./subscription-metrics";
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
      description: "Create a payment intent for the AgentPaL Guard policy engine. Never captures or sends money. A human still has to approve if policy requires it.",
      parameters: {
        type: "object",
        properties: {
          sku: { type: "string" },
          accept_tradeoffs: { type: "boolean" },
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
      return proposePaymentIntent(store, String(args.sku || "nova_14_65000"), Boolean(args.accept_tradeoffs));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/** Creates a payment intent only. Policy may ALLOW, REQUIRE_APPROVAL, or DENY. Nothing is captured here. */
export async function proposePaymentIntent(store: StoreData, sku: string, acceptTradeoffs: boolean) {
  const merchant = store.merchants.find((m) => m.products.some((p) => p.sku === sku));
  const product = merchant?.products.find((p) => p.sku === sku);
  if (!merchant || !product) throw new Error(`Unknown SKU ${sku}`);

  if (product.currency === "INR") {
    const analysis = assessFromFinance(store.finance, product.amount, { requestLabel: product.name });
    if (analysis.verdict === "NOT_RECOMMENDED") {
      return { error: "The affordability engine does not recommend this purchase. No payment intent was created.", analysis };
    }
    if (analysis.verdict === "AFFORDABLE_WITH_TRADEOFFS" && !acceptTradeoffs) {
      return {
        error: "This is only affordable with trade-offs. Pass accept_tradeoffs=true if the user agrees, otherwise no intent is created.",
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

  let mandate = store.mandates.find(
    (m) =>
      m.status === "active" &&
      m.currency === product.currency &&
      m.approved_merchants.includes(merchant.merchant_id) &&
      m.allowed_categories.includes(product.category),
  );
  if (!mandate) {
    mandate = createSignedMandate(store, {
      goal_id: goal.goal_id,
      title: product.currency === "INR" ? "Personal INR purchases" : "Agent purchases",
      max_total_spend: Math.max(product.amount, 80000),
      per_tx_limit: product.currency === "INR" ? 10000 : 10,
      approved_merchants: [merchant.merchant_id, PIXELFORGE_ID],
      allowed_categories: [product.category, "electronics", "accessories"],
      currency: product.currency,
      minimum_balance: product.currency === "INR" ? store.finance.profile.emergency_buffer : 0,
    });
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
    rationale: `Coach proposed ${product.name} at ${product.currency === "INR" ? formatINR(product.amount) : product.amount}. This is an intent only.`,
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
  if (product.currency === "INR" && execution.payment) {
    execution.payment.finance_impact = {
      verdict: "AFFORDABLE_WITH_TRADEOFFS",
      amount: product.amount,
      currency: "INR",
      available_to_spend: 0,
      safe_spending_limit: 0,
      contributions_paused: assessFromFinance(store.finance, product.amount).goal_impacts,
    };
  }
  return { intent_only: true, captured: false, execution };
}
