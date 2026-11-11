export type AccentThemeId =
  | "default"
  | "nova-aurora"
  | "midnight-iris"
  | "ocean-glass"
  | "neo-mint";

export type Appearance = "light" | "dark";

export type AccentTheme = {
  id: AccentThemeId;
  name: string;
  accent: string;
  accent2: string;
  bg: string;
  glow: string;
  card: string;
};

/** Playbook default plus four Ardia gradient presets (style tokens only). */
export const ACCENT_THEMES: Record<AccentThemeId, AccentTheme> = {
  default: {
    id: "default",
    name: "Classic Blue",
    accent: "#2563EB",
    accent2: "#7C3AED",
    bg: "#080F24",
    glow: "rgba(37,99,235,.42)",
    card: "#111B35",
  },
  "nova-aurora": {
    id: "nova-aurora",
    name: "Nova Aurora",
    accent: "#0358F7",
    accent2: "#FD02F5",
    bg: "#070913",
    glow: "rgba(3,88,247,.42)",
    card: "#121527",
  },
  "midnight-iris": {
    id: "midnight-iris",
    name: "Midnight Iris",
    accent: "#7B61FF",
    accent2: "#00D4FF",
    bg: "#0B071A",
    glow: "rgba(123,97,255,.45)",
    card: "#171029",
  },
  "ocean-glass": {
    id: "ocean-glass",
    name: "Ocean Glass",
    accent: "#00B8C7",
    accent2: "#5092C7",
    bg: "#051418",
    glow: "rgba(0,184,199,.4)",
    card: "#0B1D25",
  },
  "neo-mint": {
    id: "neo-mint",
    name: "Neo Mint",
    accent: "#00C48C",
    accent2: "#A8FF3E",
    bg: "#07130F",
    glow: "rgba(0,196,140,.38)",
    card: "#0F211A",
  },
};

export const THEME_STORAGE_KEY = "moneymate.theme.v1";

export type ThemePrefs = {
  appearance: Appearance;
  themeId: AccentThemeId;
};

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  appearance: "light",
  themeId: "default",
};

export function parseThemePrefs(raw: string | null): ThemePrefs {
  if (!raw) return DEFAULT_THEME_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    const appearance = parsed.appearance === "dark" ? "dark" : "light";
    const themeId = parsed.themeId && parsed.themeId in ACCENT_THEMES ? parsed.themeId : "default";
    return { appearance, themeId };
  } catch {
    return DEFAULT_THEME_PREFS;
  }
}

export function applyThemeToDocument(prefs: ThemePrefs) {
  if (typeof document === "undefined") return;
  const theme = ACCENT_THEMES[prefs.themeId];
  const root = document.documentElement;
  root.dataset.appearance = prefs.appearance;
  root.dataset.theme = prefs.themeId;
  root.style.setProperty("--mm-accent", theme.accent);
  root.style.setProperty("--mm-accent-2", theme.accent2);
  root.style.setProperty("--mm-glow", theme.glow);
  if (prefs.appearance === "dark") {
    root.style.setProperty("--mm-theme-bg", theme.bg);
    root.style.setProperty("--mm-theme-card", theme.card);
  } else {
    root.style.removeProperty("--mm-theme-bg");
    root.style.removeProperty("--mm-theme-card");
  }
}
