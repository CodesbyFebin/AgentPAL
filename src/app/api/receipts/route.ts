import { issueReceipt } from "@/lib/engine";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const receipts = await updateStore((s) => s.receipts);
  return ok({ receipts });
}

export async function POST(req: Request) {
  const body = await readJson<{ goal_id?: string }>(req);
  try {
    const goalId =
      body.goal_id ||
      (await updateStore((s) => s.goals.at(-1)?.goal_id));
    if (!goalId) return fail("goal_id is required");
    const receipt = await issueReceipt(goalId);
    return ok({ receipt }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "receipt failed", 400);
  }
}
