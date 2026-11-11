/**
 * Edge-safe security helpers shared by middleware and routes (no Node built-ins).
 * - RBAC: demo roles "owner" (default) and "viewer", carried in the `agentpal_role` cookie and
 *   enforced server-side in middleware for every mutating /api request.
 * - Rate limiting: fixed-window counter per client + route group for payment routes.
 */
export type Role = "owner" | "viewer";
export const ROLE_COOKIE = "agentpal_role";

export function roleFromCookieHeader(cookieHeader: string | null | undefined): Role {
  if (!cookieHeader) return "owner";
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === ROLE_COOKIE) return decodeURIComponent(rest.join("=")) === "viewer" ? "viewer" : "owner";
  }
  return "owner";
}

export function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/** Paths a viewer may still POST to: the kill switch (route lets viewers only engage it), switching role, and PayPal webhooks (signature-verified). */
const RBAC_EXEMPT = [/^\/api\/kill-switch$/, /^\/api\/security\/role$/, /^\/api\/webhooks\//, /^\/api\/v1\/webhooks\//, /^\/api\/paypal\/webhook$/];

export function rbacDecision(method: string, pathname: string, role: Role): { allowed: boolean; reason?: string } {
  if (!pathname.startsWith("/api/")) return { allowed: true };
  if (!isMutatingMethod(method)) return { allowed: true };
  if (RBAC_EXEMPT.some((r) => r.test(pathname))) return { allowed: true };
  if (role === "viewer") {
    return { allowed: false, reason: "Viewer role is read-only. Switch to the owner role in Security Center to make changes." };
  }
  return { allowed: true };
}

/** Route groups that move or could move money get a tighter limit. */
export const RATE_LIMITS: Array<{ group: string; match: RegExp; limit: number; windowMs: number }> = [
  { group: "payments", match: /^\/api\/(payments|paypal\/orders|refunds|purchases|pay-links\/[^/]+\/pay|steps\/[^/]+\/execute)/, limit: 20, windowMs: 60_000 },
  { group: "paypal-tools", match: /^\/api\/(coach\/paypal-tools|invoices|paypal-plans|paypal-subscriptions)/, limit: 30, windowMs: 60_000 },
];

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; remaining: number; retryAfterMs: number } {
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (this.buckets.size > 5000) this.sweep(now);
      return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
    }
    b.count += 1;
    if (b.count > limit) return { ok: false, remaining: 0, retryAfterMs: b.resetAt - now };
    return { ok: true, remaining: limit - b.count, retryAfterMs: 0 };
  }
  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

export function rateLimitGroup(method: string, pathname: string) {
  if (!isMutatingMethod(method)) return null;
  return RATE_LIMITS.find((r) => r.match.test(pathname)) || null;
}

/** Content-Security-Policy that allows only our origin plus the PayPal / Braintree SDK hosts. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.paypal.com https://*.paypal.com https://*.paypalobjects.com https://js.braintreegateway.com https://*.braintreegateway.com https://*.braintree-api.com",
  "style-src 'self' 'unsafe-inline' https://*.braintreegateway.com",
  "img-src 'self' data: blob: https://*.paypal.com https://*.paypalobjects.com https://*.braintreegateway.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.braintreegateway.com https://*.braintree-api.com",
  "frame-src https://*.paypal.com https://*.braintreegateway.com https://*.cardinalcommerce.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.paypal.com",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://www.paypal.com\")" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];
