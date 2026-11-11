/**
 * AgentPaL Guard wrapper around the official @paypal/agent-toolkit (Vercel AI SDK integration).
 *
 * Every toolkit call goes: allowlist -> kill switch -> (money tools) mandate policy + atomic
 * reservation -> underlying toolkit tool -> hash-chained audit event -> Ed25519-signed receipt.
 * Blocked calls never reach PayPal: the underlying tool's execute() is not called.
 *
 * Without PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET the toolkit is not constructed and the executor
 * returns results stamped `mock: true` with a MOCK notice. Nothing mock is presented as real.
 */
import { redactSecrets } from "./ai-permissions";
import { createSignedMandate } from "./engine";
import { appendEvent } from "./events";
import { canonicalJson, id, nowIso } from "./ids";
import { sha256Hex, signPayload } from "./crypto";
import { evaluatePolicy } from "./policy";
import { reserveSpend } from "./reservations";
import { paypalMode } from "./store";
import type { Mandate, PayPalToolCall, PayPalToolReceipt, PolicyCheck, StoreData } from "./types";

export const TOOLKIT_GOAL_ID = "coach_paypal_tools";

/** Minimal allowlisted subset. pay_order / refunds / payouts are deliberately NOT enabled: Coach never moves money. */
export const ALLOWED_PAYPAL_TOOLS = {
  create_order: { money: true, label: "Create PayPal order (intent only, no capture)" },
  get_order: { money: false, label: "Show PayPal order" },
  create_invoice: { money: true, label: "Create draft PayPal invoice" },
  list_invoices: { money: false, label: "List PayPal invoices" },
  show_subscription_details: { money: false, label: "Show PayPal subscription" },
} as const;

export type AllowedPayPalTool = keyof typeof ALLOWED_PAYPAL_TOOLS;

/** Toolkit configuration: only the actions above are switched on inside the toolkit too. */
export const TOOLKIT_ACTIONS = {
  orders: { create: true, get: true },
  invoices: { create: true, list: true },
  subscriptions: { show: true },
};

type ToolLike = {
  parameters?: { safeParse?: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } };
  execute?: (args: unknown, opts: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
};
export type ToolMap = Record<string, ToolLike>;

let injectedTools: ToolMap | null = null;
let liveToolsCache: { key: string; tools: ToolMap } | null = null;

/** Test hook: replace the underlying toolkit tools (spies) and force "live" mode. */
export function _setToolkitToolsForTests(tools: ToolMap | null) {
  injectedTools = tools;
}

export function agentToolkitMode(): "live" | "mock" {
  if (injectedTools) return "live";
  return paypalMode() === "sandbox" ? "live" : "mock";
}

async function underlyingTools(): Promise<ToolMap> {
  if (injectedTools) return injectedTools;
  const clientId = process.env.PAYPAL_CLIENT_ID!;
  if (liveToolsCache && liveToolsCache.key === clientId) return liveToolsCache.tools;
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: true } },
  });
  const tools = toolkit.getTools() as unknown as ToolMap;
  liveToolsCache = { key: clientId, tools };
  return tools;
}

function mockResult(tool: string, args: Record<string, unknown>, amount?: number) {
  const base = {
    mock: true,
    notice: "MOCK — PayPal sandbox credentials are not set, so no PayPal API was called.",
  };
  switch (tool) {
    case "create_order":
      return { ...base, id: `MOCK-ORDER-${id("tk")}`, status: "MOCK_CREATED", intent: "CAPTURE (toolkit default; AgentPaL never captures from Coach)", amount: amount?.toFixed(2), currency: "USD" };
    case "create_invoice":
      return { ...base, id: `MOCK-INV-${id("tk")}`, status: "MOCK_DRAFT", amount: amount?.toFixed(2), currency: "USD" };
    case "get_order":
      return { ...base, id: String(args.id || ""), status: "MOCK_UNKNOWN" };
    case "list_invoices":
      return { ...base, invoices: [] };
    case "show_subscription_details":
      return { ...base, id: String(args.subscription_id || ""), status: "MOCK_UNKNOWN" };
    default:
      return base;
  }
}

