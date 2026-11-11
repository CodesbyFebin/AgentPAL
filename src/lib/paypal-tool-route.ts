import { withIdempotency } from "./idempotency";
import { runGuardedPayPalTool } from "./paypal-agent-tools";
import { updateStore } from "./store";

/** Run an owner-UI toolkit call through AgentPaL Guard, with optional Idempotency-Key replay. */
export function guardedToolResponse(req: Request, scope: string, tool: string, args: Record<string, unknown>, merchant_id?: string) {
  return withIdempotency(req, scope, { tool, args, merchant_id }, async () => {
    const call = await updateStore((store) => runGuardedPayPalTool(store, { tool, args, merchant_id, source: "api" }));
    const status = call.decision === "EXECUTED" ? 200 : call.decision === "NEEDS_APPROVAL" ? 202 : call.decision === "BLOCKED" ? 422 : 502;
    return { status, body: { call } };
  });
}

/** Read-only toolkit call (no idempotency needed) — still Guard-checked and audited. */
export async function guardedRead(tool: string, args: Record<string, unknown>) {
  return updateStore((store) => runGuardedPayPalTool(store, { tool, args, source: "api" }));
}
