import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { ROLE_COOKIE } from "@/lib/security";
import { issueOwnerCookie, resolveRole, roleMode } from "@/lib/owner-session";

export const dynamic = "force-dynamic";

const cookieOpts = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function GET(req: Request) {
  const { role, mode } = resolveRole(req.headers.get("cookie"));
  return NextResponse.json({ role, mode, owner_requires_pin: mode === "pin" });
}

/**
 * Switch role. Viewer is always allowed. Owner requires OWNER_PIN when it is configured on the server;
 * without it this is an explicitly labelled demo role toggle (and RBAC is excluded from the score).
 */
export async function POST(req: Request) {
  const body = await readJson<{ role?: string; pin?: string }>(req);
  const mode = roleMode();
  if (body.role !== "owner") {
    const res = NextResponse.json({ role: "viewer", mode });
    res.cookies.set(ROLE_COOKIE, "viewer", cookieOpts);
    return res;
  }
  const value = issueOwnerCookie(body.pin);
  if (!value) {
    return NextResponse.json({ error: "Owner PIN required or incorrect. Role unchanged.", role: resolveRole(req.headers.get("cookie")).role, mode }, { status: 403 });
  }
  const res = NextResponse.json({ role: "owner", mode, demo_toggle: mode === "demo_toggle" });
  res.cookies.set(ROLE_COOKIE, value, { ...cookieOpts, maxAge: 8 * 60 * 60 });
  return res;
}
