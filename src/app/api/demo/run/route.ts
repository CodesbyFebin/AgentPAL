import { runDemoScenario, snapshot } from "@/lib/engine";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const demo = await runDemoScenario();
    const state = await snapshot();
    return ok({ demo, state }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "demo failed", 500);
  }
}
