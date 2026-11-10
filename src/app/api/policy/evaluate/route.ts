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
    category?: string;
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
      const mandate = store.mandates.find((m) => m.mandate_id === body.mandate_id) ?? store.mandates.at(-1);
      const merchant = store.merchants.find((m) => m.merchant_id === body.merchant_id);
      if (!mandate || !merchant) throw new Error("Mandate or merchant not found");
      const amount = Number(body.amount ?? merchant.products[0].amount);
      const remaining = remainingBudget(store, mandate.mandate_id);
      return evaluatePolicy({
        mandate,
        merchant,
        amount,
        currency: merchant.products[0]?.currency || mandate.currency,
        category: body.category || merchant.category,
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
