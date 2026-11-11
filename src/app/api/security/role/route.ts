import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { clientKey, ROLE_COOKIE } from "@/lib/security";
import { globalPinBackoff, issueOwnerCookie, pinGuard, resolveRole, roleMode } from "@/lib/owner-session";

export const dynamic = "force-dynamic";

const cookieOpts = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function GET(req: Request) {
  const { role, mode } = resolveRole(req.headers.get("cookie"));
  // Public: role and mode only. Configuration details stay server-side.
  return NextResponse.json({ role, mode });
}

/**
 * Switch role. Viewer is always allowed. In "pin" mode the owner role requires OWNER_PIN, with a
 * per-client lockout after 5 failures (plus the middleware rate limit on this route). In
 * "pin_misconfigured" mode owner sign-in fails closed. In "demo_toggle" mode it is a labelled demo toggle.
 */
export async function POST(req: Request) {
  const body = await readJson<{ role?: string; pin?: string }>(req);
  const mode = roleMode();
  if (body.role !== "owner") {
    const res = NextResponse.json({ role: "viewer", mode });
    res.cookies.set(ROLE_COOKIE, "viewer", cookieOpts);
    return res;
  }
  const key = `role:${clientKey(req.headers)}`;
  if (mode !== "demo_toggle") {
    const lock = pinGuard.check(key);
    if (lock.locked) {
      return NextResponse.json(
        { error: "Too many failed owner PIN attempts. Locked out; try again later.", mode },
        { status: 429, headers: { "Retry-After": String(Math.ceil(lock.retryAfterMs / 1000)) } },
      );
    }
    // Global backoff only pauses NEW owner sign-ins; existing owner sessions keep working.
    const global = globalPinBackoff.check();
    if (global.locked) {
      return NextResponse.json(
        { error: "Owner sign-in is temporarily paused after repeated failed PINs. Existing owner sessions still work. Try again shortly.", mode },
        { status: 429, headers: { "Retry-After": String(Math.ceil(global.retryAfterMs / 1000)) } },
      );
    }
  }
  const value = issueOwnerCookie(body.pin);
  if (!value) {
    if (mode === "pin_misconfigured") {
      return NextResponse.json({ error: "Owner sign-in is disabled: server session secret is not configured (fail closed).", role: "viewer", mode }, { status: 503 });
    }
    const f = pinGuard.fail(key);
    globalPinBackoff.fail();
    return NextResponse.json(
      { error: f.locked ? "Too many failed owner PIN attempts. Locked out; try again later." : "Owner PIN required or incorrect. Role unchanged.", role: resolveRole(req.headers.get("cookie")).role, mode },
      { status: f.locked ? 429 : 403 },
    );
  }
  if (mode !== "demo_toggle") pinGuard.succeed(key);
  const res = NextResponse.json({ role: "owner", mode, demo_toggle: mode === "demo_toggle" });
  res.cookies.set(ROLE_COOKIE, value, { ...cookieOpts, maxAge: 8 * 60 * 60 });
  return res;
}
