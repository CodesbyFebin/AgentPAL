import { budgetProgress } from "@/lib/finance-engine";
import { ok } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await updateStore((s) => ({
    finance: s.finance,
    budgets: budgetProgress(s.finance),
    demo: true,
  }));
  return ok(data);
}
