import { generateClientToken } from "@/lib/braintree";
import { fail, ok } from "@/lib/http";
import { hasBraintreeCreds, paymentMode } from "@/lib/payment-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasBraintreeCreds()) {
    return fail("Braintree is not configured", 400);
  }
  try {
    const clientToken = await generateClientToken();
    return ok({ clientToken, paymentMode: paymentMode() });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "client token failed", 400);
  }
}
