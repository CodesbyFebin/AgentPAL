import { ok } from "@/lib/http";
import { verifyAuditChain } from "@/lib/audit";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(verifyAuditChain(readStore().events));
}
