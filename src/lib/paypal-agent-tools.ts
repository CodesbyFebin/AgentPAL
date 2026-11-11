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
import { appendEvent } from "./events";
import { canonicalJson, id, nowIso } from "./ids";
import { sha256Hex, signPayload } from "./crypto";
import { evaluatePolicy } from "./policy";
import { reserveSpend } from "./reservations";
import { paypalMode } from "./store";
import type { Mandate, PayPalToolCall, PayPalToolReceipt, PolicyCheck, StoreData } from "./types";

export const TOOLKIT_GOAL_ID = "coach_paypal_tools";

type ToolKind = "money" | "read" | "mutate" | "invoice" | "plan";
type ToolSpec = { kind: ToolKind; label: string };

/** Coach's minimal allowlist. pay_order / refunds / payouts are deliberately NOT here: Coach never moves money. */
export const ALLOWED_PAYPAL_TOOLS: Record<string, ToolSpec> = {
  create_order: { kind: "money", label: "Create PayPal order (intent only, no capture)" },
  get_order: { kind: "read", label: "Show PayPal order" },
  list_invoices: { kind: "read", label: "List PayPal invoices" },
  show_subscription_details: { kind: "read", label: "Show PayPal subscription" },
};

/** Owner-only tools used by the Invoices / Plans / Disputes screens (owner role enforced in middleware). */
export const OWNER_PAYPAL_TOOLS: Record<string, ToolSpec> = {
  ...ALLOWED_PAYPAL_TOOLS,
  create_invoice: { kind: "invoice", label: "Create draft PayPal invoice" },
  send_invoice: { kind: "mutate", label: "Send PayPal invoice" },
  list_disputes: { kind: "read", label: "List PayPal disputes" },
  get_dispute: { kind: "read", label: "Show PayPal dispute" },
  list_subscription_plans: { kind: "read", label: "List PayPal subscription plans" },
  create_product: { kind: "mutate", label: "Create PayPal catalog product" },
  create_subscription_plan: { kind: "plan", label: "Create PayPal subscription plan" },
  cancel_subscription: { kind: "mutate", label: "Cancel PayPal subscription" },
};

export type AllowedPayPalTool = keyof typeof ALLOWED_PAYPAL_TOOLS;

/** Scenario B subscription guardian cap, applied to new plans (USD per month). */
export const PLAN_MONTHLY_CAP_USD = 30;
/** Largest invoice the owner UI may draft without approval. */
export const INVOICE_CAP_USD = 500;

/** Toolkit configuration: only the actions above are switched on inside the toolkit too. */
export const TOOLKIT_ACTIONS = {
  orders: { create: true, get: true },
  invoices: { create: true, list: true, send: true },
  subscriptions: { show: true, cancel: true },
  subscriptionPlans: { create: true, list: true },
  products: { create: true },
  disputes: { list: true, get: true },
};

/** Clearly labelled demo disputes shown only when PayPal creds are absent. */
export const DEMO_DISPUTES = [
  {
    dispute_id: "DEMO-PP-D-1001",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "12.00" },
    create_time: "2026-11-09T10:15:00Z",
    demo: true,
    label: "DEMO DATA — seeded example, not from PayPal",
  },
  {
    dispute_id: "DEMO-PP-D-1002",
    reason: "UNAUTHORISED",
    status: "RESOLVED",
    dispute_amount: { currency_code: "USD", value: "8.00" },
    create_time: "2026-11-02T08:40:00Z",
    demo: true,
    label: "DEMO DATA — seeded example, not from PayPal",
  },
];

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

