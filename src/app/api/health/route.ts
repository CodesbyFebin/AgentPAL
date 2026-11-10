import { ok } from "@/lib/http";

export async function GET() {
  return ok({ ok: true, service: "meshpal", time: new Date().toISOString() });
}
