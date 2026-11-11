import { ok } from "@/lib/http";
import { computeSecurityHealth } from "@/lib/security-health";
import { roleFromCookieHeader } from "@/lib/security";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = readStore();
  return ok({ ...computeSecurityHealth(store), role: roleFromCookieHeader(req.headers.get("cookie")) });
}