function mockResult(store: StoreData, tool: string, args: Record<string, unknown>, amount?: number) {
  const base = {
    mock: true,
    notice: "MOCK — PayPal sandbox credentials are not set, so no PayPal API was called.",
  };
  const now = nowIso();
  switch (tool) {
    case "create_order":
      return { ...base, id: `MOCK-ORDER-${id("tk")}`, status: "MOCK_CREATED", intent: "CAPTURE (toolkit default; AgentPaL never captures from Coach)", amount: amount?.toFixed(2), currency: "USD" };
    case "create_invoice": {
      const recipient = invoiceRecipient(args);
      const inv = { id: `MOCK-INV-${id("tk")}`, mock: true as const, kind: "invoice" as const, status: "MOCK_DRAFT", amount: amount?.toFixed(2), currency: "USD" as const, recipient, name: String((args.items as Array<{ name?: string }> | undefined)?.[0]?.name || "Invoice"), created_at: now };
      store.paypal_mock.invoices.push(inv);
      return { ...base, ...inv };
    }
    case "send_invoice": {
      const inv = store.paypal_mock.invoices.find((i) => i.id === args.invoice_id);
      if (!inv) return { ...base, error: { message: "MOCK invoice not found" } };
      inv.status = "MOCK_SENT";
      return { ...base, id: inv.id, status: inv.status };
    }
    case "list_invoices":
      return { ...base, items: [...store.paypal_mock.invoices].reverse() };
    case "get_order":
      return { ...base, id: String(args.id || ""), status: "MOCK_UNKNOWN" };
    case "show_subscription_details":
      return { ...base, id: String(args.subscription_id || ""), status: "MOCK_UNKNOWN" };
    case "cancel_subscription":
      return { ...base, id: String(args.subscription_id || ""), status: "MOCK_CANCELLED" };
    case "create_product": {
      const prod = { id: `MOCK-PROD-${id("tk")}`, mock: true as const, kind: "product" as const, status: "MOCK_CREATED", name: String(args.name || "Product"), created_at: now };
      store.paypal_mock.products.push(prod);
      return { ...base, ...prod };
    }
    case "create_subscription_plan": {
      const plan = { id: `MOCK-PLAN-${id("tk")}`, mock: true as const, kind: "plan" as const, status: "MOCK_ACTIVE", name: String(args.name || "Plan"), amount: amount?.toFixed(2), currency: "USD" as const, created_at: now };
      store.paypal_mock.plans.push(plan);
      return { ...base, ...plan };
    }
    case "list_subscription_plans":
      return { ...base, plans: [...store.paypal_mock.plans].reverse() };
    case "list_disputes":
      return { ...base, items: DEMO_DISPUTES };
    case "get_dispute":
      return { ...base, ...(DEMO_DISPUTES.find((d) => d.dispute_id === args.dispute_id) || { error: { message: "MOCK dispute not found" } }) };
    default:
      return base;
  }
}

function invoiceRecipient(args: Record<string, unknown>): string | undefined {
  const r = (args.primary_recipients as Array<{ billing_info?: { email_address?: string } }> | undefined)?.[0];
  return r?.billing_info?.email_address;
}

