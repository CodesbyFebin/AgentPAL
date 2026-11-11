import { appendEvent } from "./events";
import { nowIso } from "./ids";
import { inrToUsd } from "./money";
import { createAuthorizeOrder } from "./paypal";
import { paypalMode } from "./store";
import type { StoreData } from "./types";

/**
 * Server half of the official PayPal JS Buttons (createOrder). The browser never sets the amount:
 * the order is created for the reserved settlement amount of a payment that AgentPaL Guard already
 * allowed (or a human approved), bound to it via custom_id. Authorization and capture then run
 * through completePaymentAfterBuyer, which re-verifies amount / custom_id before capturing.
 */
export async function createButtonsOrder(store: StoreData, paymentId: string) {
  if (paypalMode() !== "sandbox") {
    throw new Error("PayPal sandbox is not configured (mock mode). Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Render.");
  }
  if (store.settings.kill_switch) {
    throw new Error("Kill switch is on. AgentPaL Guard will not create PayPal orders.");
  }
  const payment = store.payments.find((p) => p.payment_id === paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "awaiting_buyer") {
    throw new Error(`Payment is ${payment.status}; only Guard-approved payments awaiting the buyer can be paid`);
  }
  const reserved = store.reservations.find((r) => r.payment_id === paymentId && r.status === "reserved");
  if (!reserved) throw new Error("No open AgentPaL Guard reservation for this payment");

  const settlementAmount =
    payment.braintree?.settlement_amount ??
    payment.paypal?.settlement_amount ??
    (payment.currency === "INR" ? inrToUsd(payment.amount) : payment.amount);
  const fx = payment.braintree || payment.paypal;

  const order = await createAuthorizeOrder({
    amount: settlementAmount,
    currency: "USD",
    description: `${payment.merchant_name} via AgentPaL (agent on behalf of user)`,
    customId: payment.payment_id,
    requestId: `order-${payment.payment_id}`,
    returnUrl: "",
    cancelUrl: "",
  });
  payment.rail = "paypal_sandbox";
  payment.paypal = {
    mode: order.mode,
    order_id: order.order_id,
    settlement_currency: "USD",
    settlement_amount: settlementAmount,
    fx_rate: fx?.fx_rate,
    fx_label: fx?.fx_label,
  };
  payment.updated_at = nowIso();
  appendEvent(
    store,
    "payment.paypal.order_created",
    `PayPal sandbox order ${order.order_id} (intent AUTHORIZE) created by the official PayPal button for the reserved USD ${settlementAmount.toFixed(2)}. No capture has occurred.`,
    { goal_id: payment.goal_id, payment_id: payment.payment_id, order_id: order.order_id, mode: order.mode, provider: "paypal", source: "paypal-js" },
  );
  return { order_id: order.order_id };
}
