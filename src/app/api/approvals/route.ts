import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const approvals = await updateStore((s) => s.approvals);
  return ok({ approvals });
}
