/**
 * Server-side trade-off approvals. The ONLY way a purchase that is "affordable with trade-offs" can
 * proceed is a record created here by the user's own click (POST /api/purchases/approvals). The record
 * binds SKU + catalog amount + currency + merchant + mandate, expires after 10 minutes and is single-use.
 * AI code never calls createTradeoffApproval and there is no model-visible argument that reaches it.
 */
import { verifyMandateSignature } from "./engine";
import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import type { Mandate, Merchant, StoreData, TradeoffApproval } from "./types";

export const TRADEOFF_APPROVAL_TTL_MS = 10 * 60 * 1000;

type CatalogProduct = Merchant["products"][number];

export function resolveCatalogSku(store: StoreData, sku: string): { merchant: Merchant; product: CatalogProduct } | null {
  for (const merchant of store.merchants) {
    const product = merchant.products.find((p) => p.sku === sku);
    if (product) return { merchant, product };
  }
  return null;
}

/** Active, signature-valid, user-signed mandate covering this merchant / category / currency. Never creates one. */
export function findCoveringMandate(store: StoreData, merchant: Merchant, product: CatalogProduct): Mandate | undefined {
  return store.mandates.find(
    (m) =>
      m.status === "active" &&
      m.currency === product.currency &&
      m.approved_merchants.includes(merchant.merchant_id) &&
      m.allowed_categories.includes(product.category) &&
      verifyMandateSignature(store, m),
  );
}

export function createTradeoffApproval(
  store: StoreData,
  sku: string,
  now = new Date(),
): { ok: true; approval: TradeoffApproval } | { ok: false; status: "unknown_sku" | "no_mandate"; message: string } {
  const found = resolveCatalogSku(store, sku);
  if (!found) return { ok: false, status: "unknown_sku", message: `Unknown SKU ${sku}` };
  const mandate = findCoveringMandate(store, found.merchant, found.product);
  if (!mandate) {
    return { ok: false, status: "no_mandate", message: "No active signed mandate covers this purchase. Sign one first." };
  }
  const approval: TradeoffApproval = {
    approval_id: id("tradeoff"),
    sku,
    merchant_id: found.merchant.merchant_id,
    mandate_id: mandate.mandate_id,
    amount: found.product.amount,
    currency: found.product.currency,
    created_by: "user_click",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TRADEOFF_APPROVAL_TTL_MS).toISOString(),
  };
  store.tradeoff_approvals.push(approval);
  appendEvent(store, "tradeoff.approved_by_user", `User accepted trade-offs for ${found.product.name} (single use, 10 min).`, {
    approval_id: approval.approval_id,
    sku,
    amount: approval.amount,
    currency: approval.currency,
    mandate_id: mandate.mandate_id,
  });
  return { ok: true, approval };
}

export type ApprovalBinding = { sku: string; amount: number; currency: string; merchant_id: string; mandate_id: string };

/** Validates and consumes (single use) an approval. Any mismatch, expiry, replay or unknown id is rejected. */
export function consumeTradeoffApproval(
  store: StoreData,
  approvalId: string | undefined,
  binding: ApprovalBinding,
  now = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (!approvalId) return { ok: false, reason: "missing" };
  const rec = store.tradeoff_approvals.find((a) => a.approval_id === approvalId);
  if (!rec || rec.created_by !== "user_click") return { ok: false, reason: "unknown_approval" };
  if (rec.used_at) return { ok: false, reason: "already_used" };
  const exp = Date.parse(rec.expires_at);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return { ok: false, reason: "expired" };
  if (
    rec.sku !== binding.sku ||
    rec.amount !== binding.amount ||
    rec.currency !== binding.currency ||
    rec.merchant_id !== binding.merchant_id ||
    rec.mandate_id !== binding.mandate_id
  ) {
    return { ok: false, reason: "binding_mismatch" };
  }
  rec.used_at = nowIso();
  return { ok: true };
}
