import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const merchants = await updateStore((s) => s.merchants);
  return ok({ merchants });
}
