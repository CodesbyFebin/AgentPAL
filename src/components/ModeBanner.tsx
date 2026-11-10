"use client";

import { useEffect, useState } from "react";
import type { PaymentMode } from "@/lib/payment-mode";

export function ModeBanner() {
  const [mode, setMode] = useState<PaymentMode | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { paymentMode?: PaymentMode }) => {
        if (!cancelled && data.paymentMode) setMode(data.paymentMode);
      })
      .catch(() => {
        if (!cancelled) setMode("mock");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === "loading") {
    return (
      <div role="status" className="bg-ink-800 px-4 py-2 text-center text-sm font-semibold text-zinc-300">
        Checking payment mode…
      </div>
    );
  }

  if (mode === "mock") {
    return (
      <div role="status" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-ink-950">
        MOCK payments: no real or sandbox money moved
      </div>
    );
  }

  if (mode === "braintree-sandbox" || mode === "braintree-production") {
    return (
      <div role="status" className="bg-mesh-500 px-4 py-2 text-center text-sm font-semibold text-ink-950">
        Braintree sandbox — checkout hits the Braintree sandbox, not live money
      </div>
    );
  }

  return (
    <div role="status" className="bg-mesh-500 px-4 py-2 text-center text-sm font-semibold text-ink-950">
      PayPal Sandbox — checkout hits the PayPal sandbox, not live money
    </div>
  );
}
