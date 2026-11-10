import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const calls = await updateStore((s) => s.ai_calls ?? []);
  return ok({ calls });
}
