import { readJson } from "@/lib/http";
import { guardedToolResponse } from "@/lib/paypal-tool-route";

export const dynamic = "force-dynamic";

/** Cancel a PayPal subscription through the Guard-wrapped toolkit (reason required, kill switch). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ reason?: string }>(req);
  return guardedToolResponse(req, "subscriptions.cancel", "cancel_subscription", { subscription_id: id, payload: { reason: (body.reason || "").slice(0, 128) } });
}
