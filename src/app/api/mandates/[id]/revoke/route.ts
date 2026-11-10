import { revokeMandate } from "@/lib/engine";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const mandate = await updateStore((store) => revokeMandate(store, id));
    return ok({ mandate });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "revoke failed", 400);
  }
}
