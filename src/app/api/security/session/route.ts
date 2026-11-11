import { NextResponse } from "next/server";
import { issueOwnerSession, OWNER_SESSION, SESSION_SECONDS, validOwnerKey } from "@/lib/owner-session";
import { fail, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ key?: string } | null>(req);
  if (typeof body?.key !== "string" || !(await validOwnerKey(body.key))) {
    return fail("Owner access key rejected.", 401);
  }
  const session = await issueOwnerSession();
  if (!session) return fail("Owner access is unavailable.", 503);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(OWNER_SESSION, session, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(OWNER_SESSION);
  return response;
}
