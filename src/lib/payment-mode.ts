export type PaymentMode =
  | "braintree-sandbox"
  | "braintree-production"
  | "paypal-sandbox"
  | "mock";

export type CheckoutRail = "braintree_sandbox" | "paypal_sandbox";

export function hasBraintreeCreds(): boolean {
  return Boolean(
    process.env.BRAINTREE_MERCHANT_ID &&
      process.env.BRAINTREE_PUBLIC_KEY &&
      process.env.BRAINTREE_PRIVATE_KEY,
  );
}

export function hasPayPalCreds(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function braintreeEnvName(): "sandbox" | "production" {
  const raw = (process.env.BRAINTREE_ENV || "sandbox").toLowerCase();
  return raw === "production" || raw === "live" ? "production" : "sandbox";
}

/** Precedence: Braintree, then PayPal REST, then labelled mock. */
export function paymentMode(): PaymentMode {
  if (hasBraintreeCreds()) {
    return braintreeEnvName() === "production" ? "braintree-production" : "braintree-sandbox";
  }
  if (hasPayPalCreds()) return "paypal-sandbox";
  return "mock";
}

export function checkoutRail(): CheckoutRail {
  return paymentMode().startsWith("braintree") ? "braintree_sandbox" : "paypal_sandbox";
}

export function isBraintreeMode(mode: PaymentMode = paymentMode()): boolean {
  return mode.startsWith("braintree");
}
