import { NextResponse } from "next/server";
import { webhookHeadersFrom } from "@/lib/paypal";
import { updateStore } from "@/lib/store";
import { intakePayPalWebhook } from "@/lib/webhook-security";

export const dynamic = "force-dynamic";

/** Signature-verified PayPal webhook endpoint with replay protection. */
export async function POST(req: Request) {
  const headers = webhookHeadersFrom(req);
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> } = {};
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ ok: false, result: "bad_json" }, { status: 400 });
  }
  const out = await updateStore((store) => intakePayPalWebhook(store, headers, event));
  return NextResponse.json(out.body, { status: out.status });
}
