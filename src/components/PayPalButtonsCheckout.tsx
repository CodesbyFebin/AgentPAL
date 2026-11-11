"use client";

import { useEffect, useState } from "react";
import { PayPalButtons, PayPalMessages, PayPalScriptProvider } from "@paypal/react-paypal-js";

type PayPalConfig = { mode: "sandbox" | "mock"; clientId: string | null; currency: string; intent: string };

let configPromise: Promise<PayPalConfig> | null = null;
function loadConfig(): Promise<PayPalConfig> {
  configPromise ??= fetch("/api/paypal/config")
    .then((r) => r.json() as Promise<PayPalConfig>)
    .catch(() => ({ mode: "mock" as const, clientId: null, currency: "USD", intent: "authorize" }));
  return configPromise;
}

/**
 * Official PayPal JS SDK buttons (@paypal/react-paypal-js). The client ID comes from our server
 * (/api/paypal/config); the secret never reaches the browser. createOrder and onApprove call our
 * routes, so AgentPaL Guard sets the amount, re-verifies the authorization and captures or voids.
 */
export function PayPalButtonsCheckout({
  paymentId,
  amountUsd,
  onComplete,
  onBeforePay,
}: {
  paymentId: string;
  amountUsd: number;
  onComplete: () => Promise<void> | void;
  onBeforePay?: () => Promise<boolean> | boolean;
}) {
  const [config, setConfig] = useState<PayPalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);

  if (!config) return <div className="mt-3 h-12 animate-pulse rounded-lg bg-[var(--mm-subtle)]" />;

  if (config.mode !== "sandbox" || !config.clientId) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-amber-400/70 bg-amber-50/60 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        data-testid="paypal-buttons-placeholder"
      >
        <p className="font-semibold">PayPal sandbox not configured — mock mode</p>
        <p className="mt-1">
          The official PayPal button (paypal-js) appears here once PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set on
          the server. Until then no PayPal order can be created from this screen.
        </p>
        <button type="button" disabled className="mt-2 w-full cursor-not-allowed rounded-full border border-amber-400/70 py-2 opacity-60">
          PayPal checkout unavailable (mock mode)
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[var(--mm-border)] p-3">
      <p className="text-[11px] text-[var(--mm-muted)]">
        PayPal sandbox via the official PayPal JS SDK. Amount USD {amountUsd.toFixed(2)} is fixed by the AgentPaL Guard
        reservation; capture happens only after Guard re-verifies the authorization.
      </p>
      {done ? (
        <p className="text-xs text-emerald-600">Authorized and verified. Refreshing…</p>
      ) : (
        <PayPalScriptProvider options={{ clientId: config.clientId, currency: "USD", intent: "authorize", components: "buttons,messages" }}>
          <PayPalMessages amount={amountUsd} placement="payment" />
          <PayPalButtons
            style={{ layout: "horizontal", tagline: false, height: 40 }}
            fundingSource="paypal"
            createOrder={async () => {
              setError(null);
              if (onBeforePay && !(await onBeforePay())) throw new Error("Cancelled during Zen pause");
              const res = await fetch("/api/paypal/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_id: paymentId }),
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error || "Could not create PayPal order");
              return body.order_id as string;
            }}
            onApprove={async (data) => {
              const res = await fetch(`/api/payments/${paymentId}/authorize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_id: data.orderID }),
              });
              const body = await res.json();
              if (!res.ok) {
                setError(body.error || "Authorization failed");
                return;
              }
              setDone(true);
              await onComplete();
            }}
            onError={(err) => setError(err instanceof Error ? err.message : String(err))}
          />
        </PayPalScriptProvider>
      )}
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
