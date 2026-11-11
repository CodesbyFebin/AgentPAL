import { ok } from "@/lib/http";
import { computeSecurityHealth } from "@/lib/security-health";
import { resolveRole } from "@/lib/owner-session";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = readStore();
  const { role, mode } = resolveRole(req.headers.get("cookie"));
  return ok({ ...(await computeSecurityHealth(store)), role, role_mode: mode });
}
