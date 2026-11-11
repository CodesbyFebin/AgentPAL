import { ok } from "@/lib/http";
import { computeSecurityHealth } from "@/lib/security-health";
import { resolveRole } from "@/lib/owner-session";
import { clientIdentity } from "@/lib/security";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const store = readStore();
  const { role, mode } = resolveRole(req.headers.get("cookie"));
  // client_ip_source says which edge header keyed the rate limiter (never the IP itself).
  return ok({ ...(await computeSecurityHealth(store)), role, role_mode: mode, client_ip_source: clientIdentity(req.headers).source });
}
