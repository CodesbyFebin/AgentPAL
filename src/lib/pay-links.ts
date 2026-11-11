import QRCode from "qrcode";
import { signPayload, verifyPayload } from "./crypto";
import { appendEvent } from "./events";
import { id, nowIso } from "./ids";
import { formatMoney } from "./money";
import type { PaymentLink, StoreData } from "./types";

export const DEMO_QR_DISCLAIMER = "Demo QR — opens AgentPaL checkout, not a real UPI request";

export type PaymentLinkBlockCode =
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "kill_switch"
  | "mandate_inactive"
  | "cap_exceeded"
  | "invalid_amount"
  | "signature_invalid";

export type PaymentLinkEvaluation =
  | { ok: true; link: PaymentLink }
  | { ok: false; code: PaymentLinkBlockCode; message: string; link?: PaymentLink };

/** Sign only immutable link identity. Status, uses and revocation are not part of the signature. */
function unsignedLinkBody(link: PaymentLink | Omit<PaymentLink, "signature">) {
  const {
    signature: _signature,
    status: _status,
    use_count: _useCount,
    payments: _payments,
    disabled_reason: _disabled,
    revoked_at: _revoked,
    ...rest
  } = link as PaymentLink;
  void _signature;
  void _status;
  void _useCount;
  void _payments;
  void _disabled;
  void _revoked;
  return rest;
}

export function appOrigin(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function paymentLinkPath(linkId: string): string {
  return `/pay/${encodeURIComponent(linkId)}`;
}

export function paymentLinkUrl(linkId: string, origin?: string): string {
  return `${(origin || appOrigin()).replace(/\/$/, "")}${paymentLinkPath(linkId)}`;
}

export async function paymentLinkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
    color: { dark: "#0b1b3a", light: "#ffffff" },
  });
}

export function syncPaymentLinkStatus(store: StoreData, link: PaymentLink, now = new Date()): PaymentLink {
  if (link.status === "revoked") return link;

  const expires = new Date(link.expires_at);
  if (Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime()) {
    if (link.status !== "expired") {
      link.status = "expired";
      appendEvent(store, "pay_link.expired", `Payment link ${link.link_id} expired`, {
        link_id: link.link_id,
        mandate_id: link.mandate_id,
        expires_at: link.expires_at,
      });
    }
    return link;
  }

  if (link.use_count >= link.max_uses) {
    if (link.status !== "exhausted") {
      link.status = "exhausted";
      appendEvent(store, "pay_link.exhausted", `Payment link ${link.link_id} reached its use cap`, {
        link_id: link.link_id,
        mandate_id: link.mandate_id,
        use_count: link.use_count,
        max_uses: link.max_uses,
      });
    }
    return link;
  }

  if (store.settings.kill_switch) {
    if (link.status !== "disabled") {
      link.status = "disabled";
      link.disabled_reason = "kill_switch";
      appendEvent(store, "pay_link.disabled", `Payment link ${link.link_id} disabled by the kill switch`, {
        link_id: link.link_id,
        mandate_id: link.mandate_id,
        reason: "kill_switch",
      });
    }
    return link;
  }

  const mandate = store.mandates.find((m) => m.mandate_id === link.mandate_id);
  if (mandate && mandate.status !== "active") {
    if (link.status !== "disabled") {
      link.status = "disabled";
      link.disabled_reason = "mandate_revoked";
      appendEvent(store, "pay_link.disabled", `Payment link ${link.link_id} disabled because its mandate is ${mandate.status}`, {
        link_id: link.link_id,
        mandate_id: link.mandate_id,
        reason: "mandate_inactive",
        mandate_status: mandate.status,
      });
    }
    return link;
  }

  if (link.status === "disabled" && link.disabled_reason === "kill_switch" && !store.settings.kill_switch) {
    link.status = "active";
    link.disabled_reason = undefined;
    appendEvent(store, "pay_link.reenabled", `Payment link ${link.link_id} re-enabled after the kill switch was released`, {
      link_id: link.link_id,
      mandate_id: link.mandate_id,
    });
  }

  return link;
}

