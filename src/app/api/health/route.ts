import { ok } from "@/lib/http";
import { paymentMode } from "@/lib/payment-mode";
import { plannerMode, paypalMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    ok: true,
    service: "moneymate-mesh",
    paymentMode: paymentMode(),
    paypalMode: paypalMode(),
    aiMode: plannerMode().planner === "ai" ? "live" : "offline",
    time: new Date().toISOString(),
  });
}