/** USD amount a money tool would create. Uses the toolkit's own argument shapes. */
export function toolAmount(tool: string, args: Record<string, unknown>): number {
  const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
  if (tool === "create_order") {
    const itemsTotal = items.reduce((s, it) => {
      const qty = Number(it.quantity ?? 1);
      const total = it.itemTotal != null ? Number(it.itemTotal) : Number(it.itemCost ?? 0) * qty;
      return s + (Number.isFinite(total) ? total : 0);
    }, 0);
    return round2(itemsTotal + Number(args.shippingCost ?? 0) - Number(args.discount ?? 0));
  }
  if (tool === "create_invoice") {
    return round2(
      items.reduce((s, it) => {
        const ua = it.unit_amount as { value?: unknown } | undefined;
        return s + Number(ua?.value ?? 0) * Number(it.quantity ?? 1);
      }, 0),
    );
  }
  return 0;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw.slice(0, 500) };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function ensureToolkitMandate(store: StoreData): Mandate {
  const existing = store.mandates.find((m) => m.goal_id === TOOLKIT_GOAL_ID && m.status === "active");
  if (existing) return existing;
  return createSignedMandate(store, {
    goal_id: TOOLKIT_GOAL_ID,
    title: "Coach PayPal tools (agent-toolkit)",
    max_total_spend: 100,
    per_tx_limit: 50,
    approved_merchants: ["merchant_001", "merchant_002"],
    allowed_categories: ["api_credits", "domain"],
    currency: "USD",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    space: "My Money",
  });
}

function toolkitCommitted(store: StoreData, mandateId: string): number {
  return store.reservations
    .filter((r) => r.mandate_id === mandateId && r.status === "reserved")
    .reduce((s, r) => s + r.amount, 0);
}

export interface GuardedToolRequest {
  tool: string;
  args: Record<string, unknown>;
  /** Merchant from the AgentPaL directory the money tool is for. Required for money tools. */
  merchant_id?: string;
  source?: PayPalToolCall["source"];
}

function summarize(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  return typeof r.id === "string" ? r.id : undefined;
}

