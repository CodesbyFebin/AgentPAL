import { NextResponse } from "next/server";
import { fail, ok, readJson } from "@/lib/http";
import { guardedRead } from "@/lib/paypal-tool-route";
import { PLAN_MONTHLY_CAP_USD, planMonthlyUsd, runGuardedPayPalTool } from "@/lib/paypal-agent-tools";
import { withIdempotency } from "@/lib/idempotency";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const call = await guardedRead("list_subscription_plans", { page: 1, page_size: 20 });
  return ok({ call });
}

/**
 * Create a monthly plan: create_product then create_subscription_plan, both through AgentPaL Guard.
 * The Scenario B subscription guardian cap (USD 30/month) applies to the plan price.
 */
export async function POST(req: Request) {
  const body = await readJson<{ name?: string; monthly_usd?: number }>(req);
  const price = body.monthly_usd;
  if (typeof price !== "number" || !Number.isFinite(price)) return fail("monthly_usd must be a finite number");
  const name = (body.name || "AgentPaL demo plan").slice(0, 100);
  const res: NextResponse = await withIdempotency(req, "plans.create", body, async () => {
    const out = await updateStore(async (store) => {
      const planArgs = {
        name,
        description: "Created with AgentPaL (independent project built on PayPal APIs)",
        billing_cycles: [
          { frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: "USD", value: price.toFixed(2) } } },
        ],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
      };
      // Guard the plan price first so an over-cap plan never even creates a product.
      const monthly = planMonthlyUsd(planArgs);
      if (store.settings.kill_switch || !Number.isFinite(monthly) || monthly <= 0 || monthly > PLAN_MONTHLY_CAP_USD) {
        // Audited Guard decision (BLOCKED / NEEDS_APPROVAL); the toolkit is never invoked.
        const plan = await runGuardedPayPalTool(store, { tool: "create_subscription_plan", args: { ...planArgs, product_id: "NOT_CREATED" }, source: "api" });
        return { product: null, plan };
      }
      const product = await runGuardedPayPalTool(store, { tool: "create_product", args: { name, type: "SERVICE" }, source: "api" });
      const productId = product.result && typeof product.result === "object" ? (product.result as { id?: string }).id : undefined;
      if (product.decision !== "EXECUTED" || !productId) return { product, plan: null };
      const plan = await runGuardedPayPalTool(store, { tool: "create_subscription_plan", args: { ...planArgs, product_id: productId }, source: "api" });
      return { product, plan };
    });
    const decision = out.plan?.decision || out.product?.decision;
    const status = decision === "EXECUTED" ? 200 : decision === "NEEDS_APPROVAL" ? 202 : decision === "BLOCKED" ? 422 : 502;
    return { status, body: out };
  });
  return res;
}
