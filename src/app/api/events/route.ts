import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await updateStore((s) => s.events);
  return ok({ events });
}
