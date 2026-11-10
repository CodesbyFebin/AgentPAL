import { coachTurn } from "@/lib/coach-turn";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ message?: string }>(req);
  const message = (body.message || "").trim();
  if (!message) return fail("message is required");
  try {
    const result = await updateStore((store) => coachTurn(store, message));
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "coach failed", 500);
  }
}
