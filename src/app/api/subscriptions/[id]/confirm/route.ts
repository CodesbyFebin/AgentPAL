import { fail, ok } from "@/lib/http";
import { confirmSuggestedSubscription } from "@/lib/subscriptions";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const subscription = await updateStore((store) => confirmSuggestedSubscription(store, id));
    return ok({ subscription });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "confirm failed", 400);
  }
}