export async function runGuardedPayPalTool(store: StoreData, req: GuardedToolRequest): Promise<PayPalToolCall> {
  const call_id = id("ptc");
  const mode = agentToolkitMode();
  const checks: PolicyCheck[] = [];
  const spec = (ALLOWED_PAYPAL_TOOLS as Record<string, { money: boolean; label: string }>)[req.tool];
  let decision: PayPalToolCall["decision"] = "EXECUTED";
  let reason = "";
  let amount: number | undefined;
  let merchantName: string | undefined;
  let reservation_id: string | undefined;
  let result: unknown;
  let invoked = false;

  if (!spec) {
    decision = "BLOCKED";
    reason = `"${req.tool}" is not on the AgentPaL Guard tool allowlist. Coach may only use: ${Object.keys(ALLOWED_PAYPAL_TOOLS).join(", ")}. Capturing or moving money always needs the human approval path.`;
    checks.push({ code: "tool_allowlist", passed: false, detail: reason });
  } else {
    checks.push({ code: "tool_allowlist", passed: true, detail: `${req.tool} is allowlisted (${spec.label}).` });
    if (store.settings.kill_switch) {
      decision = "BLOCKED";
      reason = "Kill switch is on. AgentPaL Guard blocks every PayPal tool call until a human turns it off.";
      checks.push({ code: "kill_switch", passed: false, detail: reason });
    } else {
      checks.push({ code: "kill_switch", passed: true, detail: "Kill switch is off." });
    }
  }

  if (decision === "EXECUTED" && spec?.money) {
    const mandate = ensureToolkitMandate(store);
    const merchant = store.merchants.find((m) => m.merchant_id === req.merchant_id);
    amount = toolAmount(req.tool, req.args);
    merchantName = merchant?.name;
    if (!merchant) {
      decision = "BLOCKED";
      reason = `Unknown merchant "${req.merchant_id || "(none)"}". Money tools must name a merchant from the AgentPaL directory.`;
      checks.push({ code: "merchant", passed: false, detail: reason });
    } else {
      const policy = evaluatePolicy({
        mandate,
        merchant,
        amount,
        currency: "USD",
        category: merchant.products[0]?.category || merchant.category,
        recurring: false,
        mandateSpend: toolkitCommitted(store, mandate.mandate_id),
        killSwitch: store.settings.kill_switch,
      });
      checks.push(...policy.checks);
      reason = policy.reason;
      if (policy.decision === "DENY") decision = "BLOCKED";
      else if (policy.decision === "REQUIRE_APPROVAL") decision = "NEEDS_APPROVAL";
      else {
        try {
          const r = reserveSpend(store, {
            mandate_id: mandate.mandate_id,
            intent_key: `toolkit:${req.tool}:${merchant.merchant_id}:${sha256Hex(canonicalJson(req.args)).slice(0, 16)}:${call_id}`,
            amount,
            currency: "USD",
          });
          reservation_id = r.reservation.reservation_id;
          checks.push({ code: "reservation", passed: true, detail: `Reserved USD ${amount.toFixed(2)} against the Coach tools mandate.` });
        } catch (err) {
          decision = "BLOCKED";
          reason = err instanceof Error ? err.message : "reservation failed";
          checks.push({ code: "reservation", passed: false, detail: reason });
        }
      }
    }
  }

  if (decision === "EXECUTED") {
    try {
      if (mode === "live") {
        const tools = await underlyingTools();
        const tool = tools[req.tool];
        if (!tool?.execute) throw new Error(`Toolkit tool ${req.tool} is not available`);
        let args: unknown = req.args;
        const parsed = tool.parameters?.safeParse?.(req.args);
        if (parsed && !parsed.success) throw new Error(`Invalid ${req.tool} arguments: ${parsed.error?.message?.slice(0, 200)}`);
        if (parsed?.success) args = parsed.data;
        invoked = true;
        const raw = await tool.execute(args, { toolCallId: call_id, messages: [] });
        // The toolkit returns JSON strings and reports PayPal failures as {"error": ...} instead of throwing.
        result = typeof raw === "string" ? safeParse(raw) : raw;
        const errObj = result && typeof result === "object" ? (result as { error?: { message?: string } }).error : undefined;
        if (errObj) throw new Error(`PayPal toolkit error: ${String(errObj.message || "unknown").slice(0, 200)}`);
      } else {
        invoked = true;
        result = mockResult(req.tool, req.args, amount);
      }
      if (!reason) reason = `${req.tool} allowed by AgentPaL Guard${mode === "mock" ? " (MOCK result, no PayPal call)" : ""}.`;
    } catch (err) {
      decision = "ERROR";
      reason = redactSecrets(err instanceof Error ? err.message : "toolkit call failed").slice(0, 300);
      if (reservation_id) {
        const r = store.reservations.find((x) => x.reservation_id === reservation_id);
        if (r) r.status = "released";
      }
    }
  }

  const eventType =
    decision === "EXECUTED" ? "paypal_tool.executed" : decision === "NEEDS_APPROVAL" ? "paypal_tool.needs_approval" : decision === "ERROR" ? "paypal_tool.error" : "paypal_tool.blocked";
  const args_sha256 = sha256Hex(canonicalJson(req.args));
  const event = appendEvent(
    store,
    eventType,
    `Coach PayPal tool ${req.tool}: ${decision}${decision === "BLOCKED" ? " — never reached PayPal" : ""}${mode === "mock" && invoked ? " (MOCK)" : ""}`,
    {
      call_id,
      tool: req.tool,
      merchant_id: req.merchant_id,
      amount,
      decision,
      invoked,
      mode,
      args_sha256,
      result_ref: summarize(result),
      failed_checks: checks.filter((c) => !c.passed).map((c) => c.code),
    },
  );
  const unsigned: Omit<PayPalToolReceipt, "signature"> = {
    receipt_id: id("ptr"),
    call_id,
    tool: req.tool,
    decision,
    args_sha256,
    result_ref: summarize(result),
    mode,
    event_id: event.event_id,
    event_hash: event.hash,
    created_at: nowIso(),
    public_key: store.settings.signing.publicKeyPem,
  };
  const receipt: PayPalToolReceipt = { ...unsigned, signature: signPayload(unsigned, store.settings.signing.privateKeyPem) };
  const record: PayPalToolCall = {
    call_id,
    tool: req.tool,
    source: req.source || "api",
    merchant_id: req.merchant_id,
    merchant_name: merchantName,
    amount,
    currency: amount != null ? "USD" : undefined,
    decision,
    reason,
    checks,
    invoked,
    mode,
    result,
    reservation_id,
    receipt,
    created_at: nowIso(),
  };
  store.paypal_tool_calls.push(record);
  if (store.paypal_tool_calls.length > 100) store.paypal_tool_calls.splice(0, store.paypal_tool_calls.length - 100);
  return record;
}

