"use client";

import { X } from "lucide-react";
import { useStore } from "@/lib/studio/store";

export default function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass-sm slide-up pointer-events-auto flex items-center gap-2 px-3.5 py-2 text-sm"
          style={{ color: "var(--text)" }}
        >
          <span className="dot" />
          <span>{t.msg}</span>
          <button onClick={() => dismissToast(t.id)} style={{ color: "var(--muted)" }} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
