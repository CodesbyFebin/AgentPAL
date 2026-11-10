import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receipt = await updateStore((s) => s.receipts.find((r) => r.receipt_id === id) ?? null);
  if (!receipt) return fail("Receipt not found", 404);
  return ok({ receipt });
}
