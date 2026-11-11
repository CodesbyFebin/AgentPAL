/**
 * AI Agent Mesh: the real PayPal agent-toolkit tool catalogue (introspected offline with placeholder
 * credentials that never authenticate or execute anything), annotated with the AgentPaL Guard policy for
 * each tool, plus the declarative agent fleet. Nothing here can create mandates, set amounts or approve.
 */
import { ALLOWED_PAYPAL_TOOLS, INVOICE_CAP_USD, OWNER_PAYPAL_TOOLS, PLAN_MONTHLY_CAP_USD, agentToolkitMode } from "./paypal-agent-tools";

export type GuardStatus = "coach_allowed" | "owner_only" | "not_enabled";

export interface MeshTool {
  name: string;
  description: string;
  guard: GuardStatus;
  kind?: string;
  guardrails: string[];
}

const INTROSPECT_ACTIONS = {
  orders: { create: true, get: true, capture: true },
  invoices: { create: true, list: true, get: true, send: true, sendReminder: true, cancel: true, generateQRC: true },
  products: { create: true, list: true, show: true, update: true },
  subscriptionPlans: { create: true, list: true, show: true },
  subscriptions: { create: true, show: true, cancel: true, update: true },
  shipment: { create: true, get: true },
  disputes: { list: true, get: true, create: true },
  transactions: { list: true },
};

const NOT_ENABLED_REASON: Record<string, string> = {
  pay_order: "Captures money. Never available to any agent; capture only happens in AgentPaL's verified authorize → capture path after human approval.",
  accept_dispute_claim: "Concedes a dispute (moves money). Human-only, not wired.",
  create_subscription: "Would start recurring billing for a buyer. Not part of the demo.",
  update_subscription: "Would change recurring billing. Not part of the demo.",
  create_shipment_tracking: "Shipment tracking is not part of the demo.",
  get_shipment_tracking: "Shipment tracking is not part of the demo.",
  list_transactions: "Account-wide transaction export. Not exposed to agents.",
};

let cache: { name: string; description: string }[] | null = null;

async function introspectToolkit(): Promise<{ tools: { name: string; description: string }[]; source: "toolkit" | "fallback" }> {
  if (cache) return { tools: cache, source: "toolkit" };
  try {
    const mod = (await import("@paypal/agent-toolkit/ai-sdk")) as unknown as {
      PayPalAgentToolkit: new (o: unknown) => { getTools(): Record<string, { description?: string }> };
    };
    // Placeholder credentials: getTools() only builds the schema catalogue; nothing is invoked.
    const tk = new mod.PayPalAgentToolkit({
      clientId: "introspection-only",
      clientSecret: "introspection-only",
      configuration: { actions: INTROSPECT_ACTIONS, context: { sandbox: true } },
    });
    cache = Object.entries(tk.getTools()).map(([name, t]) => ({
      name,
      description: String(t.description || "").replace(/\s+/g, " ").trim().split(". ")[0].slice(0, 160),
    }));
    return { tools: cache, source: "toolkit" };
  } catch {
    const names = [...Object.keys(ALLOWED_PAYPAL_TOOLS), ...Object.keys(OWNER_PAYPAL_TOOLS), ...Object.keys(NOT_ENABLED_REASON)];
    return { tools: names.map((name) => ({ name, description: "" })), source: "fallback" };
  }
}

