/**
 * PayPal Orders / Payments / Subscriptions via the official @paypal/paypal-server-sdk.
 *
 * Trust flow (unchanged): create order with intent AUTHORIZE -> buyer approves -> authorize ->
 * AgentPaL Guard verifies amount / currency / custom_id (our reserved payment id) / payee ->
 * capture (finalCapture) or void on any mismatch. Every mutating call carries a
 * PayPal-Request-Id so retries are idempotent.
 *
 * Sandbox only: the SDK client is always built with Environment.Sandbox.
 * Narrow fallback: the SDK has no Notifications API, so webhook signature verification
 * still uses a direct fetch to /v1/notifications/verify-webhook-signature (see below).
 */
import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  SubscriptionsController,
} from "@paypal/paypal-server-sdk";
import { id } from "./ids";
import { paypalMode } from "./store";

const SANDBOX = "https://api-m.sandbox.paypal.com";

export function hasPayPalCreds(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/** Minimal surface of the SDK controllers we use. Lets tests inject a fake without network. */
export interface PayPalSdkLike {
  orders: Pick<OrdersController, "createOrder" | "authorizeOrder" | "getOrder">;
  payments: Pick<PaymentsController, "captureAuthorizedPayment" | "voidPayment" | "refundCapturedPayment">;
  subscriptions: Pick<SubscriptionsController, "getSubscription" | "cancelSubscription">;
}

let injected: PayPalSdkLike | null = null;
let cached: { key: string; sdk: PayPalSdkLike } | null = null;

export function _setPayPalSdkForTests(sdk: PayPalSdkLike | null) {
  injected = sdk;
}

function sdk(): PayPalSdkLike {
  if (injected) return injected;
  const clientId = process.env.PAYPAL_CLIENT_ID!;
  const key = clientId; // never key or log by the secret
  if (cached && cached.key === key) return cached.sdk;
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    },
    timeout: 20000,
    environment: Environment.Sandbox,
    // No `logging` option: the SDK logs nothing, so no headers or tokens can reach stdout.
  });
  const built: PayPalSdkLike = {
    orders: new OrdersController(client),
    payments: new PaymentsController(client),
    subscriptions: new SubscriptionsController(client),
  };
  cached = { key, sdk: built };
  return built;
}

/** Turn SDK errors into short, secret-free messages. */
function sdkError(op: string, err: unknown): Error {
  const e = err as { statusCode?: number; result?: { name?: string; message?: string; details?: Array<{ issue?: string }> }; message?: string };
  const status = e?.statusCode ? ` (${e.statusCode})` : "";
  const name = e?.result?.name || "";
  const issue = e?.result?.details?.[0]?.issue || "";
  const msg = [name, issue].filter(Boolean).join(": ") || (e?.message || "request failed").slice(0, 200);
  return new Error(`PayPal ${op} failed${status}: ${msg}`);
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
  requestId?: string;
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
  try {
    const { result } = await sdk().orders.createOrder({
      paypalRequestId: opts.requestId || opts.customId,
      prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          {
            customId: opts.customId,
            description: opts.description.slice(0, 127),
            amount: { currencyCode: opts.currency || "USD", value: opts.amount.toFixed(2) },
          },
        ],
        // Redirect flow needs return/cancel URLs; the JS Buttons popup flow passes none.
        ...(opts.returnUrl
          ? {
              paymentSource: {
                paypal: {
                  experienceContext: {
                    brandName: "AgentPaL",
                    returnUrl: opts.returnUrl,
                    cancelUrl: opts.cancelUrl,
                  },
                },
              },
            }
          : {}),
      },
    });
    if (!result.id) throw new Error("create order response missing id");
    const approve = result.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    return { mode: "sandbox", order_id: result.id, approve_url: approve?.href };
  } catch (err) {
    throw sdkError("create order", err);
  }
}

export interface PayPalAuthorization {
  mode: "sandbox" | "mock";
  authorization_id: string;
  /** Amount PayPal actually authorized (from the SDK response). Undefined in mock mode. */
  amount?: number;
  currency?: string;
  custom_id?: string;
  payee_merchant_id?: string;
  payee_email?: string;
  status?: string;
}

export async function authorizeOrder(orderId: string, requestId?: string): Promise<PayPalAuthorization> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, authorization_id: `MOCK-AUTH-${id("pp")}` };
  }
  try {
    const { result } = await sdk().orders.authorizeOrder({
      id: orderId,
      paypalRequestId: requestId || `auth-${orderId}`,
      prefer: "return=representation",
    });
    const unit = result.purchaseUnits?.[0];
    const auth = unit?.payments?.authorizations?.[0];
    if (!auth?.id) throw new Error("authorize response missing authorization id");
    return {
      mode: "sandbox",
      authorization_id: auth.id,
      amount: auth.amount?.value != null ? Number(auth.amount.value) : undefined,
      currency: auth.amount?.currencyCode,
      custom_id: auth.customId || unit?.customId,
      payee_merchant_id: unit?.payee?.merchantId,
      payee_email: unit?.payee?.emailAddress,
      status: auth.status,
    };
  } catch (err) {
    throw sdkError("authorize order", err);
  }
}

