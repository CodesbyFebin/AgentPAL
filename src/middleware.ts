import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter, rateLimitGroup, rbacDecision, roleFromCookieHeader } from "@/lib/security";

const limiter = new RateLimiter();

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = roleFromCookieHeader(req.headers.get("cookie"));
  const rbac = rbacDecision(req.method, pathname, role);
  if (!rbac.allowed) {
    return NextResponse.json({ error: rbac.reason, role }, { status: 403 });
  }
  const group = rateLimitGroup(req.method, pathname);
  if (group) {
    const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const r = limiter.hit(`${group.group}:${client}`, group.limit, group.windowMs);
    if (!r.ok) {
      return NextResponse.json(
        { error: `Rate limit: at most ${group.limit} ${group.group} requests per minute. Try again shortly.` },
        { status: 429, headers: { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
      );
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
