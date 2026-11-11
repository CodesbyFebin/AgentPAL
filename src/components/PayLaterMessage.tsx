"use client";

import { useEffect, useState } from "react";
import { PayPalMessages, PayPalScriptProvider } from "@paypal/react-paypal-js";

type Cfg = { mode: "sandbox" | "mock"; clientId: string | null };

/**
 * Official PayPal Pay Later messaging (paypal-js `messages` component). Rendered by PayPal's SDK only
 * when a sandbox client ID is configured on the server; otherwise a clearly labelled placeholder.
 */
export function PayLaterMessage({ amountUsd }: { amountUsd: number }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/paypal/config")
      .then((r) => r.json() as Promise<Cfg>)
      .then((c) => alive && setCfg(c))
      .catch(() => alive && setCfg({ mode: "mock", clientId: null }));
    return () => {
      alive = false;
    };
  }, []);
  if (!cfg) return <p className="text-xs text-[var(--mm-muted)]">Loading Pay Later messaging…</p>;
  if (cfg.mode !== "sandbox" || !cfg.clientId) {
    return (
      <div data-testid="paylater-placeholder" className="rounded-xl border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Pay Later message preview: PayPal&apos;s SDK renders the official message here once <code>PAYPAL_CLIENT_ID</code> is set on the server. Mock mode, so nothing is rendered by PayPal.
      </div>
    );
  }
  return (
    <PayPalScriptProvider options={{ clientId: cfg.clientId, components: "messages", currency: "USD" }}>
      <PayPalMessages amount={amountUsd} style={{ layout: "text" }} />
    </PayPalScriptProvider>
  );
}
