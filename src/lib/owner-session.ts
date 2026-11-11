/**
 * Owner sessions for the demo RBAC.
 *
 * - No cookie, or any cookie that is not a valid owner token  →  "viewer" (read-only).
 * - If OWNER_PIN is set on the server (Render env, sync:false; never NEXT_PUBLIC_*), the owner role
 *   requires that PIN. The cookie then carries an HMAC-SHA256 token `o.<expiryMs>.<mac>` keyed by the
 *   PIN, so a client cannot forge "owner" by editing the cookie.
 * - If OWNER_PIN is NOT set, the role switch is a clearly labelled "demo role toggle": anyone can pick
 *   owner, the UI says so, and RBAC is excluded from the Security Center score.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { ROLE_COOKIE, type Role } from "./security";

export const OWNER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const DEMO_OWNER_VALUE = "demo-owner";

export type RoleMode = "pin" | "demo_toggle";

export function roleMode(env: NodeJS.ProcessEnv = process.env): RoleMode {
  return env.OWNER_PIN && env.OWNER_PIN.length >= 4 ? "pin" : "demo_toggle";
}

function mac(pin: string, exp: number): string {
  return createHmac("sha256", pin).update(`agentpal-owner:${exp}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
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
  const mode = roleMode(env);
  const value = cookieValue(cookieHeader);
  if (!value) return { role: "viewer", mode };
  if (mode === "demo_toggle") return { role: value === DEMO_OWNER_VALUE ? "owner" : "viewer", mode };
  const [tag, expStr, sig] = value.split(".");
  const exp = Number(expStr);
  if (tag !== "o" || !Number.isFinite(exp) || exp <= now || !sig) return { role: "viewer", mode };
  return { role: safeEqual(sig, mac(env.OWNER_PIN!, exp)) ? "owner" : "viewer", mode };
}

/** Issues the cookie value for an owner session, or null when the PIN is wrong. */
export function issueOwnerCookie(
  pin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  if (roleMode(env) === "demo_toggle") return DEMO_OWNER_VALUE;
  if (typeof pin !== "string" || !safeEqual(pin, env.OWNER_PIN!)) return null;
  const exp = now + OWNER_SESSION_TTL_MS;
  return `o.${exp}.${mac(env.OWNER_PIN!, exp)}`;
}

/** Route-level guard (defense in depth on top of middleware). */
export function isOwnerRequest(req: Request): boolean {
  return resolveRole(req.headers.get("cookie")).role === "owner";
}
