import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter, isMutatingMethod, rateLimitGroup, rbacDecision, roleFromCookieHeader } from "@/lib/security";

import { OWNER_SESSION, ownerSessionRequired, verifyOwnerSession } from "@/lib/owner-session";

const limiter = new RateLimiter();

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const webhook = /^\/api\/(?:webhooks\/paypal|v1\/webhooks\/paypal|paypal\/webhook)$/.test(pathname);
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const allowedOrigins = [req.nextUrl.origin];
  const host = req.headers.get("host");
  if (host) {
    // Next may normalize its internal URL to localhost while preserving the requested Host.
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto + ":" : req.nextUrl.protocol;
    allowedOrigins.push(`${protocol}//${host}`);
  }
  if (!webhook && isMutatingMethod(req.method) && (fetchSite === "cross-site" || (origin && !allowedOrigins.includes(origin)))) {
    return NextResponse.json({ error: "Use the AgentPaL app origin for write requests." }, { status: 403 });
  }

  const sessionRoute = pathname === "/api/security/session";
  const group = sessionRoute ? { group: "owner-access", limit: 8, windowMs: 60_000 } : rateLimitGroup(req.method, pathname);
  if (group) {
    const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const result = limiter.hit(`${group.group}:${client}`, group.limit, group.windowMs);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Request limit reached. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) } },
      );
    }
  }

  const publicCheckout =
    (req.method === "GET" && /^\/api\/(?:health|paypal\/config|braintree\/client-token|pay-links\/[^/]+(?:\/qr)?)$/.test(pathname)) ||
    (req.method === "POST" && /^\/api\/(?:pay-links\/[^/]+\/pay|payments\/[^/]+\/authorize)$/.test(pathname));
  if (ownerSessionRequired() && !sessionRoute && !webhook && !publicCheckout &&
      !(await verifyOwnerSession(req.cookies.get(OWNER_SESSION)?.value))) {
    return NextResponse.json({ error: "AgentPaL owner sign-in required.", code: "OWNER_REQUIRED" }, { status: 401 });
  }

  const role = roleFromCookieHeader(req.headers.get("cookie"));
  const rbac = rbacDecision(req.method, pathname, role);
  if (!rbac.allowed) return NextResponse.json({ error: rbac.reason, role }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
