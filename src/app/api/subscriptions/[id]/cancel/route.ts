import { fail, ok, readJson } from "@/lib/http";
import { cancelManagedSubscription } from "@/lib/subscriptions";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ reason?: string }>(req);
  try {
    const subscription = await updateStore((store) =>
      cancelManagedSubscription(store, id, body.reason || "Cancelled by the user from MoneyMate Mesh."),
    );
    return ok({ subscription });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "cancel failed", 400);
  }
}
