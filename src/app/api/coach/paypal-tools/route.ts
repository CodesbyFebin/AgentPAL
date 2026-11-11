import { coachTurn } from "@/lib/coach-turn";
import { fail, ok, readJson } from "@/lib/http";
import { ALLOWED_PAYPAL_TOOLS, TOOLKIT_DEMO_PROMPTS, agentToolkitMode } from "@/lib/paypal-agent-tools";
import { readStore, updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = readStore();
  return ok({
    mode: agentToolkitMode(),
    allowlist: Object.entries(ALLOWED_PAYPAL_TOOLS).map(([name, v]) => ({ name, ...v })),
    calls: (store.paypal_tool_calls ?? []).slice(-20),
    demo_prompts: TOOLKIT_DEMO_PROMPTS,
  });
}

/** Run the scripted Guard demo (allowed + blocked) through the Coach's deterministic planner. */
export async function POST(req: Request) {
  const body = await readJson<{ demo?: boolean; message?: string }>(req);
  const prompts = body.demo ? TOOLKIT_DEMO_PROMPTS : body.message ? [body.message] : [];
  if (!prompts.length) return fail("Send { demo: true } or { message }");
  try {
    const turns = [];
    for (const message of prompts) {
      const result = await updateStore((store) => coachTurn(store, message));
      turns.push({ message, reply: result.reply, call: result.paypal_tool_call ?? null });
    }
    return ok({ mode: agentToolkitMode(), turns });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "toolkit demo failed", 500);
  }
}
