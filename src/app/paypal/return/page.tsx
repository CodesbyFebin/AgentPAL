"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ReturnInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState("Completing PayPal authorization…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const paymentId = params.get("payment_id");
    const token = params.get("token");
    if (!paymentId) {
      setError("Missing payment_id on the return URL.");
      return;
    }
    fetch(`/api/payments/${paymentId}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Authorize failed");
        const st = data.payment?.status;
        setStatus(
          st === "captured"
            ? "Verification passed. PayPal authorization was captured."
            : st === "voided"
              ? "Verification failed. PayPal authorization was voided. No funds were captured."
              : `Payment status: ${st}`,
        );
      })
      .catch((err: Error) => setError(err.message));
  }, [params]);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-xs uppercase tracking-[0.2em] text-mesh-400">MoneyMate Mesh · checkout return</p>
      <h1 className="mt-3 font-display text-3xl text-white">Buyer approval received</h1>
      <p className="mt-4 text-zinc-300">{error ?? status}</p>
      <a href="/" className="mt-8 inline-block text-mesh-400 underline-offset-4 hover:underline">
        Back to MoneyMate Mesh
      </a>
    </main>
  );
}

export default function PayPalReturnPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-zinc-400">Loading…</main>}>
      <ReturnInner />
    </Suspense>
  );
}