export async function captureAuthorization(
  authorizationId: string,
  opts: { amount?: number; currency?: string; requestId?: string } = {},
): Promise<{ capture_id: string; mode: "sandbox" | "mock"; status?: string }> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, capture_id: `MOCK-CAP-${id("pp")}` };
  }
  try {
    const { result } = await sdk().payments.captureAuthorizedPayment({
      authorizationId,
      paypalRequestId: opts.requestId || `cap-${authorizationId}`,
      prefer: "return=representation",
      body: {
        finalCapture: true,
        ...(opts.amount != null
          ? { amount: { currencyCode: opts.currency || "USD", value: opts.amount.toFixed(2) } }
          : {}),
      },
    });
    if (!result.id) throw new Error("capture response missing capture id");
    return { mode: "sandbox", capture_id: result.id, status: result.status };
  } catch (err) {
    throw sdkError("capture authorization", err);
  }
}

export async function voidAuthorization(authorizationId: string): Promise<{ mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") return { mode };
  try {
    await sdk().payments.voidPayment({ authorizationId, paypalRequestId: `void-${authorizationId}` });
    return { mode: "sandbox" };
  } catch (err) {
    throw sdkError("void authorization", err);
  }
}

export async function refundCapture(
  captureId: string,
  amount?: number,
  currency = "USD",
  requestId?: string,
): Promise<{ refund_id: string; mode: "sandbox" | "mock" }> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, refund_id: `MOCK-REF-${id("pp")}` };
  }
  try {
    const { result } = await sdk().payments.refundCapturedPayment({
      captureId,
      paypalRequestId: requestId || `refund-${captureId}-${amount ?? "full"}`,
      prefer: "return=representation",
      body: amount ? { amount: { value: amount.toFixed(2), currencyCode: currency } } : {},
    });
    if (!result.id) throw new Error("refund response missing refund id");
    return { mode: "sandbox", refund_id: result.id };
  } catch (err) {
    throw sdkError("refund capture", err);
  }
}

export async function getOrderSummary(orderId: string): Promise<{
  mode: "sandbox" | "mock";
  order_id: string;
  status: string;
  intent?: string;
  amount?: string;
  currency?: string;
}> {
  const mode = paypalMode();
  if (mode === "mock") {
    return { mode, order_id: orderId, status: "MOCK_CREATED" };
  }
  try {
    const { result } = await sdk().orders.getOrder({ id: orderId });
    const unit = result.purchaseUnits?.[0];
    return {
      mode: "sandbox",
      order_id: result.id || orderId,
      status: String(result.status || "UNKNOWN"),
      intent: result.intent ? String(result.intent) : undefined,
      amount: unit?.amount?.value,
      currency: unit?.amount?.currencyCode,
    };
  } catch (err) {
    throw sdkError("get order", err);
  }
}

export interface PayPalWebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export function webhookHeadersFrom(req: Request): PayPalWebhookHeaders {
  return {
    authAlgo: req.headers.get("paypal-auth-algo") || "",
    certUrl: req.headers.get("paypal-cert-url") || "",
    transmissionId: req.headers.get("paypal-transmission-id") || "",
    transmissionSig: req.headers.get("paypal-transmission-sig") || "",
    transmissionTime: req.headers.get("paypal-transmission-time") || "",
  };
}

/**
 * Narrow fallback: @paypal/paypal-server-sdk 2.x does not ship the Notifications
 * (verify-webhook-signature) API, so this one call is a direct sandbox fetch.
 */
async function sandboxAccessToken(): Promise<string> {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function verifyWebhookSignature(
  headers: PayPalWebhookHeaders,
  webhookEvent: unknown,
): Promise<{ ok: boolean; status: string; method: "paypal" | "skipped_mock" | "skipped_no_webhook_id" | "failed" }> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const mode = paypalMode();
  if (mode === "mock") {
    return { ok: true, status: "SKIPPED_MOCK", method: "skipped_mock" };
  }
  if (!webhookId) {
    return { ok: false, status: "NO_WEBHOOK_ID", method: "skipped_no_webhook_id" };
  }
  const token = await sandboxAccessToken();
  const res = await fetch(`${SANDBOX}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  });
  if (!res.ok) return { ok: false, status: `HTTP_${res.status}`, method: "failed" };
  const data = (await res.json()) as { verification_status?: string };
  const status = data.verification_status || "UNKNOWN";
  const ok = status === "SUCCESS";
  return { ok, status, method: ok ? "paypal" : "failed" };
}

const mockSubscriptionStatus = new Map<string, string>();

export async function cancelSubscription(
  subscriptionId: string,
  reason: string,
): Promise<{ mode: "sandbox" | "mock"; subscription_id: string; cancelled: true }> {
  const mode = paypalMode();
  if (mode === "mock") {
    mockSubscriptionStatus.set(subscriptionId, "CANCELLED");
    return { mode, subscription_id: subscriptionId, cancelled: true };
  }
  try {
    await sdk().subscriptions.cancelSubscription({ id: subscriptionId, body: { reason: reason.slice(0, 128) } });
    return { mode: "sandbox", subscription_id: subscriptionId, cancelled: true };
  } catch (err) {
    throw sdkError("cancel subscription", err);
  }
}

export async function getSubscription(subscriptionId: string): Promise<{
  mode: "sandbox" | "mock";
  subscription_id: string;
  status: string;
}> {
  const mode = paypalMode();
  if (mode === "mock") {
    const status = mockSubscriptionStatus.get(subscriptionId) || "ACTIVE";
    return { mode, subscription_id: subscriptionId, status };
  }
  try {
    const { result } = await sdk().subscriptions.getSubscription({ id: subscriptionId });
    return { mode: "sandbox", subscription_id: result.id || subscriptionId, status: String(result.status || "UNKNOWN") };
  } catch (err) {
    throw sdkError("get subscription", err);
  }
}
