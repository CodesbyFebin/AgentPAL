import { ok } from "@/lib/http";
import { ownerSessionRequired } from "@/lib/owner-session";
import { ALLOWED_PAYPAL_TOOLS, OWNER_PAYPAL_TOOLS } from "@/lib/paypal-agent-tools";
import { computeSecurityHealth } from "@/lib/security-health";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const fleet = [
  { name: "Money Coach", job: "Affordability, accounts, budgets, and payment proposals", type: "Interactive" },
  { name: "Subscription Guardian", job: "Reviews managed renewals against spending caps", type: "Event-driven" },
  { name: "AgentPaL Guard", job: "Checks signed mandates, approval decisions, and checkout evidence", type: "Policy engine" },
  { name: "Audit Monitor", job: "Validates the transaction event hash chain", type: "On demand" },
];

export async function GET() {
  const store = readStore();
  // Construction only reads the installed tool definitions. Credentials used here are placeholders.
  const { ALL_TOOLS_ENABLED, PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const toolkit = new PayPalAgentToolkit({
    clientId: "catalog-only", clientSecret: "catalog-only",
    configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } },
  });
  const tools = Object.entries(toolkit.getTools()).map(([name, tool]) => ({
    name, description: tool.description?.split("\n").find((line) => line.trim())?.trim().slice(0, 170) ?? name,
    permission: Object.hasOwn(ALLOWED_PAYPAL_TOOLS, name) ? "Coach + owner" : Object.hasOwn(OWNER_PAYPAL_TOOLS, name) ? "Owner only" : "Catalog only",
  }));
  return ok({
    ...computeSecurityHealth(store),
    fleet,
    tools,
    metrics: {
      payments: store.payments.length,
      pending: store.approvals.filter((a) => a.status === "pending").length,
      calls: store.ai_calls.length,
      blocked: store.paypal_tool_calls.filter((c) => c.decision === "BLOCKED").length,
      idempotencyKeys: store.idempotency_responses.length,
      auditEvents: store.events.length,
      verifiedWebhooks: store.webhook_receipts.filter((e) => e.verified && e.verification === "paypal").length,
    },
    secrets: ["AGENTPAL_OWNER_KEY", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "BRAINTREE_PRIVATE_KEY", "AI_API_KEY"]
      .map((name) => ({ name, configured: Boolean(process.env[name]) })),
    ownerSessionRequired: ownerSessionRequired(),
    payoutConfigured: Boolean(process.env.AGENTPAL_PAYOUT_SANDBOX_EMAIL && process.env.PAYPAL_CLIENT_SECRET),
  });
}
