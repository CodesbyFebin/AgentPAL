export type AccentThemeId =
  | "default"
  | "nova-aurora"
  | "midnight-iris"
  | "solar-flare"
  | "ocean-glass"
  | "neo-mint"
  | "cyber-peach"
  | "mono-chrome"
  | "dia-sunglow";

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

/** Classic Blue plus the eight Aurora gradient presets. Style tokens only. */
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
    card: "#17112E",
  },
  "solar-flare": {
    id: "solar-flare",
    name: "Solar Flare",
    accent: "#FA3D1D",
    accent2: "#FFD400",
    bg: "#160B08",
    glow: "rgba(250,61,29,.42)",
    card: "#26120D",
  },
  "ocean-glass": {
    id: "ocean-glass",
    name: "Ocean Glass",
    accent: "#00B8C7",
    accent2: "#5092C7",
    bg: "#051418",
    glow: "rgba(0,184,199,.38)",
    card: "#0D242B",
  },
  "neo-mint": {
    id: "neo-mint",
    name: "Neo Mint",
    accent: "#00C48C",
    accent2: "#A8FF3E",
    bg: "#07130F",
    glow: "rgba(0,196,140,.38)",
    card: "#10251D",
  },
  "cyber-peach": {
    id: "cyber-peach",
    name: "Cyber Peach",
    accent: "#FF6B9D",
    accent2: "#FFB86B",
    bg: "#17101A",
    glow: "rgba(255,107,157,.4)",
    card: "#281D2E",
  },
  "mono-chrome": {
    id: "mono-chrome",
    name: "Mono Chrome",
    accent: "#E8E8E8",
    accent2: "#8A8A8A",
    bg: "#0A0A0A",
    glow: "rgba(232,232,232,.22)",
    card: "#171717",
  },
  "dia-sunglow": {
    id: "dia-sunglow",
    name: "Dia Sunglow",
    accent: "#FFAA00",
    accent2: "#FF5E9A",
    bg: "#181008",
    glow: "rgba(255,170,0,.4)",
    card: "#271E0F",
  },
};

/** The eight named Aurora presets shown in the picker (Classic Blue stays as the stored default). */
export const AURORA_THEME_IDS: AccentThemeId[] = [
  "nova-aurora",
  "midnight-iris",
  "solar-flare",
  "ocean-glass",
  "neo-mint",
  "cyber-peach",
  "mono-chrome",
  "dia-sunglow",
];

export const THEME_STORAGE_KEY = "moneymate.theme.v1";

export type ThemePrefs = {
  appearance: Appearance;
  themeId: AccentThemeId;
};

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  appearance: "light",
  themeId: "default",
};

export function parseThemeSlug(raw: string | null | undefined): AccentThemeId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (key === "classic-blue") return "default";
  if (key in ACCENT_THEMES) return key as AccentThemeId;
  const byName = Object.values(ACCENT_THEMES).find((t) => t.name.toLowerCase() === raw.trim().toLowerCase());
  return byName?.id ?? null;
}

export function parseThemePrefs(raw: string | null): ThemePrefs {
  if (!raw) return DEFAULT_THEME_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    const appearance = parsed.appearance === "dark" ? "dark" : "light";
    const themeId = parseThemeSlug(parsed.themeId ?? null) ?? "default";
    return { appearance, themeId };
  } catch {
    return DEFAULT_THEME_PREFS;
  }
}

export function nextAccentTheme(id: AccentThemeId): AccentThemeId {
  const ids = Object.keys(ACCENT_THEMES) as AccentThemeId[];
  const i = ids.indexOf(id);
  return ids[(i + 1) % ids.length];
}

export function applyThemeToDocument(prefs: ThemePrefs) {
  if (typeof document === "undefined") return;
  const theme = ACCENT_THEMES[prefs.themeId] ?? ACCENT_THEMES.default;
  const root = document.documentElement;
  root.dataset.appearance = prefs.appearance;
  root.dataset.theme = prefs.themeId;
  // Near-white Mono Chrome accents disappear on the light canvas, so use ink tones there.
  const accent = prefs.appearance === "light" && prefs.themeId === "mono-chrome" ? "#374151" : theme.accent;
  const accent2 = prefs.appearance === "light" && prefs.themeId === "mono-chrome" ? "#6B7280" : theme.accent2;
  root.style.setProperty("--mm-accent", accent);
  root.style.setProperty("--mm-accent-2", accent2);
  root.style.setProperty("--mm-glow", theme.glow);
  if (prefs.appearance === "dark") {
    root.style.setProperty("--mm-theme-bg", theme.bg);
    root.style.setProperty("--mm-theme-card", theme.card);
  } else {
    root.style.removeProperty("--mm-theme-bg");
    root.style.removeProperty("--mm-theme-card");
  }
}
