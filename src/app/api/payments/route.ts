import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const payments = await updateStore((s) => s.payments);
  return ok({ payments });
}
