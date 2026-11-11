/**
 * Owner sessions for RBAC.
 *
 * - No cookie, or any cookie that is not a valid owner token  →  "viewer" (read-only).
 * - "pin" mode: OWNER_PIN (≥ 12 chars) AND OWNER_SESSION_SECRET (≥ 32 chars) are set on the server
 *   (Render env, sync:false; never NEXT_PUBLIC_*). The owner role requires the PIN; the cookie carries
 *   `o.<expiryMs>.<HMAC-SHA256(OWNER_SESSION_SECRET)>`, compared in constant time and expiring after 8h.
 * - "pin_misconfigured": OWNER_PIN is valid but OWNER_SESSION_SECRET is missing/short → FAIL CLOSED:
 *   nobody can become owner.
 * - "demo_toggle": OWNER_PIN unset or shorter than 12 chars (a short PIN is rejected and treated as
 *   unset). The switch is a labelled demo toggle and the RBAC health check FAILS.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ROLE_COOKIE, type Role } from "./security";

export const OWNER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const DEMO_OWNER_VALUE = "demo-owner";
export const MIN_PIN_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;

export type RoleMode = "pin" | "pin_misconfigured" | "demo_toggle";

export function roleMode(env: NodeJS.ProcessEnv = process.env): RoleMode {
  const pin = env.OWNER_PIN || "";
  if (pin.length < MIN_PIN_LENGTH) return "demo_toggle";
  const secret = env.OWNER_SESSION_SECRET || "";
  return secret.length >= MIN_SESSION_SECRET_LENGTH ? "pin" : "pin_misconfigured";
}

/** Human-readable config status (never includes values). */
export function roleConfigNote(env: NodeJS.ProcessEnv = process.env): string {
  const pin = env.OWNER_PIN || "";
  if (pin && pin.length < MIN_PIN_LENGTH) return `OWNER_PIN is shorter than ${MIN_PIN_LENGTH} characters and is ignored (demo toggle).`;
  if (!pin) return "OWNER_PIN is not set (demo toggle).";
  if (roleMode(env) === "pin_misconfigured") return `OWNER_SESSION_SECRET is missing or shorter than ${MIN_SESSION_SECRET_LENGTH} characters — owner sign-in is disabled (fail closed).`;
  return "OWNER_PIN and OWNER_SESSION_SECRET are set.";
}

let warned = false;
function warnOnce(env: NodeJS.ProcessEnv) {
  if (warned || env !== process.env) return;
  warned = true;
  const pin = env.OWNER_PIN || "";
  if (pin && pin.length < MIN_PIN_LENGTH) console.warn(`[agentpal] OWNER_PIN rejected: shorter than ${MIN_PIN_LENGTH} characters; running in demo-toggle mode.`);
  if (roleMode(env) === "pin_misconfigured") console.warn("[agentpal] OWNER_SESSION_SECRET missing/short: owner sign-in disabled (fail closed).");
}

function mac(secret: string, exp: number): string {
  return createHmac("sha256", secret).update(`agentpal-owner:${exp}`).digest("base64url");
}

/** Constant-time comparison that does not leak length (compares SHA-256 digests). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function cookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === ROLE_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Resolves the caller's role from the Cookie header. Default and every failure path: viewer. */
export function resolveRole(
  cookieHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): { role: Role; mode: RoleMode } {
  warnOnce(env);
  const mode = roleMode(env);
  const value = cookieValue(cookieHeader);
  if (!value) return { role: "viewer", mode };
  if (mode === "demo_toggle") return { role: value === DEMO_OWNER_VALUE ? "owner" : "viewer", mode };
  if (mode === "pin_misconfigured") return { role: "viewer", mode };
  const [tag, expStr, sig, extra] = value.split(".");
  const exp = Number(expStr);
  if (tag !== "o" || extra !== undefined || !Number.isFinite(exp) || exp <= now || exp > now + OWNER_SESSION_TTL_MS || !sig) {
    return { role: "viewer", mode };
  }
  return { role: safeEqual(sig, mac(env.OWNER_SESSION_SECRET!, exp)) ? "owner" : "viewer", mode };
}

/** Issues the cookie value for an owner session, or null when the PIN is wrong / config fails closed. */
export function issueOwnerCookie(
  pin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  const mode = roleMode(env);
  if (mode === "demo_toggle") return DEMO_OWNER_VALUE;
  if (mode === "pin_misconfigured") return null;
  if (typeof pin !== "string" || !safeEqual(pin, env.OWNER_PIN!)) return null;
  const exp = now + OWNER_SESSION_TTL_MS;
  return `o.${exp}.${mac(env.OWNER_SESSION_SECRET!, exp)}`;
}

/** Route-level guard (defense in depth on top of middleware). */
export function isOwnerRequest(req: Request): boolean {
  return resolveRole(req.headers.get("cookie")).role === "owner";
}

/**
 * Brute-force protection for owner sign-in: per client, at most 5 failed PIN attempts per 15 minutes,
 * then a 15-minute lockout (429) during which even the right PIN is refused.
 */
export class PinAttemptGuard {
  private state = new Map<string, { failures: number; windowStart: number; lockedUntil: number }>();
  constructor(
    readonly maxFailures = 5,
    readonly windowMs = 15 * 60 * 1000,
    readonly lockoutMs = 15 * 60 * 1000,
  ) {}
  check(key: string, now = Date.now()): { locked: boolean; retryAfterMs: number } {
    const s = this.state.get(key);
    if (s && s.lockedUntil > now) return { locked: true, retryAfterMs: s.lockedUntil - now };
    return { locked: false, retryAfterMs: 0 };
  }
  fail(key: string, now = Date.now()): { locked: boolean; remaining: number } {
    let s = this.state.get(key);
    if (!s || now - s.windowStart > this.windowMs) s = { failures: 0, windowStart: now, lockedUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.maxFailures) s.lockedUntil = now + this.lockoutMs;
    this.state.set(key, s);
    if (this.state.size > 5000) for (const [k, v] of this.state) if (v.lockedUntil <= now && now - v.windowStart > this.windowMs) this.state.delete(k);
    return { locked: s.lockedUntil > now, remaining: Math.max(0, this.maxFailures - s.failures) };
  }
  succeed(key: string) {
    this.state.delete(key);
  }
}

export const pinGuard = new PinAttemptGuard();