/* ------------------------------------------------------------------ */
/* Deterministic offline planner: turns a Coach message into a tool call */
/* ------------------------------------------------------------------ */

export function planPayPalToolFromMessage(
  store: StoreData,
  message: string,
): GuardedToolRequest | null {
  const text = message.toLowerCase();
  if (!/\bpaypal\b|\border\b|\binvoice/.test(text)) return null;
  const orderId = message.match(/\b(?:order)\s+([A-Z0-9-]{8,})\b/i)?.[1];
  if (/\b(pay|capture)\s+(the\s+)?order\b/.test(text)) {
    return { tool: "pay_order", args: { id: orderId || "UNKNOWN" }, source: "coach-offline" };
  }
  if (/\b(show|get|status)\b/.test(text) && orderId) {
    return { tool: "get_order", args: { id: orderId }, source: "coach-offline" };
  }
  if (/\blist\b.*\binvoices?\b/.test(text)) {
    return { tool: "list_invoices", args: { page: 1, page_size: 10 }, source: "coach-offline" };
  }
  const amountMatch = message.match(/\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:usd|dollars)/i);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1] || amountMatch[2]);
  const merchant = store.merchants.find((m) => {
    const first = m.name.toLowerCase().split(/\s+/)[0];
    return text.includes(m.name.toLowerCase()) || (first.length > 3 && text.includes(first));
  });
  const product = merchant?.products[0];
  const itemName = product?.name || "Item";
  if (/\binvoice/.test(text)) {
    return {
      tool: "create_invoice",
      merchant_id: merchant?.merchant_id,
      source: "coach-offline",
      args: {
        detail: { currency_code: "USD", note: "Draft created by AgentPaL Coach (agent on behalf of user)" },
        items: [{ name: itemName, quantity: "1", unit_amount: { currency_code: "USD", value: amount.toFixed(2) } }],
      },
    };
  }
  return {
    tool: "create_order",
    merchant_id: merchant?.merchant_id,
    source: "coach-offline",
    args: {
      currencyCode: "USD",
      items: [{ name: itemName, quantity: 1, itemCost: amount, taxPercent: 0, itemTotal: amount }],
      notes: "Proposed by AgentPaL Coach; no capture without human approval",
    },
  };
}

export function describeToolCall(call: PayPalToolCall): string {
  const head = `PayPal agent-toolkit · ${call.tool} → ${call.decision}${call.mode === "mock" && call.invoked ? " (MOCK — no PayPal API call)" : ""}`;
  const who = call.merchant_name ? ` for ${call.merchant_name}` : "";
  const amt = call.amount != null ? ` · USD ${call.amount.toFixed(2)}` : "";
  const ref = call.invoked && call.result && typeof call.result === "object" && "id" in (call.result as object) ? `\nResult id: ${(call.result as { id: string }).id}` : "";
  return `${head}${who}${amt}\nAgentPaL Guard: ${call.reason}${ref}\nSigned receipt ${call.receipt.receipt_id} · audit ${call.receipt.event_hash.slice(0, 12)}…`;
}

/** Scripted Guard demo used by the Coach card and the video: one allowed, two blocked. */
export const TOOLKIT_DEMO_PROMPTS = [
  "Create a PayPal order for $12 at Nameforge Domains",
  "Create a PayPal order for $49 at ShadowCart Instant Buys",
  "Pay order 5O190127TN364715T now",
];
