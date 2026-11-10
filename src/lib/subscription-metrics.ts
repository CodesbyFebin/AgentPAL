import type { ManagedSubscription, PriceChange, PriceChangeSource, RecurringLifecycle } from "./types";

export const MATERIAL_PRICE_SHIFT = 0.1;

export function lifecycleOf(sub: Pick<ManagedSubscription, "lifecycle" | "status">): RecurringLifecycle {
  if (sub.lifecycle) return sub.lifecycle;
  if (sub.status === "ended" || (sub.status as string) === "cancelled") return "ended";
  if (sub.status === "paused") return "paused";
  if (sub.status === "suggested") return "suggested";
  return "active";
}

export function isMaterialShift(previous: number, next: number): boolean {
  if (previous <= 0) return next > 0;
  return Math.abs(next - previous) / previous >= MATERIAL_PRICE_SHIFT;
}

export function raisedThisYear(sub: Pick<ManagedSubscription, "price_history">, year = 2026): number {
  return (sub.price_history || []).filter((c) => c.next > c.previous && c.effective_at.startsWith(String(year))).length;
}

/** Annualized delta: 12 × (current monthly amount − amount at the start of the year). */
export function annualizedDelta(sub: Pick<ManagedSubscription, "amount" | "price_history">, year = 2026): number {
  const yearChanges = (sub.price_history || []).filter((c) => c.effective_at.startsWith(String(year)));
  if (yearChanges.length === 0) return 0;
  const start = yearChanges[0].previous;
  return Math.round((sub.amount - start) * 12 * 100) / 100;
}

export function makePriceChange(
  previous: number,
  next: number,
  source: PriceChangeSource,
  change_id: string,
  effective_at: string,
): PriceChange {
  return {
    change_id,
    previous,
    next,
    effective_at,
    source,
    material: isMaterialShift(previous, next),
  };
}
