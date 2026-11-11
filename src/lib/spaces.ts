export const SPACES = ["My Money", "Family", "Business", "Focus"] as const;
export type MoneySpace = (typeof SPACES)[number];

export const DEFAULT_SPACE: MoneySpace = "My Money";
export const SPACE_STORAGE_KEY = "agentpal.space.v1";

export const SPACE_META: Record<MoneySpace, { slug: string; icon: string; hint: string }> = {
  "My Money": { slug: "my-money", icon: "💰", hint: "Every seeded transaction and mandate" },
  Family: { slug: "family", icon: "🌸", hint: "Groceries, housing, health and insurance" },
  Business: { slug: "business", icon: "💼", hint: "Loans, commute and work-tool mandates" },
  Focus: { slug: "focus", icon: "🎯", hint: "Entertainment and subscription mandates" },
};

const SLUG_TO_SPACE: Record<string, MoneySpace> = Object.fromEntries(
  SPACES.map((s) => [SPACE_META[s].slug, s]),
) as Record<string, MoneySpace>;

export function spaceToSlug(space: MoneySpace): string {
  return SPACE_META[space].slug;
}

export function parseSpace(raw: string | null | undefined): MoneySpace | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (key in SLUG_TO_SPACE) return SLUG_TO_SPACE[key];
  const named = SPACES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
  return named ?? null;
}

export function readStoredSpace(): MoneySpace {
  if (typeof window === "undefined") return DEFAULT_SPACE;
  return parseSpace(window.localStorage.getItem(SPACE_STORAGE_KEY)) ?? DEFAULT_SPACE;
}

const FAMILY_CATEGORIES = new Set(["Groceries", "Housing", "Health", "Insurance"]);
const BUSINESS_CATEGORIES = new Set(["Loans", "Transport"]);
const FOCUS_CATEGORIES = new Set(["Entertainment"]);

const FAMILY_MERCHANTS = /dmart|nature'?s basket|more supermarket|milkbasket|landlord|apollo|practo|star health/i;
const BUSINESS_MERCHANTS = /uber|hdfc car|indian oil|rapido/i;
const FOCUS_MERCHANTS = /bookmyshow|netflix|spotify/i;

/** Map a seeded ledger row to a space. Used at seed time and as a fallback for older rows. */
export function spaceForSeedTxn(input: { category: string; merchant: string }): MoneySpace {
  if (FOCUS_MERCHANTS.test(input.merchant) || FOCUS_CATEGORIES.has(input.category)) return "Focus";
  if (FAMILY_MERCHANTS.test(input.merchant) || FAMILY_CATEGORIES.has(input.category)) return "Family";
  if (BUSINESS_MERCHANTS.test(input.merchant) || BUSINESS_CATEGORIES.has(input.category)) return "Business";
  return "My Money";
}

export function spaceForMandate(input: { title?: string; allowed_categories?: string[] }): MoneySpace {
  const title = (input.title || "").toLowerCase();
  const cats = (input.allowed_categories || []).map((c) => c.toLowerCase());
  if (title.includes("subscription") || title.includes("software") || cats.includes("software")) return "Focus";
  if (title.includes("startup") || title.includes("tools") || title.includes("business") || cats.includes("api_credits")) {
    return "Business";
  }
  return "My Money";
}

/**
 * My Money is the overview: it shows every space.
 * Family, Business and Focus show only rows tagged with that space.
 */
export function matchesSpace(itemSpace: MoneySpace | string | undefined, filter: MoneySpace): boolean {
  if (filter === "My Money") return true;
  return (itemSpace || "My Money") === filter;
}
