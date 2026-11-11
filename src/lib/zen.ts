import { DEMO_FX } from "./money";

export const ZEN_STORAGE_KEY = "agentpal.zen.v1";
export const DEFAULT_ZEN_SECONDS = 5;
export const DEFAULT_ZEN_THRESHOLD_INR = 5000;

export type ZenPrefs = {
  enabled: boolean;
  thresholdInr: number;
  seconds: number;
};

export const DEFAULT_ZEN_PREFS: ZenPrefs = {
  enabled: true,
  thresholdInr: DEFAULT_ZEN_THRESHOLD_INR,
  seconds: DEFAULT_ZEN_SECONDS,
};

export function parseZenPrefs(raw: string | null | undefined): ZenPrefs {
  if (!raw) return { ...DEFAULT_ZEN_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ZenPrefs>;
    const thresholdInr =
      typeof parsed.thresholdInr === "number" && Number.isFinite(parsed.thresholdInr) && parsed.thresholdInr >= 0
        ? parsed.thresholdInr
        : DEFAULT_ZEN_THRESHOLD_INR;
    const seconds =
      typeof parsed.seconds === "number" && Number.isFinite(parsed.seconds)
        ? Math.max(1, Math.min(30, Math.round(parsed.seconds)))
        : DEFAULT_ZEN_SECONDS;
    return {
      enabled: parsed.enabled !== false,
      thresholdInr,
      seconds,
    };
  } catch {
    return { ...DEFAULT_ZEN_PREFS };
  }
}

export function amountToInr(amount: number, currency?: string): number {
  const ccy = (currency || "INR").toUpperCase();
  if (ccy === "INR") return amount;
  return amount * DEMO_FX.inrPerUsd;
}

/** True when Zen Mode is on and the amount (converted to INR) meets or exceeds the threshold. */
export function shouldZenPause(amount: number, currency: string | undefined, prefs: ZenPrefs = DEFAULT_ZEN_PREFS): boolean {
  if (!prefs.enabled) return false;
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return amountToInr(amount, currency) >= prefs.thresholdInr;
}