export function syncAllPaymentLinks(store: StoreData, now = new Date()): void {
  for (const link of store.payment_links) {
    syncPaymentLinkStatus(store, link, now);
  }
}

export function verifyPaymentLinkSignature(link: PaymentLink): boolean {
  return verifyPayload(unsignedLinkBody(link), link.public_key, link.signature);
}

export function evaluatePaymentLink(
  store: StoreData,
  linkOrId: PaymentLink | string,
  amount: number,
  now = new Date(),
): PaymentLinkEvaluation {
  const link = typeof linkOrId === "string" ? store.payment_links.find((l) => l.link_id === linkOrId) : linkOrId;
  if (!link) {
    return { ok: false, code: "not_found", message: "Payment link not found." };
  }

  syncPaymentLinkStatus(store, link, now);

  if (!verifyPaymentLinkSignature(link)) {
    return { ok: false, code: "signature_invalid", message: "Payment link signature is invalid.", link };
  }

  if (store.settings.kill_switch || link.status === "disabled" && link.disabled_reason === "kill_switch") {
    return {
      ok: false,
      code: "kill_switch",
      message: "Kill switch is on. This payment link is disabled until a human turns it off.",
      link,
    };
  }

  if (link.status === "revoked") {
    return { ok: false, code: "revoked", message: "This payment link has been revoked.", link };
  }

  if (link.status === "expired") {
    return { ok: false, code: "expired", message: `This payment link expired at ${link.expires_at}.`, link };
  }

  if (link.status === "exhausted") {
    return {
      ok: false,
      code: "exhausted",
      message: `This payment link has already been used ${link.use_count} of ${link.max_uses} allowed time(s).`,
      link,
    };
  }

  if (link.status === "disabled") {
    return {
      ok: false,
      code: "mandate_inactive",
      message: "This payment link is disabled because its mandate is no longer active.",
      link,
    };
  }

  const mandate = store.mandates.find((m) => m.mandate_id === link.mandate_id);
  if (!mandate || mandate.status !== "active") {
    return {
      ok: false,
      code: "mandate_inactive",
      message: "The mandate behind this payment link is not active.",
      link,
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "invalid_amount", message: "Purchase amount must be greater than zero.", link };
  }

  if (amount - link.amount_cap > 1e-9) {
    return {
      ok: false,
      code: "cap_exceeded",
      message: `${formatMoney(amount, link.currency)} exceeds this link's amount cap of ${formatMoney(link.amount_cap, link.currency)}.`,
      link,
    };
  }

  return { ok: true, link };
}

export function createPaymentLink(
  store: StoreData,
  input: {
    mandate_id: string;
    amount_cap: number;
    expires_at?: string;
    use_type?: PaymentLink["use_type"];
    max_uses?: number;
    merchant_id?: string;
    product_sku?: string;
    description?: string;
    currency?: PaymentLink["currency"];
  },
): PaymentLink {
  const mandate = store.mandates.find((m) => m.mandate_id === input.mandate_id);
  if (!mandate) throw new Error("Mandate not found");
  if (mandate.status !== "active") throw new Error("Mandate is not active");
  if (!Number.isFinite(input.amount_cap) || input.amount_cap <= 0) {
    throw new Error("amount_cap must be greater than zero");
  }

  let merchant_name: string | undefined;
  if (input.merchant_id) {
    if (!mandate.approved_merchants.includes(input.merchant_id)) {
      throw new Error("Merchant is not on the mandate allowlist");
    }
    merchant_name = store.merchants.find((m) => m.merchant_id === input.merchant_id)?.name;
  }

  const use_type = input.use_type ?? "single";
  const max_uses = use_type === "single" ? 1 : Math.max(1, input.max_uses ?? 10);
  const expires_at = input.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const unsigned: Omit<PaymentLink, "signature"> = {
    link_id: id("plink"),
    mandate_id: mandate.mandate_id,
    goal_id: mandate.goal_id,
    merchant_id: input.merchant_id,
    merchant_name,
    product_sku: input.product_sku,
    description: input.description,
    amount_cap: input.amount_cap,
    currency: input.currency ?? mandate.currency,
    expires_at,
    use_type,
    max_uses,
    use_count: 0,
    status: "active",
    payments: [],
    public_key: store.settings.signing.publicKeyPem,
    created_at: nowIso(),
  };
  const signature = signPayload(unsignedLinkBody(unsigned), store.settings.signing.privateKeyPem);
  const link: PaymentLink = { ...unsigned, signature };
  store.payment_links.push(link);
  appendEvent(
    store,
    "pay_link.created",
    `Signed payment link ${link.link_id} created under mandate ${mandate.mandate_id} (cap ${formatMoney(link.amount_cap, link.currency)}, ${link.use_type} use, expires ${link.expires_at})`,
    {
      link_id: link.link_id,
      mandate_id: link.mandate_id,
      goal_id: link.goal_id,
      amount_cap: link.amount_cap,
      currency: link.currency,
      use_type: link.use_type,
      max_uses: link.max_uses,
      expires_at: link.expires_at,
      merchant_id: link.merchant_id,
      product_sku: link.product_sku,
    },
  );
  return link;
}

