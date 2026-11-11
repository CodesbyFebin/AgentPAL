import { redactSecrets } from "@/lib/ai-permissions";
import { z } from "zod";
import { fail, ok, readJson } from "@/lib/http";
import { lookupPayPalResource, submitSandboxPayout } from "@/lib/paypal-workbench";
import { appendEvent } from "@/lib/events";
import { updateStore } from "@/lib/store";
import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["payout", "vault", "tracking"]), reference: z.string().trim().regex(/^[A-Za-z0-9_-]{2,120}$/) }),
  z.object({ kind: z.literal("send_payout"), amount: z.number().min(0.01).max(25), confirmed: z.literal(true) }),
]);

export async function POST(req: Request) {
  const parsed = operation.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Enter a valid reference or confirm a sandbox payout up to USD 25.");
  const input = parsed.data;
  if (input.kind !== "send_payout") {
    try {
      const result = await lookupPayPalResource(input.kind, input.reference);
      await updateStore((store) => appendEvent(store, "paypal.workbench.lookup", `Owner checked ${input.kind} status.`, { kind: input.kind, mode: result.mode }));
      return ok(result);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Lookup failed.", 502);
    }
  }
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || !/^[\w-]{16,100}$/.test(key)) return fail("A stable Idempotency-Key is required for a payout.");
  if (Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-8) return fail("Payout amounts use at most two decimals.");

  return withIdempotency(req, "paypal.sandbox.payout", input, async () => {
    try {
      return await updateStore(async (store) => {
        if (store.settings.kill_switch) return { status: 403, body: { error: "The kill switch blocks payouts." } };
        const result = await submitSandboxPayout(input.amount, key);
        appendEvent(store, "paypal.sandbox.payout", "Owner submitted a PayPal sandbox payout.", { amount: input.amount, currency: "USD", batch_id: result.reference });
        return { status: 201, body: result };
      });
    } catch (error) {
      return { status: 502, body: { error: redactSecrets(error instanceof Error ? error.message : "Payout failed.") } };
    }
  });
}
