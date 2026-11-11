import { fail, ok, readJson } from "@/lib/http";
import { runWebhookSim, type SimCase } from "@/lib/webhook-sim";

export const dynamic = "force-dynamic";

const CASES: SimCase[] = ["valid", "tampered", "replay", "stale", "reset"];

/** Local simulator only (scratch store, local RSA key); never touches PayPal or app data. */
export async function POST(req: Request) {
  const body = await readJson<{ case?: string }>(req);
  if (!CASES.includes(body.case as SimCase)) return fail(`case must be one of ${CASES.join(", ")}`);
  return ok(await runWebhookSim(body.case as SimCase));
}
