import { NextResponse, type NextRequest } from "next/server";
import { clientKey, RateLimiter, rateLimitGroup, rbacDecision } from "@/lib/security";
import { resolveRole } from "@/lib/owner-session";

const limiter = new RateLimiter();

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { role } = resolveRole(req.headers.get("cookie"));
  const rbac = rbacDecision(req.method, pathname, role);
  if (!rbac.allowed) {
    return NextResponse.json({ error: rbac.reason, role }, { status: 403 });
  }
  const group = rateLimitGroup(req.method, pathname);
  if (group) {
    const r = limiter.hit(`${group.group}:${clientKey(req.headers)}`, group.limit, group.windowMs);
    if (!r.ok) {
      return NextResponse.json(
        { error: `Rate limit: at most ${group.limit} ${group.group} requests per minute. Try again shortly.` },
        { status: 429, headers: { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
      );
    }
  }
  return NextResponse.next();
}

// Node.js runtime so the owner-session HMAC (node:crypto) and server-only env are available.
export const config = { matcher: ["/api/:path*"], runtime: "nodejs" };
