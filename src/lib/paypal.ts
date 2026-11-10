import { id } from "./ids";
import { paypalMode } from "./store";

const LIVE = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";

function apiBase(): string {
  return process.env.PAYPAL_ENV === "live" ? LIVE : SANDBOX;
}

export function hasPayPalCreds(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function accessToken(): Promise<string> {
  const idKey = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const auth = Buffer.from(`${idKey}:${secret}`).toString("base64");
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function paypalFetch(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`PayPal ${path} failed (${res.status}): ${text.slice(0, 600)}`);
  }
  return json;
}

export interface CreatedOrder {
  mode: "sandbox" | "mock";
  order_id: string;
  approve_url?: string;
}

export async function createAuthorizeOrder(opts: {
  amount: number;
  currency?: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<CreatedOrder> {
  const mode = paypalMode();
  if (mode === "mock") {
    const order_id = `MOCK-ORDER-${id("pp")}`;
    return {
      mode,
      order_id,
      approve_url: `${opts.returnUrl}${opts.returnUrl.includes("?") ? "&" : "?"}token=${order_id}&mock=1`,
    };
  }

  const body = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        custom_id: opts.customId,
        description: opts.description,
        amount: {
          currency_code: opts.currency || "USD",
          value: opts.amount.toFixed(2),
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
          brand_name: "MeshPaL",
          landing_page: "NO_PREFERENCE",
          user_action: "PAY_NOW",
          return_url: opts.returnUrl,
          cancel_url: opts.cancelUrl,
        },
      },
    },
  };

  const data = (await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { id: string; links?: Array<{ rel: string; href: string }> };

  const approve = data.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
  return { mode: "sandbox", order_id: data.id, approve_url: approve?.href };
}

export async function authorizeOrder(orderId: string): Promise<{ authorization_id: string; mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, authorization_id: `MOCK-AUTH-${id("pp")}` };
  }
  const data = (await paypalFetch(`/v2/checkout/orders/${orderId}/authorize`, {
    method: "POST",
    body: JSON.stringify({}),
  })) as {
    purchase_units?: Array<{
      payments?: { authorizations?: Array<{ id: string }> };
    }>;
  };
  const authorization_id = data.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorization_id) throw new Error("PayPal authorize response missing authorization id");
  return { mode: "sandbox", authorization_id };
}

export async function captureAuthorization(
  authorizationId: string,
): Promise<{ capture_id: string; mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, capture_id: `MOCK-CAP-${id("pp")}` };
  }
  const data = (await paypalFetch(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: "POST",
    body: JSON.stringify({}),
  })) as { id: string };
  if (!data.id) throw new Error("PayPal capture response missing capture id");
  return { mode: "sandbox", capture_id: data.id };
}

export async function voidAuthorization(authorizationId: string): Promise<{ mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") return { mode };
  await paypalFetch(`/v2/payments/authorizations/${authorizationId}/void`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return { mode: "sandbox" };
}

export async function refundCapture(
  captureId: string,
  amount?: number,
  currency = "USD",
): Promise<{ refund_id: string; mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, refund_id: `MOCK-REF-${id("pp")}` };
  }
  const body = amount
    ? { amount: { value: amount.toFixed(2), currency_code: currency } }
    : {};
  const data = (await paypalFetch(`/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as { id: string };
  if (!data.id) throw new Error("PayPal refund response missing refund id");
  return { mode: "sandbox", refund_id: data.id };
}
