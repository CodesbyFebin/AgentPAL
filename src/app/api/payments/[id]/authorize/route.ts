import { completePaypalAfterBuyer } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ order_id?: string }>(req);
  try {
    const payment = await updateStore((store) =>
      completePaypalAfterBuyer(store, id, body.order_id),
    );
    return ok({ payment });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "authorize failed", 400);
  }
}