export function revokePaymentLink(store: StoreData, linkId: string): PaymentLink {
  const link = store.payment_links.find((l) => l.link_id === linkId);
  if (!link) throw new Error("Payment link not found");
  if (link.status === "revoked") return link;
  link.status = "revoked";
  link.revoked_at = nowIso();
  appendEvent(store, "pay_link.revoked", `Payment link ${link.link_id} revoked`, {
    link_id: link.link_id,
    mandate_id: link.mandate_id,
  });
  return link;
}

export function disablePaymentLinksForKillSwitch(store: StoreData): PaymentLink[] {
  const changed: PaymentLink[] = [];
  for (const link of store.payment_links) {
    if (link.status === "active") {
      link.status = "disabled";
      link.disabled_reason = "kill_switch";
      appendEvent(store, "pay_link.disabled", `Payment link ${link.link_id} auto-disabled by the kill switch`, {
        link_id: link.link_id,
        mandate_id: link.mandate_id,
        reason: "kill_switch",
      });
      changed.push(link);
    }
  }
  return changed;
}

export function reenablePaymentLinksAfterKillSwitch(store: StoreData): PaymentLink[] {
  const changed: PaymentLink[] = [];
  for (const link of store.payment_links) {
    if (link.status === "disabled" && link.disabled_reason === "kill_switch") {
      const next = syncPaymentLinkStatus(store, link);
      if (next.status === "active") changed.push(next);
    }
  }
  return changed;
}

export function disablePaymentLinksForMandate(store: StoreData, mandateId: string): void {
  for (const link of store.payment_links) {
    if (link.mandate_id === mandateId && (link.status === "active" || (link.status === "disabled" && link.disabled_reason === "kill_switch"))) {
      link.status = "disabled";
      link.disabled_reason = "mandate_revoked";
      appendEvent(store, "pay_link.disabled", `Payment link ${link.link_id} disabled because its mandate was revoked`, {
        link_id: link.link_id,
        mandate_id: mandateId,
        reason: "mandate_revoked",
      });
    }
  }
}

export function publicPaymentLinkView(link: PaymentLink, origin?: string) {
  return {
    link_id: link.link_id,
    mandate_id: link.mandate_id,
    goal_id: link.goal_id,
    merchant_id: link.merchant_id,
    merchant_name: link.merchant_name,
    product_sku: link.product_sku,
    description: link.description,
    amount_cap: link.amount_cap,
    currency: link.currency,
    expires_at: link.expires_at,
    use_type: link.use_type,
    max_uses: link.max_uses,
    use_count: link.use_count,
    status: link.status,
    disabled_reason: link.disabled_reason,
    payments: link.payments,
    created_at: link.created_at,
    revoked_at: link.revoked_at,
    public_key: link.public_key,
    signature: link.signature,
    path: paymentLinkPath(link.link_id),
    url: paymentLinkUrl(link.link_id, origin),
    qr_disclaimer: DEMO_QR_DISCLAIMER,
  };
}