function guardrailsFor(name: string): { guard: GuardStatus; kind?: string; guardrails: string[] } {
  const base = ["Kill switch blocks the call before it reaches PayPal", "Hash-chained audit event + Ed25519-signed receipt"];
  const coach = ALLOWED_PAYPAL_TOOLS[name];
  const owner = OWNER_PAYPAL_TOOLS[name];
  const spec = coach || owner;
  if (!spec) return { guard: "not_enabled", guardrails: [NOT_ENABLED_REASON[name] || "Not enabled in AgentPaL's toolkit configuration."] };
  const g = [...base];
  if (spec.kind === "money") {
    g.unshift(
      "Needs a user-signed Coach tools mandate (USD 100 total / 50 per tx, 2 merchants)",
      "Line items must match the merchant's server catalog price; amounts from the model are ignored",
      "Atomic budget reservation before the call; released on error",
    );
  }
  if (spec.kind === "invoice") g.unshift(`Owner role only; capped at USD ${INVOICE_CAP_USD}; recipient email required`);
  if (spec.kind === "plan") g.unshift(`Owner role only; plan must stay within the USD ${PLAN_MONTHLY_CAP_USD}/month subscription guardian cap`);
  if (spec.kind === "mutate") g.unshift(name === "cancel_subscription" ? "Owner role only; reason required" : "Owner role only");
  if (spec.kind === "read" && !coach) g.unshift("Owner role only (read)");
  if (spec.kind === "read" && coach) g.unshift("Read-only");
  return { guard: coach ? "coach_allowed" : "owner_only", kind: spec.kind, guardrails: g };
}

export const AGENT_FLEET = [
  {
    id: "coach",
    name: "AgentPaL Coach",
    role: "Explains affordability; proposes payment intents; calls Coach-allowlisted toolkit tools",
    planner: "deterministic offline planner (AI model only when AI_API_KEY is set)",
    tools: Object.keys(ALLOWED_PAYPAL_TOOLS),
    can_create_mandates: false,
    can_choose_amounts: false,
    can_self_approve: false,
    can_capture: false,
    authority: "User-signed mandate only (Coach → Sign mandate)",
  },
  {
    id: "launch-buyer",
    name: "Launch buyer (Scenario A)",
    role: "Buys API credits + a domain under a $50 mandate; ≤ $10 auto, above needs approval",
    planner: "offline rule planner; catalog SKUs and prices only",
    tools: ["executeStep → Guard policy → authorize → verify → capture"],
    can_create_mandates: false,
    can_choose_amounts: false,
    can_self_approve: false,
    can_capture: false,
    authority: "Demo: mandate signed by the owner's Run click",
  },
  {
    id: "subscription-guardian",
    name: "Subscription guardian (Scenario B)",
    role: "Reviews renewals against a $30/month cap; flags ≥10% price rises; cancels unauthorized subs",
    planner: "deterministic renewal rules",
    tools: ["cancel_subscription (owner API)", "list_subscription_plans"],
    can_create_mandates: false,
    can_choose_amounts: false,
    can_self_approve: false,
    can_capture: false,
    authority: "Demo: subscription mandate signed by the owner's Run click",
  },
  {
    id: "guard",
    name: "AgentPaL Guard",
    role: "Deterministic policy engine every agent call passes through: ALLOW / REQUIRE_APPROVAL / DENY",
    planner: "none — pure rules",
    tools: ["evaluatePolicy", "reserveSpend", "appendEvent", "signPayload"],
    can_create_mandates: false,
    can_choose_amounts: false,
    can_self_approve: false,
    can_capture: false,
    authority: "Verifies mandate signatures on every execution",
  },
];

export async function agentMeshView() {
  const { tools, source } = await introspectToolkit();
  const library: MeshTool[] = tools.map((t) => ({ ...t, ...guardrailsFor(t.name) }));
  const order: Record<GuardStatus, number> = { coach_allowed: 0, owner_only: 1, not_enabled: 2 };
  library.sort((a, b) => order[a.guard] - order[b.guard] || a.name.localeCompare(b.name));
  return {
    mode: agentToolkitMode(),
    catalogue_source: source,
    toolkit_version: "@paypal/agent-toolkit 1.11.0",
    library,
    counts: {
      total: library.length,
      coach_allowed: library.filter((t) => t.guard === "coach_allowed").length,
      owner_only: library.filter((t) => t.guard === "owner_only").length,
      not_enabled: library.filter((t) => t.guard === "not_enabled").length,
    },
    fleet: AGENT_FLEET,
  };
}
