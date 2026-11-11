import { publicPaymentLinkView, syncPaymentLinkStatus } from "@/lib/pay-links";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const origin = new URL(req.url).origin;
  const link = await updateStore((store) => {
    const found = store.payment_links.find((l) => l.link_id === id);
    if (!found) return null;
    syncPaymentLinkStatus(store, found);
    return publicPaymentLinkView(found, origin);
  });
  if (!link) return fail("Payment link not found", 404);
  return ok({ link, qr_disclaimer: link.qr_disclaimer });
}
