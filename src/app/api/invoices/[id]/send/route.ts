import { guardedToolResponse } from "@/lib/paypal-tool-route";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return guardedToolResponse(req, "invoices.send", "send_invoice", { invoice_id: id, send_to_recipient: true });
}
