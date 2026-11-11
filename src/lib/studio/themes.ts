// 8 AgentPAL themes. Each maps to a [data-theme="..."] block in globals.css.
// Light mode is toggled separately via [data-mode="light"].

export type ThemeName =
  | "Aurora"
  | "Iris"
  | "Solar"
  | "Ocean"
  | "Mint"
  | "Peach"
  | "Mono"
  | "Sunglow";

export interface ThemeDef {
  name: ThemeName;
  mode: "Dark" | "Light";
  accent: string;
  accent2: string;
}

export const THEMES: ThemeDef[] = [
  { name: "Aurora", mode: "Dark", accent: "#0358F7", accent2: "#FD02F5" },
  { name: "Iris", mode: "Dark", accent: "#7B61FF", accent2: "#00D4FF" },
  { name: "Solar", mode: "Dark", accent: "#FA3D1D", accent2: "#FFD400" },
  { name: "Ocean", mode: "Dark", accent: "#00B8C7", accent2: "#5092C7" },
  { name: "Mint", mode: "Dark", accent: "#00C48C", accent2: "#A8FF3E" },
  { name: "Peach", mode: "Dark", accent: "#FF6B9D", accent2: "#FFB86B" },
  { name: "Mono", mode: "Dark", accent: "#E8E8E8", accent2: "#8A8A8A" },
  { name: "Sunglow", mode: "Dark", accent: "#FFAA00", accent2: "#FF5E9A" },
];

/** Inline gradient used by the header theme-cycle button + settings swatches. */
export function themeGradient(t: ThemeDef): string {
  return `linear-gradient(120deg, ${t.accent}, ${t.accent2})`;
}

/** Multi-color hero gradient (shared across all themes). */
export const HERO_GRADIENT =
  "linear-gradient(120deg, #0358F7, #5092C7, #E1E1FE, #FFD400, #FA3D1D, #FD02F5)";

export const ORDER: ThemeName[] = THEMES.map((t) => t.name);
