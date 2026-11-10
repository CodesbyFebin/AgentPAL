import { ok } from "@/lib/http";
import { resetStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  resetStore();
  return ok({ ok: true });
}
