import { appendEvent } from "@/lib/events";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson<{ fail_delivery?: boolean }>(req);
  try {
    const merchant = await updateStore((store) => {
      const merchant = store.merchants.find((m) => m.merchant_id === id);
      if (!merchant) throw new Error("Merchant not found");
      if (typeof body.fail_delivery === "boolean") {
        merchant.fail_delivery = body.fail_delivery;
        appendEvent(
          store,
          "merchant.toggled",
          `${merchant.name} fail_delivery set to ${merchant.fail_delivery}`,
          { merchant_id: merchant.merchant_id, fail_delivery: merchant.fail_delivery },
        );
      }
      return merchant;
    });
    return ok({ merchant });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "update failed", 400);
  }
}
