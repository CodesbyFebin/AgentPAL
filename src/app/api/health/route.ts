import { ok } from "@/lib/http";

export async function GET() {
  return ok({ ok: true, service: "moneymate-mesh", time: new Date().toISOString() });
}
