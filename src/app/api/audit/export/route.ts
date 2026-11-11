import { auditCsv } from "@/lib/audit";
import { redactSecrets } from "@/lib/ai-permissions";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = redactSecrets(auditCsv(readStore().events));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agentpal-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
