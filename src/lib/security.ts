/**
 * Edge-safe security helpers shared by middleware and routes (no Node built-ins).
 * - RBAC: roles "viewer" (default) and "owner". The role is resolved server-side from a signed cookie
 *   (see owner-session.ts) and enforced in middleware for every mutating /api request.
 * - Rate limiting: fixed-window counter per client + route group for payment routes.
 */
export type Role = "owner" | "viewer";
export const ROLE_COOKIE = "agentpal_role";


export function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/** Paths a viewer may still POST to: the kill switch (the route lets viewers only ENGAGE it), the role
 * endpoint (owner requires the server-side PIN), and PayPal webhooks (signature-verified). */
const RBAC_EXEMPT = [/^\/api\/kill-switch$/, /^\/api\/security\/role$/, /^\/api\/webhooks\//, /^\/api\/v1\/webhooks\//, /^\/api\/paypal\/webhook$/];

export function rbacDecision(method: string, pathname: string, role: Role): { allowed: boolean; reason?: string } {
  if (!pathname.startsWith("/api/")) return { allowed: true };
  if (!isMutatingMethod(method)) return { allowed: true };
  if (RBAC_EXEMPT.some((r) => r.test(pathname))) return { allowed: true };
  if (role === "viewer") {
    return { allowed: false, reason: "Viewer role is read-only (the default). Sign in as owner in Security Center to make changes." };
  }
  return { allowed: true };
}

/** Route groups that move or could move money get a tighter limit. */
export const RATE_LIMITS: Array<{ group: string; match: RegExp; limit: number; windowMs: number }> = [
  { group: "payments", match: /^\/api\/(payments|paypal\/orders|refunds|purchases|pay-links\/[^/]+\/pay|steps\/[^/]+\/execute)/, limit: 20, windowMs: 60_000 },
  { group: "role", match: /^\/api\/security\/role$/, limit: 10, windowMs: 60_000 },
  { group: "paypal-tools", match: /^\/api\/(coach\/paypal-tools|invoices|paypal-plans|paypal-subscriptions)/, limit: 30, windowMs: 60_000 },
];

/** Canonical dotted-quad only: no leading zeros ("01.2.3.4" is rejected, so it can't mint a second bucket). */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Expands an IPv6 address to 8 lowercase 4-digit hextets, or null if invalid. Handles "::" and IPv4 tails. */
export function expandIpv6(input: string): string[] | null {
  let v = input.trim().toLowerCase();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  v = v.split("%")[0];
  if (!v.includes(":") || !/^[0-9a-f:.]+$/.test(v)) return null;
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!IPV4.test(tail[1])) return null;
    const o = tail[1].split(".").map(Number);
    v = v.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...rest];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => p.padStart(4, "0"));
}

export function isValidIp(v: string): boolean {
  return IPV4.test(v) || expandIpv6(v) !== null;
}

/** Normalised bucket for one IP: IPv4 as-is, IPv6 grouped by its /64 prefix (one host usually owns a /64). */
export function ipBucket(ip: string): string | null {
  const v = ip.trim();
  if (IPV4.test(v)) return v;
  const h = expandIpv6(v);
  return h ? `${h.slice(0, 4).join(":")}::/64` : null;
}

export type ClientIpSource = "cf-connecting-ip" | "true-client-ip" | "unknown";

/**
 * Client key for rate limiting / PIN lockout. Only edge-set headers are trusted:
 * 1. CF-Connecting-IP, then 2. True-Client-IP (set and overwritten by Render's Cloudflare edge).
 * X-Forwarded-For is NEVER used (clients can forge it). If neither header is present, every caller shares
 * one "unknown" bucket — strict, but un-spoofable. IPv6 is grouped by /64.
 */
export function clientIdentity(headers: { get(name: string): string | null }): { key: string; source: ClientIpSource } {
  for (const [name, source] of [["cf-connecting-ip", "cf-connecting-ip"], ["true-client-ip", "true-client-ip"]] as const) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const bucket = ipBucket(raw);
    // A present-but-malformed edge header goes to the shared bucket; it never falls through to a
    // lower-priority header (which an attacker might control).
    return bucket ? { key: bucket, source } : { key: "unknown", source: "unknown" };
  }
  return { key: "unknown", source: "unknown" };
}

export function clientKey(headers: { get(name: string): string | null }): string {
  return clientIdentity(headers).key;
}

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
