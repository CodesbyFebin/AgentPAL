import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";
import { createTradeoffApproval } from "@/lib/tradeoff-approvals";

export const dynamic = "force-dynamic";

/**
 * Called only by the UI when the user clicks “Accept trade-offs & propose”. Owner role is enforced by
 * middleware (viewers get 403). Creates a single-use, 10-minute approval bound to SKU, catalog amount,
 * merchant and mandate. The coach has no tool that reaches this endpoint.
 */
export async function POST(req: Request) {
  const body = await readJson<{ sku?: string }>(req);
  if (!body.sku || typeof body.sku !== "string") return fail("sku is required");
  const result = await updateStore((store) => createTradeoffApproval(store, body.sku!));
  if (!result.ok) {
    return ok(
      { error: result.message, status: result.status, next_action: result.status === "no_mandate" ? "show_mandate_signing_ui" : undefined, message: result.message },
      result.status === "unknown_sku" ? 400 : 409,
    );
  }
  return ok({ approval: result.approval }, 201);
}
