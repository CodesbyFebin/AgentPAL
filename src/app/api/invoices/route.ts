import { fail, ok, readJson } from "@/lib/http";
import { guardedRead, guardedToolResponse } from "@/lib/paypal-tool-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const call = await guardedRead("list_invoices", { page: 1, page_size: 20 });
  return ok({ call });
}

/** Draft an invoice through the Guard-wrapped toolkit (cap, recipient, kill switch). */
export async function POST(req: Request) {
  const body = await readJson<{ recipient_email?: string; item_name?: string; amount?: number; note?: string }>(req);
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return fail("amount must be a finite number");
  const email = (body.recipient_email || "").trim();
  return guardedToolResponse(req, "invoices.create", "create_invoice", {
    currency_code: "USD",
    note: (body.note || "Created with AgentPaL (independent project built on PayPal APIs)").slice(0, 200),
    primary_recipients: email ? [{ billing_info: { email_address: email } }] : [],
    items: [{ name: (body.item_name || "Services").slice(0, 120), quantity: "1", unit_amount: { currency_code: "USD", value: amount.toFixed(2) } }],
  });
}
