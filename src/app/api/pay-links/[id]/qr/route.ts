import { paymentLinkQrSvg, paymentLinkUrl, syncPaymentLinkStatus } from "@/lib/pay-links";
import { fail } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const origin = new URL(req.url).origin;
  const url = await updateStore((store) => {
    const found = store.payment_links.find((l) => l.link_id === id);
    if (!found) return null;
    syncPaymentLinkStatus(store, found);
    return paymentLinkUrl(found.link_id, origin);
  });
  if (!url) return fail("Payment link not found", 404);
  const svg = await paymentLinkQrSvg(url);
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