/** Monthly USD price of a plan from the toolkit's create_subscription_plan arguments. */
export function planMonthlyUsd(args: Record<string, unknown>): number {
  const cycles = (args.billing_cycles as Array<Record<string, unknown>> | undefined) || [];
  const regular = cycles.find((c) => c.tenure_type === "REGULAR") || cycles[0];
  if (!regular) return NaN;
  const price = Number((regular.pricing_scheme as { fixed_price?: { value?: unknown } } | undefined)?.fixed_price?.value);
  const freq = (regular.frequency as { interval_unit?: string; interval_count?: number } | undefined) || {};
  const count = Number(freq.interval_count ?? 1) || 1;
  const perMonth: Record<string, number> = { DAY: 365 / 12, WEEK: 52 / 12, MONTH: 1, YEAR: 1 / 12 };
  const factor = perMonth[String(freq.interval_unit || "MONTH")];
  if (!factor) return NaN;
  return round2((price * factor) / count);
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

/** Finds the user-signed Coach tools mandate. Never creates one: authority comes only from a user click. */
export function findToolkitMandate(store: StoreData): Mandate | undefined {
  return store.mandates.find((m) => m.goal_id === TOOLKIT_GOAL_ID && m.status === "active");
}

/** Every order line must be a catalog product of the merchant at its catalog USD price. */
function offCatalogItem(merchant: { products: Array<{ name: string; amount: number; currency: string }> }, args: Record<string, unknown>): string | null {
  const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
  if (!items.length) return "no items";
  for (const it of items) {
    const p = merchant.products.find((x) => x.name === it.name);
    if (!p) return `"${String(it.name)}" is not in this merchant's catalog`;
    if (p.currency !== "USD") return `"${p.name}" is priced in ${p.currency}; toolkit orders are USD only`;
    const cost = Number(it.itemCost);
    const qty = Number(it.quantity ?? 1);
    const total = it.itemTotal != null ? Number(it.itemTotal) : cost * qty;
    if (cost !== p.amount || Math.abs(total - p.amount * qty) > 1e-9 || !Number.isInteger(qty) || qty < 1) {
      return `"${p.name}" must be USD ${p.amount.toFixed(2)} per unit`;
    }
  }
  if (Number(args.discount ?? 0) !== 0 || Number(args.shippingCost ?? 0) !== 0) return "discounts and shipping are not allowed on agent orders";
  return null;
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
  const allowlist = req.source === "api" ? OWNER_PAYPAL_TOOLS : ALLOWED_PAYPAL_TOOLS;
  const spec = allowlist[req.tool];
  let decision: PayPalToolCall["decision"] = "EXECUTED";
  let reason = "";
  let amount: number | undefined;
  let merchantName: string | undefined;
  let reservation_id: string | undefined;
  let result: unknown;
  let invoked = false;

  if (!spec) {
    decision = "BLOCKED";
    reason = `"${req.tool}" is not on the AgentPaL Guard tool allowlist. Allowed here: ${Object.keys(allowlist).join(", ")}. Capturing or moving money always needs the human approval path.`;
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

  if (decision === "EXECUTED" && spec?.kind === "invoice") {
    amount = toolAmount(req.tool, req.args);
    if (!Number.isFinite(amount) || amount <= 0) {
      decision = "BLOCKED";
      reason = "Invoice total must be a finite amount greater than zero.";
    } else if (!invoiceRecipient(req.args)) {
      decision = "BLOCKED";
      reason = "An invoice needs a recipient email address.";
    } else if (amount > INVOICE_CAP_USD) {
      decision = "NEEDS_APPROVAL";
      reason = `USD ${amount.toFixed(2)} is over the USD ${INVOICE_CAP_USD} invoice cap. A human must approve.`;
    } else {
      reason = `Invoice of USD ${amount.toFixed(2)} is within the USD ${INVOICE_CAP_USD} cap.`;
    }
    checks.push({ code: "invoice_cap", passed: decision === "EXECUTED", detail: reason });
  }

  if (decision === "EXECUTED" && spec?.kind === "plan") {
    amount = planMonthlyUsd(req.args);
    if (!Number.isFinite(amount) || amount <= 0) {
      decision = "BLOCKED";
      reason = "Plan price must be a finite amount greater than zero with a DAY/WEEK/MONTH/YEAR interval.";
    } else if (amount > PLAN_MONTHLY_CAP_USD) {
      decision = "NEEDS_APPROVAL";
      reason = `USD ${amount.toFixed(2)}/month is over the subscription guardian cap of USD ${PLAN_MONTHLY_CAP_USD}/month (Scenario B). A human must approve.`;
    } else {
      reason = `USD ${amount.toFixed(2)}/month is within the subscription guardian cap of USD ${PLAN_MONTHLY_CAP_USD}/month.`;
    }
    checks.push({ code: "subscription_guardian_cap", passed: decision === "EXECUTED", detail: reason });
  }

  if (decision === "EXECUTED" && req.tool === "cancel_subscription") {
    const why = String((req.args.payload as { reason?: unknown } | undefined)?.reason || "").trim();
    if (why.length < 3) {
      decision = "BLOCKED";
      reason = "Cancelling a subscription needs a reason (at least 3 characters).";
      checks.push({ code: "reason", passed: false, detail: reason });
    }
  }

  if (decision === "EXECUTED" && spec?.kind === "money") {
    const mandate = findToolkitMandate(store);
    const merchant = store.merchants.find((m) => m.merchant_id === req.merchant_id);
    amount = toolAmount(req.tool, req.args);
    merchantName = merchant?.name;
    const offCatalog = merchant ? offCatalogItem(merchant, req.args) : null;
    if (!mandate) {
      decision = "BLOCKED";
      reason = "No signed Coach PayPal tools mandate. The user must sign one (Coach → PayPal agent tools → Sign mandate); agents cannot create authority.";
      checks.push({ code: "mandate", passed: false, detail: reason });
    } else if (merchant && offCatalog) {
      decision = "BLOCKED";
      reason = `Amounts must come from the merchant catalog, not the model: ${offCatalog}`;
      checks.push({ code: "catalog_price", passed: false, detail: reason });
    } else if (!merchant) {
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
        result = mockResult(store, req.tool, req.args, amount);
        const mockErr = (result as { error?: { message?: string } }).error;
        if (mockErr) throw new Error(String(mockErr.message));
      }
      if (!reason) reason = `${req.tool} allowed by AgentPaL Guard.`;
      if (mode === "mock") reason += " MOCK result — no PayPal call.";
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
  const merchant = store.merchants.find((m) => {
    const first = m.name.toLowerCase().split(/\s+/)[0];
    return text.includes(m.name.toLowerCase()) || (first.length > 3 && text.includes(first));
  });
  if (/\binvoice/.test(text)) {
    // Coach cannot draft invoices: the amount would be model-chosen. Owner UI only.
    return { tool: "create_invoice", args: {}, source: "coach-offline" };
  }
  if (!/\border\b/.test(text) || !merchant) return null;
  // The amount always comes from the merchant catalog. Any number in the message is ignored.
  const product = merchant.products.find((p) => p.currency === "USD") || merchant.products[0];
  return {
    tool: "create_order",
    merchant_id: merchant.merchant_id,
    source: "coach-offline",
    args: {
      currencyCode: "USD",
      items: [{ name: product.name, quantity: 1, itemCost: product.amount, taxPercent: 0, itemTotal: product.amount }],
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
