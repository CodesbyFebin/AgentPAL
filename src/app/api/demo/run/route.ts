import { runScenario } from "@/lib/scenarios";
import { snapshot } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { isOwnerRequest } from "@/lib/owner-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Demo scenarios sign "Demo:" mandates, so they are owner-only at the route level too.
  if (!isOwnerRequest(req)) return fail("Only the owner can run demo scenarios.", 403);
  try {
    const url = new URL(req.url);
    const body = await readJson<{ scenario?: string }>(req);
    const name = body.scenario || url.searchParams.get("scenario") || "buy-safely";
    const demo = await runScenario(name);
    const state = await snapshot();
    return ok({ demo, state }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "demo failed", 500);
  }
}
