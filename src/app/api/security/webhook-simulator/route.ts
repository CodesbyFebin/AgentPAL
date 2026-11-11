import { z } from "zod";
import { fail, ok, readJson } from "@/lib/http";
import { readStore } from "@/lib/store";
import { intakePayPalWebhook, WEBHOOK_MAX_AGE_MS } from "@/lib/webhook-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = z.object({ scenario: z.enum(["valid", "invalid", "stale", "duplicate", "missing_headers"]) })
    .safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Select a webhook simulation scenario.");
  const { scenario } = parsed.data;
  const now = Date.now();
  const store = structuredClone(readStore());
  const event = { id: crypto.randomUUID(), event_type: "PAYMENT.CAPTURE.COMPLETED" };
  const headers = {
    transmissionId: crypto.randomUUID(),
    transmissionSig: scenario === "missing_headers" ? "" : "simulated",
    transmissionTime: new Date(scenario === "stale" ? now - WEBHOOK_MAX_AGE_MS - 1 : now).toISOString(),
    certUrl: "https://api-m.sandbox.paypal.com/demo",
    authAlgo: "SHA256withRSA",
  };
  const options = { now, webhookId: "simulator", verifier: async () => ({ ok: scenario !== "invalid", status: scenario === "invalid" ? "FAILURE" : "SUCCESS" }) };
  const result = await intakePayPalWebhook(store, headers, event, options);
  const outcome = scenario === "duplicate" ? await intakePayPalWebhook(store, headers, event, options) : result;
  return ok({ simulated: true, providerCalled: false, persisted: false, status: outcome.status, result: outcome.body.result });
}
