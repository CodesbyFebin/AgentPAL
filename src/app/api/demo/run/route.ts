import { runScenario } from "@/lib/scenarios";
import { snapshot } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
