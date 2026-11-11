/**
 * Authority tests: the model can never create mandates, choose amounts or self-approve trade-offs.
 * Everything runs through the real coach tool dispatcher (runCoachTool) and real store fixtures.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runCoachTool, proposePaymentIntent } from "@/lib/ai-tools";
import { parseToolArgs } from "@/lib/ai-permissions";
import { assessFromFinance } from "@/lib/finance-engine";
import { usdToInr } from "@/lib/money";
import { evaluatePolicy } from "@/lib/policy";
import { normalizeModelSteps } from "@/lib/planner";
import { executeStep, verifyMandateSignature } from "@/lib/engine";
import { createTradeoffApproval } from "@/lib/tradeoff-approvals";
import { signMandateTemplate } from "@/lib/user-mandates";
import { resetStore, updateStore } from "@/lib/store";
import type { Mandate, Plan, StoreData } from "@/lib/types";

beforeEach(() => resetStore());

const LAPTOP = "nova_14_65000";
type Res = { status?: string; error?: string; intent_only?: boolean; approval_error?: string; execution?: { payment?: { amount: number } } };
const dispatch = async (s: StoreData, args: Record<string, unknown>) => (await runCoachTool(s, "propose_payment", args)) as Res;

describe("no model-minted mandates", () => {
  it("propose_payment via the dispatcher returns no_mandate and creates zero mandates", async () => {
    await updateStore(async (s) => {
      const before = s.mandates.length;
      const r = await dispatch(s, { sku: LAPTOP });
      expect(r.status).toBe("no_mandate");
      expect((r as { next_action?: string }).next_action).toBe("show_mandate_signing_ui");
      expect(s.mandates.length).toBe(before);
      expect(s.events.some((e) => e.type === "mandate.signed")).toBe(false);
    });
  });

  it("no AI / toolkit / planner module references createSignedMandate (grep guard)", () => {
    const root = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(root);
    // Only user-click paths may mint authority: the signing endpoints, user templates, and the
    // user-triggered demo scenarios. Every other module — especially AI/toolkit code — must not.
    const allowed = new Set([
      "lib/engine.ts",
      "lib/user-mandates.ts",
      "lib/scenarios.ts",
      "app/api/mandates/route.ts",
    ]);
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes("createSignedMandate"))
      .map((f) => relative(root, f).split("\\\\").join("/"))
      .filter((f) => !allowed.has(f));
    expect(offenders).toEqual([]);
    for (const ai of ["lib/ai-tools.ts", "lib/ai-permissions.ts", "lib/coach-turn.ts", "lib/paypal-agent-tools.ts", "lib/planner.ts", "lib/pay-link-checkout.ts", "lib/tradeoff-approvals.ts"]) {
      expect(readFileSync(join(root, ai), "utf8")).not.toContain("createSignedMandate");
    }
  });

  it("a tampered mandate fails signature re-verification and policy denies at execution", async () => {
    await updateStore(async (s) => {
      const m = signMandateTemplate(s, "coach_paypal_tools");
      expect(verifyMandateSignature(s, m)).toBe(true);
      m.max_total_spend = 1_000_000; // widened without re-signing
      expect(verifyMandateSignature(s, m)).toBe(false);
      const merchant = s.merchants.find((x) => x.merchant_id === "merchant_001")!;
      const product = merchant.products[0];
      const plan: Plan = {
        plan_id: "p", goal_id: m.goal_id, mandate_id: m.mandate_id, planner: "offline", status: "approved", created_at: "x",
        steps: [{ step_id: "st", action: "purchase", merchant_id: merchant.merchant_id, merchant_name: merchant.name, category: product.category, amount: product.amount, currency: "USD", rail: "paypal_sandbox", approval_required: false, rationale: "t", product_sku: product.sku, recurring: false }],
      };
      const r = await executeStep(s, plan, plan.steps[0]);
      expect(r.decision.decision).toBe("DENY");
      expect(r.decision.checks[0].code).toBe("mandate_signature");
      expect(r.payment).toBeUndefined();
    });
  });
});

describe("trade-offs only via a server-side user approval", () => {
  const setup = (s: StoreData) => {
    signMandateTemplate(s, "personal_inr");
    expect(assessFromFinance(s.finance, 65000).verdict).toBe("AFFORDABLE_WITH_TRADEOFFS");
  };

  it("accept_tradeoffs is rejected by the strict schema, even alongside a valid approval_id", async () => {
    await updateStore(async (s) => {
      setup(s);
      const ok = createTradeoffApproval(s, LAPTOP);
      expect(ok.ok).toBe(true);
      const approval_id = ok.ok ? ok.approval.approval_id : "";
      expect(parseToolArgs("propose_payment", { sku: LAPTOP, accept_tradeoffs: true }).ok).toBe(false);
      const r = await dispatch(s, { sku: LAPTOP, accept_tradeoffs: true, approval_id });
      expect(r.intent_only).toBeUndefined();
      expect(String(r.error)).toMatch(/unrecognized|Unrecognized/i);
      expect(s.payments.length).toBe(0);
      // Even a schema-valid model call carries no approval: it cannot self-approve.
      const r2 = await dispatch(s, { sku: LAPTOP });
      expect(r2.status).toBe("needs_user_approval");
      expect(s.payments.length).toBe(0);
    });
  });

  it("rejects forged, replayed, expired and mismatched approvals; accepts a valid one once", async () => {
    await updateStore(async (s) => {
      setup(s);
      // forged
      let r = (await proposePaymentIntent(s, LAPTOP, { approvalId: "tradeoff_forged" })) as Res;
      expect(r.approval_error).toBe("unknown_approval");
      // forged record not created by user click
      s.tradeoff_approvals.push({ ...(createTradeoffApproval(s, LAPTOP) as { approval: never }).approval, approval_id: "tradeoff_fake", created_by: "model" as never });
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: "tradeoff_fake" })) as Res;
      expect(r.approval_error).toBe("unknown_approval");
      // expired
      const old = createTradeoffApproval(s, LAPTOP, new Date(Date.now() - 11 * 60 * 1000));
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: old.ok ? old.approval.approval_id : "" })) as Res;
      expect(r.approval_error).toBe("expired");
      // mismatched (approval for another SKU / amount)
      const other = createTradeoffApproval(s, "nova_sleeve_2499");
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: other.ok ? other.approval.approval_id : "" })) as Res;
      expect(r.approval_error).toBe("binding_mismatch");
      // tampered amount on a real record
      const tampered = createTradeoffApproval(s, LAPTOP);
      if (tampered.ok) tampered.approval.amount = 1;
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: tampered.ok ? tampered.approval.approval_id : "" })) as Res;
      expect(r.approval_error).toBe("binding_mismatch");
      expect(s.payments.length).toBe(0);
      // valid
      const good = createTradeoffApproval(s, LAPTOP);
      const id = good.ok ? good.approval.approval_id : "";
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: id })) as Res;
      expect(r.intent_only).toBe(true);
      expect(r.execution?.payment?.amount).toBe(65000);
      // replay
      r = (await proposePaymentIntent(s, LAPTOP, { approvalId: id })) as Res;
      expect(r.approval_error).toBe("already_used");
    });
  });
});

describe("USD affordability is enforced", () => {
  it("a USD purchase the INR finances cannot afford is refused via the dispatcher", async () => {
    await updateStore(async (s) => {
      signMandateTemplate(s, "coach_paypal_tools");
      const domain = s.merchants.find((m) => m.merchant_id === "merchant_002")!;
      domain.products.push({ ...domain.products[0], sku: "premium_domain_usd", name: "Premium domain", amount: 9000 });
      expect(assessFromFinance(s.finance, usdToInr(9000)).verdict).toBe("NOT_RECOMMENDED");
      const r = await dispatch(s, { sku: "premium_domain_usd" });
      expect(r.status).toBe("not_recommended");
      expect(s.payments.length).toBe(0);
    });
  });
});

describe("planner never trusts model amounts or SKUs", () => {
  const getCtx = async () => updateStore((s) => ({ merchants: s.merchants, mandate: signMandateTemplate(s, "coach_paypal_tools") as Mandate }));

  it("uses the catalog price even if the model names another amount", async () => {
    const { merchants, mandate } = await getCtx();
    const product = merchants.find((m) => m.merchant_id === "merchant_002")!.products[0];
    const { steps, skipped } = normalizeModelSteps([{ merchant_id: "merchant_002", product_sku: product.sku, amount: 0.01 }], mandate, merchants);
    expect(skipped).toEqual([]);
    expect(steps[0].amount).toBe(product.amount);
  });
  it("skips NaN / Infinity / negative amounts and unknown SKUs, buying nothing", async () => {
    const { merchants, mandate } = await getCtx();
    const sku = merchants.find((m) => m.merchant_id === "merchant_002")!.products[0].sku;
    const { steps, skipped } = normalizeModelSteps(
      [
        { merchant_id: "merchant_002", product_sku: sku, amount: NaN },
        { merchant_id: "merchant_002", product_sku: sku, amount: Infinity },
        { merchant_id: "merchant_002", product_sku: sku, amount: -5 },
        { merchant_id: "merchant_002", product_sku: "does_not_exist" },
        { merchant_id: "nope", product_sku: sku },
      ],
      mandate,
      merchants,
    );
    expect(steps).toEqual([]);
    expect(skipped.map((x) => x.reason)).toEqual(["invalid_amount", "invalid_amount", "invalid_amount", "unknown_sku", "unknown_merchant"]);
    expect(skipped[3].message).toMatch(/Skipped: unknown SKU .* nothing bought/);
  });
});

describe("policy rejects non-finite amounts", () => {
  it("denies NaN", async () => {
    await updateStore((s) => {
      const m = signMandateTemplate(s, "coach_paypal_tools");
      const merchant = s.merchants.find((x) => x.merchant_id === "merchant_002")!;
      const d = evaluatePolicy({ mandate: m, merchant, amount: NaN, category: merchant.category, recurring: false, mandateSpend: 0, killSwitch: false });
      expect(d.decision).toBe("DENY");
    });
  });
});
