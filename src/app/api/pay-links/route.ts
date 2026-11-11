import { createPaymentLink, publicPaymentLinkView, syncAllPaymentLinks } from "@/lib/pay-links";
import { ensureLaptopPayLink } from "@/lib/pay-link-checkout";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";
import type { PaymentLink } from "@/lib/types";

export const dynamic = "force-dynamic";

function originOf(req: Request) {
  try {
    return new URL(req.url).origin;
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const links = await updateStore((store) => {
    syncAllPaymentLinks(store);
    return store.payment_links.map((l) => publicPaymentLinkView(l, origin));
  });
  return ok({ links });
}

export async function POST(req: Request) {
  const body = await readJson<{
    preset?: "laptop";
    mandate_id?: string;
    amount_cap?: number;
    expires_at?: string;
    use_type?: PaymentLink["use_type"];
    max_uses?: number;
    merchant_id?: string;
    product_sku?: string;
    description?: string;
    currency?: PaymentLink["currency"];
  }>(req);
  try {
    const origin = originOf(req);
    const link = await updateStore((store) => {
      if (body.preset === "laptop") return ensureLaptopPayLink(store);
      if (!body.mandate_id) throw new Error("mandate_id is required");
      if (body.amount_cap == null) throw new Error("amount_cap is required");
      return createPaymentLink(store, {
        mandate_id: body.mandate_id,
        amount_cap: body.amount_cap,
        expires_at: body.expires_at,
        use_type: body.use_type,
        max_uses: body.max_uses,
        merchant_id: body.merchant_id,
        product_sku: body.product_sku,
        description: body.description,
        currency: body.currency,
      });
    });
    return ok({ link: publicPaymentLinkView(link, origin) }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "could not create payment link", 400);
  }
}
