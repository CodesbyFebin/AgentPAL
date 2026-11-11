import {
  authorizeSale,
  refundSale,
  submitForSettlement,
  voidSale,
} from "./braintree";
import { checkoutRail, paymentMode } from "./payment-mode";
import {
  authorizeOrder,
  captureAuthorization,
  createAuthorizeOrder,
  refundCapture,
  voidAuthorization,
} from "./paypal";
import type { Payment } from "./types";

export interface CheckoutSession {
  provider: "braintree" | "paypal" | "mock";
  mode: "sandbox" | "mock";
  order_id: string;
  approve_url?: string;
}

export interface AuthorizationResult {
  provider: "braintree" | "paypal" | "mock";
  mode: "sandbox" | "mock";
  authorization_id: string;
  amount: number;
  currency: string;
  status: string;
  /** PayPal only: custom_id echoed back on the authorization (must equal our payment id). */
  custom_id?: string;
  payee_merchant_id?: string;
  payee_email?: string;
}

export interface CaptureResult {
  provider: "braintree" | "paypal" | "mock";
  mode: "sandbox" | "mock";
  capture_id: string;
  status?: string;
}

export interface RefundResult {
  provider: "braintree" | "paypal" | "mock";
  mode: "sandbox" | "mock";
  refund_id: string;
}

export function activeProviderName(): "braintree" | "paypal" | "mock" {
  const mode = paymentMode();
  if (mode.startsWith("braintree")) return "braintree";
  if (mode === "paypal-sandbox") return "paypal";
  return "mock";
}

export async function startPaymentCheckout(opts: {
  amount: number;
  currency?: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  requestId?: string;
}): Promise<CheckoutSession> {
  if (paymentMode().startsWith("braintree")) {
    // No processor transaction until a nonce is authorized after policy + reservation.
    return {
      provider: "braintree",
      mode: "sandbox",
      order_id: `BT-INTENT-${opts.customId}`,
    };
  }
  const order = await createAuthorizeOrder(opts);
  return {
    provider: order.mode === "mock" ? "mock" : "paypal",
    mode: order.mode,
    order_id: order.order_id,
    approve_url: order.approve_url,
  };
}

export async function authorizeReservedPayment(opts: {
  payment: Payment;
  nonce?: string;
  orderId?: string;
  expectedAmount: number;
  expectedCurrency: string;
}): Promise<AuthorizationResult> {
  const rail = opts.payment.rail || checkoutRail();
  if (rail === "braintree_sandbox") {
    if (!opts.nonce) {
      throw new Error("A Braintree payment method nonce is required to authorize this payment");
    }
    const tx = await authorizeSale({
      amount: opts.expectedAmount,
      currency: opts.expectedCurrency,
      nonce: opts.nonce,
      orderId: opts.payment.payment_id,
    });
    return {
      provider: "braintree",
      mode: "sandbox",
      authorization_id: tx.id,
      amount: Number(tx.amount),
      currency: tx.currencyIsoCode,
      status: tx.status,
    };
  }
  const oid = opts.orderId || opts.payment.paypal?.order_id;
  if (!oid) throw new Error("Missing PayPal order id");
  const auth = await authorizeOrder(oid, `auth-${opts.payment.payment_id}`);
  if (auth.mode === "mock") {
    // Mock mode has no processor; echo the reservation so the flow can be demonstrated (labelled mock).
    return {
      provider: "mock",
      mode: "mock",
      authorization_id: auth.authorization_id,
      amount: opts.expectedAmount,
      currency: opts.expectedCurrency,
      status: "authorized (mock)",
      custom_id: opts.payment.payment_id,
    };
  }
  // Sandbox: report what PayPal actually authorized so AgentPaL Guard compares real values.
  return {
    provider: "paypal",
    mode: "sandbox",
    authorization_id: auth.authorization_id,
    amount: auth.amount ?? NaN,
    currency: auth.currency ?? "",
    status: auth.status || "CREATED",
    custom_id: auth.custom_id,
    payee_merchant_id: auth.payee_merchant_id,
    payee_email: auth.payee_email,
  };
}

export async function captureReservedPayment(
  authorizationId: string,
  rail: Payment["rail"],
  expected?: { amount: number; currency: string; requestId?: string },
): Promise<CaptureResult> {
  if (rail === "braintree_sandbox") {
    const tx = await submitForSettlement(authorizationId);
    return { provider: "braintree", mode: "sandbox", capture_id: tx.id, status: tx.status };
  }
  const cap = await captureAuthorization(authorizationId, expected || {});
  return {
    provider: cap.mode === "mock" ? "mock" : "paypal",
    mode: cap.mode,
    capture_id: cap.capture_id,
    status: cap.status,
  };
}

export async function voidReservedPayment(
  authorizationId: string,
  rail: Payment["rail"],
): Promise<{ provider: "braintree" | "paypal" | "mock"; mode: "sandbox" | "mock" }> {
  if (rail === "braintree_sandbox") {
    await voidSale(authorizationId);
    return { provider: "braintree", mode: "sandbox" };
  }
  const result = await voidAuthorization(authorizationId);
  return { provider: result.mode === "mock" ? "mock" : "paypal", mode: result.mode };
}

export async function refundReservedPayment(
  captureId: string,
  rail: Payment["rail"],
  amount?: number,
  currency = "USD",
  requestId?: string,
): Promise<RefundResult> {
  if (rail === "braintree_sandbox") {
    const tx = await refundSale(captureId, amount);
    return { provider: "braintree", mode: "sandbox", refund_id: tx.id };
  }
  const ref = await refundCapture(captureId, amount, currency, requestId);
  return {
    provider: ref.mode === "mock" ? "mock" : "paypal",
    mode: ref.mode,
    refund_id: ref.refund_id,
  };
}

export function amountsMatch(actual: number, expected: number, actualCurrency: string, expectedCurrency: string) {
  return (
    actualCurrency.toUpperCase() === expectedCurrency.toUpperCase() &&
    Number(actual).toFixed(2) === Number(expected).toFixed(2)
  );
}

/**
 * AgentPaL Guard post-authorization check for the PayPal rail: the authorization must be bound
 * to our reserved payment (custom_id) and, when PAYPAL_EXPECTED_PAYEE_MERCHANT_ID is set, paid to
 * that payee. Returns a reason string on mismatch, or null when everything lines up.
 */
export function bindingMismatch(
  auth: Pick<AuthorizationResult, "provider" | "custom_id" | "payee_merchant_id">,
  paymentId: string,
): string | null {
  if (auth.provider !== "paypal") return null;
  if (auth.custom_id !== paymentId) {
    return `custom_id ${auth.custom_id || "(missing)"} is not the reserved payment ${paymentId}`;
  }
  const expectedPayee = process.env.PAYPAL_EXPECTED_PAYEE_MERCHANT_ID;
  if (expectedPayee && auth.payee_merchant_id && auth.payee_merchant_id !== expectedPayee) {
    return `payee ${auth.payee_merchant_id} is not the expected payee`;
  }
  return null;
}
