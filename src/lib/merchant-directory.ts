import type { CategoryRecord, Merchant, MerchantProfile, StoreData } from "./types";

export function normalizeMerchantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(demo\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function seedCategories(): CategoryRecord[] {
  return [
    { category_id: "cat_income", name: "Income", type: "income" },
    { category_id: "cat_transfer", name: "Transfers", type: "transfer" },
    { category_id: "cat_housing", name: "Housing", type: "expense" },
    { category_id: "cat_groceries", name: "Groceries", type: "expense" },
    { category_id: "cat_dining", name: "Dining", type: "expense" },
    { category_id: "cat_transport", name: "Transport", type: "expense" },
    { category_id: "cat_utilities", name: "Utilities", type: "expense" },
    { category_id: "cat_software", name: "software", type: "subscription" },
    { category_id: "cat_electronics", name: "Electronics", type: "expense" },
  ];
}

export function seedMerchantDirectory(catalog: Merchant[], extraNames: string[] = []): MerchantProfile[] {
  const byNorm = new Map<string, MerchantProfile>();
  const add = (name: string, opts: Partial<MerchantProfile> = {}) => {
    const normalized_name = normalizeMerchantName(name);
    if (!normalized_name) return;
    const existing = byNorm.get(normalized_name);
    if (existing) {
      if (name !== existing.name && !existing.aliases.includes(name)) existing.aliases.push(name);
      if (opts.risk_flags) existing.risk_flags = Array.from(new Set([...existing.risk_flags, ...opts.risk_flags]));
      return;
    }
    byNorm.set(normalized_name, {
      merchant_profile_id: `merp_${normalized_name.replace(/\s+/g, "_").slice(0, 40)}`,
      merchant_id: opts.merchant_id,
      name,
      normalized_name,
      aliases: opts.aliases ?? [],
      category: opts.category,
      risk_flags: opts.risk_flags ?? [],
    });
  };
  for (const m of catalog) {
    add(m.name, {
      merchant_id: m.merchant_id,
      category: m.category,
      risk_flags: m.injection_bait ? ["prompt_injection", "untrusted_listing"] : [],
    });
  }
  for (const name of extraNames) add(name);
  return [...byNorm.values()];
}

export function repeatedMerchantSpend(store: StoreData, month?: string) {
  const m = month || store.finance?.profile.as_of.slice(0, 7);
  const buckets = new Map<string, { name: string; normalized_name: string; spend: number; count: number; risk_flags: string[] }>();
  const profiles = store.merchant_directory || [];
  for (const t of store.finance?.transactions ?? []) {
    if (t.amount >= 0) continue;
    if (m && t.posted_at.slice(0, 7) !== m) continue;
    const normalized_name = normalizeMerchantName(t.merchant);
    const profile = profiles.find((p) => p.normalized_name === normalized_name || p.aliases.some((a) => normalizeMerchantName(a) === normalized_name));
    const key = profile?.normalized_name || normalized_name;
    const cur = buckets.get(key) ?? {
      name: profile?.name || t.merchant,
      normalized_name: key,
      spend: 0,
      count: 0,
      risk_flags: profile?.risk_flags ?? [],
    };
    cur.spend = Math.round((cur.spend + Math.abs(t.amount)) * 100) / 100;
    cur.count += 1;
    buckets.set(key, cur);
  }
  return [...buckets.values()].sort((a, b) => b.spend - a.spend);
}

export function merchantSpendVersusMandates(store: StoreData) {
  const spend = repeatedMerchantSpend(store);
  return store.mandates.filter((m) => m.status === "active").map((mandate) => ({
    mandate_id: mandate.mandate_id,
    title: mandate.title,
    max_total_spend: mandate.max_total_spend,
    currency: mandate.currency,
    merchants: spend.filter((s) => {
      const profile = (store.merchant_directory || []).find((p) => p.normalized_name === s.normalized_name);
      return profile?.merchant_id ? mandate.approved_merchants.includes(profile.merchant_id) : false;
    }),
  }));
}
