"use client";

import { useEffect, useRef, useState } from "react";

const DROPIN_SRC = "https://js.braintreegateway.com/web/dropin/1.46.0/js/dropin.min.js";

type DropinInstance = {
  requestPaymentMethod: () => Promise<{ nonce: string }>;
  teardown: () => Promise<void>;
};

declare global {
  interface Window {
    braintree?: {
      dropin: {
        create: (opts: Record<string, unknown>) => Promise<DropinInstance>;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadDropinScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.braintree?.dropin) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${DROPIN_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Braintree Drop-in")));
      return;
    }
    const script = document.createElement("script");
    script.src = DROPIN_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Braintree Drop-in"));
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export function BraintreeCheckout({
  paymentId,
  amountUsd,
  onComplete,
}: {
  paymentId: string;
  amountUsd: number;
  onComplete: () => Promise<void> | void;
}) {
  const containerId = `bt-dropin-${paymentId}`;
  const instanceRef = useRef<DropinInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch("/api/braintree/client-token");
        const tokenBody = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenBody.error || "Could not issue a client token");
        await loadDropinScript();
        if (cancelled || !window.braintree?.dropin) return;
        const instance = await window.braintree.dropin.create({
          authorization: tokenBody.clientToken,
          container: `#${containerId}`,
          paypal: {
            flow: "checkout",
            amount: amountUsd.toFixed(2),
            currency: "USD",
          },
        });
        if (cancelled) {
          await instance.teardown();
          return;
        }
        instanceRef.current = instance;
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Drop-in failed to start");
      }
    })();
    return () => {
      cancelled = true;
      instanceRef.current?.teardown().catch(() => undefined);
      instanceRef.current = null;
    };
  }, [amountUsd, containerId, paymentId]);

  const pay = async () => {
    if (!instanceRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await instanceRef.current.requestPaymentMethod();
      const res = await fetch(`/api/payments/${paymentId}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method_nonce: payload.nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Authorization failed");
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-ink-950/40 p-3">
      <p className="text-[11px] text-zinc-400">
        Braintree sandbox checkout. Use card 4111 1111 1111 1111, any future expiry, and any CVV, or the PayPal
        sandbox button if it appears. This is not a Braintree or PayPal product.
      </p>
      <div id={containerId} className="min-h-[40px]" />
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <button
        type="button"
        disabled={!ready || busy}
        className="rounded-full bg-mesh-500 px-3 py-1 text-xs text-ink-950 disabled:opacity-50"
        onClick={pay}
      >
        {busy ? "Authorizing…" : `Pay ${amountUsd.toFixed(2)} USD`}
      </button>
    </div>
  );
}
