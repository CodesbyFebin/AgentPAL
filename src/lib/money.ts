/** PayPal REST currency codes (as of 17 Aug 2026) do not include INR. */
export const DEMO_FX = {
  inrPerUsd: 83,
  paypalCurrency: "USD" as const,
  label:
    "Demo fixed rate: ₹83.00 = US$1.00. Sandbox checkout is submitted in USD because INR is not a settlement currency in this demo. This rate is not a live FX quote.",
  source: "demo fixed rate" as const,
  docsUrl: "https://developer.paypal.com/api/codes/currency",
};

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function inrToUsd(inr: number): number {
  return roundMoney(inr / DEMO_FX.inrPerUsd);
}

export function usdToInr(usd: number): number {
  return roundMoney(usd * DEMO_FX.inrPerUsd);
}

export const SUPPORTED_CURRENCIES = ["INR", "USD", "USDC"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

function assertSupported(currency: string): asserts currency is SupportedCurrency {
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    throw new Error(`Unsupported currency ${currency}. This demo only converts INR, USD and USDC at fixed demo rates.`);
  }
}

/**
 * Converts to USD at FIXED DEMO rates (₹83 = US$1; USDC treated 1:1 with USD in the simulated x402 rail).
 * Unsupported currencies are rejected instead of being silently treated as USD.
 */
export function toUsd(amount: number, currency: string): number {
  assertSupported(currency);
  if (!Number.isFinite(amount)) throw new Error("amount must be a finite number");
  return currency === "INR" ? inrToUsd(amount) : roundMoney(amount);
}

/** Converts to INR at the fixed demo rate (see DEMO_FX.label). Unsupported currencies are rejected. */
export function toInr(amount: number, currency: string): number {
  assertSupported(currency);
  if (!Number.isFinite(amount)) throw new Error("amount must be a finite number");
  return currency === "INR" ? roundMoney(amount) : usdToInr(amount);
}

export function formatINR(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-₹${formatted}` : `₹${formatted}`;
}

export function formatUSD(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatMoney(amount: number, currency: string = "USD"): string {
  if (currency === "INR") return formatINR(amount);
  if (currency === "USDC") return `${amount.toFixed(2)} USDC`;
  return formatUSD(amount);
}

export function fxBreakdown(inr: number): {
  inr: number;
  usd: number;
  rate: number;
  label: string;
} {
  return {
    inr: roundMoney(inr),
    usd: inrToUsd(inr),
    rate: DEMO_FX.inrPerUsd,
    label: DEMO_FX.label,
  };
}
