import { ok } from "@/lib/http";
import { paypalMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Public PayPal JS SDK config. The client ID is public by design; the secret never leaves the server
 * and is never placed in a NEXT_PUBLIC_* variable.
 */
export async function GET() {
  const mode = paypalMode();
  return ok({
    mode,
    clientId: mode === "sandbox" ? process.env.PAYPAL_CLIENT_ID : null,
    environment: "sandbox",
    currency: "USD",
    intent: "authorize",
  });
}
