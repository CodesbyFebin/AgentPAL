import { fail, ok, readJson } from "@/lib/http";
import { fulfillAndMaybeSettle } from "@/lib/engine";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ payment_id?: string }>(req);
  if (!body.payment_id) return fail("payment_id is required");
  try {
    const verification = await updateStore((store) => {
      const payment = store.payments.find((p) => p.payment_id === body.payment_id);
      if (!payment) throw new Error("Payment not found");
      const plan = store.plans.find((p) => p.plan_id === payment.plan_id);
      const step = plan?.steps.find((s) => s.step_id === payment.step_id);
      if (!plan || !step) throw new Error("Plan step not found");
      return fulfillAndMaybeSettle(store, payment, step);
    });
    return ok({ verification });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "verify failed", 400);
  }
}
