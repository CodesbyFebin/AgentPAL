import { startPaymentFromLink } from "@/lib/pay-link-checkout";
import { publicPaymentLinkView } from "@/lib/pay-links";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ amount?: number }>(req);
  try {
    const origin = new URL(req.url).origin;
    const result = await updateStore((store) => startPaymentFromLink(store, id, body.amount));
    if (!result.evaluation.ok) {
      const status =
        result.evaluation.code === "not_found"
          ? 404
          : result.evaluation.code === "kill_switch"
            ? 403
            : result.evaluation.code === "cap_exceeded" || result.evaluation.code === "invalid_amount"
              ? 400
              : 409;
      return fail(result.evaluation.message, status);
    }
    return ok({
      payment: result.payment,
      decision: result.decision,
      approval: result.approval,
      link: result.link ? publicPaymentLinkView(result.link, origin) : undefined,
    }, result.payment ? 201 : 200);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "pay failed", 400);
  }
}
