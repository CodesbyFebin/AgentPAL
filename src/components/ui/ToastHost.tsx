"use client";

export type Toast = { id: number; msg: string; tone?: "ok" | "warn" };

export function ToastHost({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[90] flex w-full max-w-[420px] -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto mm-slide-up rounded-full border border-[var(--mm-border)] bg-[var(--mm-surface)] px-4 py-2.5 text-[13px] font-medium shadow-lg"
        >
          <span className={t.tone === "warn" ? "text-[var(--mm-warning)]" : "text-[var(--mm-success)]"}>
            {t.tone === "warn" ? "!" : "✓"}
          </span>
          <span className="ml-2">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
