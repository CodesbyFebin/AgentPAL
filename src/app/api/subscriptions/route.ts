import { ok } from "@/lib/http";
import { annualizedDelta, lifecycleOf, raisedThisYear } from "@/lib/subscription-metrics";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await updateStore((s) => ({
    subscriptions: s.subscriptions.map((sub) => ({
      ...sub,
      lifecycle: lifecycleOf(sub),
      raised_this_year: raisedThisYear(sub),
      annualized_delta: annualizedDelta(sub),
    })),
    reviews: s.renewal_reviews,
    disclaimer:
      "Only subscriptions created through the MoneyMate Mesh merchant integration are managed. We do not intercept every renewal across a consumer PayPal account.",
  }));
  return ok(data);
}
