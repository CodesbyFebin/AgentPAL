import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { ROLE_COOKIE, type Role } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Demo RBAC: switch between owner and viewer. Enforcement happens server-side in middleware. */
export async function POST(req: Request) {
  const body = await readJson<{ role?: string }>(req);
  const role: Role = body.role === "viewer" ? "viewer" : "owner";
  const res = NextResponse.json({ role });
  res.cookies.set(ROLE_COOKIE, role, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" });
  return res;
}
