import { publicPaymentLinkView, revokePaymentLink } from "@/lib/pay-links";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const origin = new URL(req.url).origin;
    const link = await updateStore((store) => revokePaymentLink(store, id));
    return ok({ link: publicPaymentLinkView(link, origin) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "revoke failed", 400);
  }
}
