import { describe, expect, it } from "vitest";
import { seedTransactions } from "@/lib/finance-seed";
import { matchesSpace, parseSpace, spaceForMandate, spaceForSeedTxn, SPACES } from "@/lib/spaces";
import { ACCENT_THEMES, AURORA_THEME_IDS, nextAccentTheme, parseThemePrefs, parseThemeSlug } from "@/lib/ui-themes";

describe("spaces", () => {
  it("maps seeded merchants and categories onto the four spaces", () => {
    expect(spaceForSeedTxn({ category: "Groceries", merchant: "DMart Koramangala" })).toBe("Family");
    expect(spaceForSeedTxn({ category: "Housing", merchant: "Landlord NEFT" })).toBe("Family");
    expect(spaceForSeedTxn({ category: "Transport", merchant: "Uber" })).toBe("Business");
    expect(spaceForSeedTxn({ category: "Entertainment", merchant: "BookMyShow" })).toBe("Focus");
    expect(spaceForSeedTxn({ category: "Dining", merchant: "Third Wave Coffee" })).toBe("My Money");
    expect(spaceForSeedTxn({ category: "Income", merchant: "Acme Labs Pvt Ltd" })).toBe("My Money");
  });

  it("tags every seeded transaction with a known space", () => {
    const txs = seedTransactions();
    expect(txs.length).toBeGreaterThan(20);
    for (const t of txs) {
      expect(SPACES).toContain(t.space);
    }
    expect(txs.some((t) => t.space === "Family")).toBe(true);
    expect(txs.some((t) => t.space === "Business")).toBe(true);
    expect(txs.some((t) => t.space === "Focus")).toBe(true);
    expect(txs.some((t) => t.space === "My Money")).toBe(true);
  });

  it("treats My Money as the overview and maps mandates from their titles", () => {
    expect(matchesSpace("Family", "My Money")).toBe(true);
    expect(matchesSpace("Family", "Family")).toBe(true);
    expect(matchesSpace("Family", "Focus")).toBe(false);
    expect(spaceForMandate({ title: "Startup tools under $50", allowed_categories: ["api_credits"] })).toBe("Business");
    expect(spaceForMandate({ title: "Software subscriptions ≤ $30/month", allowed_categories: ["software"] })).toBe("Focus");
    expect(parseSpace("family")).toBe("Family");
    expect(parseSpace("my-money")).toBe("My Money");
  });
});

describe("accent themes", () => {
  it("includes the eight Aurora presets plus Classic Blue", () => {
    expect(AURORA_THEME_IDS).toEqual([
      "nova-aurora",
      "midnight-iris",
      "solar-flare",
      "ocean-glass",
      "neo-mint",
      "cyber-peach",
      "mono-chrome",
      "dia-sunglow",
    ]);
    for (const id of AURORA_THEME_IDS) {
      expect(ACCENT_THEMES[id].accent).toMatch(/^#/);
      expect(ACCENT_THEMES[id].accent2).toMatch(/^#/);
    }
  });

  it("parses ?theme= slugs and cycles to the next preset", () => {
    expect(parseThemeSlug("Nova Aurora")).toBe("nova-aurora");
    expect(parseThemeSlug("solar-flare")).toBe("solar-flare");
    expect(parseThemeSlug("classic-blue")).toBe("default");
    expect(parseThemeSlug("nope")).toBeNull();
    expect(nextAccentTheme("dia-sunglow")).toBe("default");
    expect(nextAccentTheme("default")).toBe("nova-aurora");
    expect(parseThemePrefs(JSON.stringify({ appearance: "dark", themeId: "cyber-peach" }))).toEqual({
      appearance: "dark",
      themeId: "cyber-peach",
    });
  });
});
