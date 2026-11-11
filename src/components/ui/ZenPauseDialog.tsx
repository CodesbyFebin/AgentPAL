"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/kit";
import { formatINR, formatMoney } from "@/lib/money";
import type { ZenPrefs } from "@/lib/zen";
import { amountToInr } from "@/lib/zen";

export type ZenRequest = {
  amount: number;
  currency: string;
  label?: string;
  demo?: boolean;
};

export function ZenPauseDialog({
  open,
  request,
  prefs,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  request: ZenRequest | null;
  prefs: ZenPrefs;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [left, setLeft] = useState(prefs.seconds);

  useEffect(() => {
    if (!open) return;
    setLeft(prefs.seconds);
    const tick = window.setInterval(() => {
      setLeft((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [open, prefs.seconds, request?.amount, request?.label]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !request) return null;

  const ready = left <= 0;
  const amountLabel =
    request.currency.toUpperCase() === "INR"
      ? formatINR(request.amount)
      : formatMoney(request.amount, request.currency as "USD" | "INR" | "USDC");
  const inr = amountToInr(request.amount, request.currency);

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zen-title"
        className="mm-card mm-slide-up w-full max-w-md p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mm-zen-breathe mx-auto flex h-24 w-24 items-center justify-center rounded-full text-2xl font-semibold text-white"
          style={{ background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" }}
          aria-hidden="true"
        >
          {ready ? "✓" : left}
        </div>
        <h2 id="zen-title" className="mt-4 text-lg font-semibold">
          Zen pause
        </h2>
        <p className="mt-2 text-sm text-[var(--mm-muted)]">
          {request.demo
            ? "Demo preview of the breathing pause. Cancel or finish the countdown — no payment is sent."
            : "A short pause before this payment. Cancel aborts. AgentPaL Guard still applies after you continue."}
        </p>
        <p className="mt-3 text-xl font-semibold tabular">{amountLabel}</p>
        {request.label && <p className="mt-1 text-sm text-[var(--mm-muted)]">{request.label}</p>}
        {request.currency.toUpperCase() !== "INR" && (
          <p className="mt-1 text-[11px] text-[var(--mm-muted)]">About {formatINR(inr)} at the demo FX rate</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={onConfirm}>
            {ready ? (request.demo ? "Done" : "Continue to checkout") : `Wait ${left}s`}
          </Button>
        </div>
      </div>
    </div>
  );
}
