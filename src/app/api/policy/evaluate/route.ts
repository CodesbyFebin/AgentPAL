import { policyForStep } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { evaluatePolicy } from "@/lib/policy";
import { remainingBudget, updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{
    mandate_id?: string;
    step_id?: string;
    merchant_id?: string;
    amount?: number;
    recurring?: boolean;
  }>(req);

  try {
    const decision = await updateStore((store) => {
      if (body.step_id) {
        const plan = store.plans.find((p) => p.steps.some((s) => s.step_id === body.step_id));
        const step = plan?.steps.find((s) => s.step_id === body.step_id);
        const mandate = store.mandates.find((m) => m.mandate_id === (body.mandate_id || plan?.mandate_id));
        if (!plan || !step || !mandate) throw new Error("Step or mandate not found");
        return policyForStep(store, mandate, step);
      }
      if (!body.mandate_id) throw new Error("mandate_id is required");
      const mandate = store.mandates.find((m) => m.mandate_id === body.mandate_id);
      const merchant = store.merchants.find((m) => m.merchant_id === body.merchant_id);
      if (!mandate || !merchant) throw new Error("Mandate or merchant not found");
      const amount = body.amount === undefined ? merchant.products[0].amount : body.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount)) throw new Error("amount must be a finite number");
      const remaining = remainingBudget(store, mandate.mandate_id);
      return evaluatePolicy({
        mandate,
        merchant,
        amount,
        currency: merchant.products[0]?.currency || mandate.currency,
        // Category always comes from the server-side merchant record, never the caller.
        category: merchant.category,
        recurring: Boolean(body.recurring),
        mandateSpend: mandate.max_total_spend - remaining,
        remainingBudget: remaining,
        killSwitch: store.settings.kill_switch,
      });
    });
    return ok({ decision });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "policy failed", 400);
  }
}
