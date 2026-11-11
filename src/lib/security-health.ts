import { ownerSessionRequired } from "./owner-session";
import { verifyAuditChain } from "./audit";
import { envSecretValues } from "./ai-permissions";
import { hasBraintreeCreds } from "./payment-mode";
import { paypalMode } from "./store";
import type { StoreData } from "./types";

export interface HealthCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

/** Security score computed only from real, checkable facts about this deployment. */
export function computeSecurityHealth(store: StoreData): { score: number; grade: string; checks: HealthCheck[] } {
  const chain = verifyAuditChain(store.events);
  const secrets = envSecretValues();
  const publicEnv = Object.entries(process.env).filter(([k]) => k.startsWith("NEXT_PUBLIC_"));
  const leakedPublic = publicEnv.filter(([k, v]) => /SECRET|PRIVATE|TOKEN|PASSWORD/i.test(k) || (v && secrets.includes(v)));
  const verifiedWebhooks = store.webhook_receipts.filter((r) => r.verified && r.verification === "paypal").length;
  const checks: HealthCheck[] = [
    {
      id: "paypal_creds",
      label: "PayPal sandbox credentials configured (server-only)",
      passed: paypalMode() === "sandbox",
      weight: 15,
      detail: paypalMode() === "sandbox" ? "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set on the server." : "Not set — PayPal paths run in labelled mock mode.",
    },
    {
      id: "braintree_creds",
      label: "Braintree sandbox credentials configured (server-only)",
      passed: hasBraintreeCreds() && !/^(production|live)$/i.test(process.env.BRAINTREE_ENV || ""),
      weight: 10,
      detail: hasBraintreeCreds() ? "Braintree keys are set. The scoreboard requires sandbox mode." : "BRAINTREE_PRIVATE_KEY (or another key) is missing.",
    },
    {
      id: "webhook_id",
      label: "Webhook signature verification configured",
      passed: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      weight: 10,
      detail: process.env.PAYPAL_WEBHOOK_ID ? "PAYPAL_WEBHOOK_ID is set; /api/webhooks/paypal verifies every event with PayPal." : "PAYPAL_WEBHOOK_ID is not set; the webhook endpoint refuses events (503).",
    },
    {
      id: "webhook_verified",
      label: "At least one webhook verified by PayPal",
      passed: verifiedWebhooks > 0,
      weight: 5,
      detail: verifiedWebhooks > 0 ? `${verifiedWebhooks} verified webhook(s) received.` : "No PayPal-verified webhook received yet on this instance.",
    },
    {
      id: "audit_chain",
      label: "Audit hash chain intact",
      passed: chain.ok,
      weight: 20,
      detail: chain.detail,
    },
    {
      id: "no_public_secrets",
      label: "Public environment passes secret-name and value checks",
      passed: leakedPublic.length === 0,
      weight: 20,
      detail: leakedPublic.length === 0 ? `${publicEnv.length} NEXT_PUBLIC_* variable(s); none look like or equal a secret.` : `Suspicious public variables: ${leakedPublic.map(([k]) => k).join(", ")}`,
    },
    {
      id: "kill_switch",
      label: "Kill switch state available",
      passed: typeof store.settings.kill_switch === "boolean",
      weight: 5,
      detail: store.settings.kill_switch ? "Kill switch is ON — all agent money movement is frozen." : "Kill switch is off and can be flipped from the header or the API.",
    },
    {
      id: "headers_rbac_ratelimit",
      label: "Owner authentication configured",
      passed: ownerSessionRequired() && (process.env.AGENTPAL_OWNER_KEY?.length ?? 0) >= 32,
      weight: 15,
      detail: "A server-only owner key enables signed sessions. Credential-free mode uses demo roles.",
    },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((got / total) * 100);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return { score, grade, checks };
}
