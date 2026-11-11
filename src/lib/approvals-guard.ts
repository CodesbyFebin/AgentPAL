import type { Approval, Merchant } from "./types";

const BLOCKED_REASON = /deny:|denied|blocked|malicious|prompt injection|injection bait|kill switch|untrusted data|not on the allowlist|merchant not allowed|not allowed/i;
const MALICIOUS_NAME = /evil|malware|phish|injection/i;

export type ApprovalGuardOpts = {
  merchants?: Array<Pick<Merchant, "merchant_id" | "name" | "injection_bait">>;
  payments?: Array<{ payment_id: string; status: string; merchant_id?: string }>;
};

/** Never let Approve-all send a blocked or malicious item to the approve endpoint. */
export function isBlockedOrMalicious(
  approval: Pick<Approval, "status" | "reason" | "merchant_name" | "payment_id">,
  opts: ApprovalGuardOpts = {},
): boolean {
  if (approval.status === "denied") return true;
  if (BLOCKED_REASON.test(approval.reason || "")) return true;
  if (MALICIOUS_NAME.test(approval.merchant_name || "")) return true;
  const payment = opts.payments?.find((p) => p.payment_id === approval.payment_id);
  if (payment && (payment.status === "denied" || payment.status === "failed" || payment.status === "voided")) return true;
  if (
    opts.merchants?.some(
      (m) =>
        m.injection_bait &&
        (m.name === approval.merchant_name || (payment && payment.merchant_id === m.merchant_id)),
    )
  ) {
    return true;
  }
  return false;
}

export function approvablePending(approvals: Approval[], opts: ApprovalGuardOpts = {}): Approval[] {
  return approvals.filter((a) => a.status === "pending" && !isBlockedOrMalicious(a, opts));
}

export function skippedBlocked(approvals: Approval[], opts: ApprovalGuardOpts = {}): Approval[] {
  return approvals.filter((a) => a.status === "pending" && isBlockedOrMalicious(a, opts));
}
