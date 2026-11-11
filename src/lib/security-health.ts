import { verifyAuditChain } from "./audit";
import { envSecretValues } from "./ai-permissions";
import { hasBraintreeCreds } from "./payment-mode";
import { paypalMode } from "./store";
import type { StoreData } from "./types";
import nextConfig from "../../next.config";
import { DEMO_OWNER_VALUE, issueOwnerCookie, resolveRole, roleConfigNote, roleMode } from "./owner-session";
import { RateLimiter, rateLimitGroup, rbacDecision, ROLE_COOKIE } from "./security";

/** Reads the headers actually registered in next.config.ts and checks the ones we rely on. */
export async function checkSecurityHeaders(): Promise<{ ok: boolean; missing: string[] }> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const all = rules.find((r) => r.source === "/:path*")?.headers ?? [];
  const get = (k: string) => all.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? "";
  const missing: string[] = [];
  if (!/frame-ancestors 'none'/.test(get("Content-Security-Policy")) || !/object-src 'none'/.test(get("Content-Security-Policy"))) missing.push("Content-Security-Policy");
  if (get("X-Frame-Options") !== "DENY") missing.push("X-Frame-Options");
  if (get("X-Content-Type-Options") !== "nosniff") missing.push("X-Content-Type-Options");
  if (!/max-age=\d+/.test(get("Strict-Transport-Security"))) missing.push("Strict-Transport-Security");
  if (!get("Referrer-Policy")) missing.push("Referrer-Policy");
  return { ok: missing.length === 0, missing };
}

/** Exercises the real role resolver + RBAC decision: no cookie and forged cookies must be viewers. */
export function checkRbac(env: NodeJS.ProcessEnv = process.env): { ok: boolean; detail: string } {
  const failures: string[] = [];
  if (resolveRole(null, env).role !== "viewer") failures.push("no cookie is not viewer");
  if (resolveRole(`${ROLE_COOKIE}=owner`, env).role !== "viewer") failures.push("raw 'owner' cookie accepted");
  if (roleMode(env) === "pin") {
    if (resolveRole(`${ROLE_COOKIE}=${DEMO_OWNER_VALUE}`, env).role !== "viewer") failures.push("demo cookie accepted in PIN mode");
    if (resolveRole(`${ROLE_COOKIE}=o.${Date.now() + 60_000}.forged`, env).role !== "viewer") failures.push("forged token accepted");
    const issued = issueOwnerCookie(env.OWNER_PIN, env, Date.now() - 9 * 60 * 60 * 1000);
    if (!issued || resolveRole(`${ROLE_COOKIE}=${issued}`, env).role !== "viewer") failures.push("expired session accepted");
    if (issueOwnerCookie("wrong-pin", env) !== null) failures.push("wrong PIN issued a session");
  }
  if (rbacDecision("POST", "/api/refunds", "viewer").allowed) failures.push("viewer allowed to POST /api/refunds");
  return { ok: failures.length === 0, detail: failures.join("; ") };
}

/** Exercises a fresh limiter with the payments group's real limit. */
export function checkRateLimiter(): { ok: boolean; detail: string } {
  const group = rateLimitGroup("POST", "/api/payments/x/authorize");
  if (!group) return { ok: false, detail: "No rate-limit group matches payment routes." };
  const l = new RateLimiter();
  let blockedAt = 0;
  for (let i = 1; i <= group.limit + 1; i++) if (!l.hit("probe", group.limit, group.windowMs, 0).ok) { blockedAt = i; break; }
  return blockedAt === group.limit + 1
    ? { ok: true, detail: `Payments group: request ${group.limit + 1} within ${group.windowMs / 1000}s is rejected (429).` }
    : { ok: false, detail: "Limiter did not block at the configured limit." };
}

export interface HealthCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

/** Security score computed only from real, checkable facts about this deployment. */
/**
 * RBAC counts in the score and only passes with real access control (PIN + session secret) whose
 * resolver behaves correctly right now. Demo-toggle or fail-closed configs are FAILED checks, so 100/100
 * is unreachable without real RBAC.
 */
export function rbacHealthCheck(env: NodeJS.ProcessEnv = process.env): HealthCheck {
  const rbac = checkRbac(env);
  const mode = roleMode(env);
  return {
    id: "rbac",
    label: "RBAC: default viewer, owner needs server-side PIN + signed session (exercised now)",
    passed: mode === "pin" && rbac.ok,
    weight: 10,
    detail:
      mode === "pin"
        ? rbac.ok ? "No cookie → viewer; forged, demo and expired cookies → viewer; wrong PIN refused." : `Failed: ${rbac.detail}`
        : `${roleConfigNote(env)} The role switch is not real access control, so this check fails.`,
  };
}

export async function computeSecurityHealth(store: StoreData): Promise<{ score: number; grade: string; checks: HealthCheck[] }> {
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
      passed: hasBraintreeCreds(),
      weight: 10,
      detail: hasBraintreeCreds() ? "All three Braintree keys are set on the server." : "BRAINTREE_PRIVATE_KEY (or another key) is missing.",
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
      label: "No secrets exposed to the browser (NEXT_PUBLIC_*)",
      passed: leakedPublic.length === 0,
      weight: 20,
      detail: leakedPublic.length === 0 ? `${publicEnv.length} NEXT_PUBLIC_* variable(s); none look like or equal a secret.` : `Suspicious public variables: ${leakedPublic.map(([k]) => k).join(", ")}`,
    },
    {
      id: "kill_switch",
      label: "Kill switch reachable and currently off",
      passed: !store.settings.kill_switch,
      weight: 5,
      detail: store.settings.kill_switch ? "Kill switch is ON — all agent money movement is frozen." : "Kill switch is off and can be flipped from the header or the API.",
    },
  ];
  const headers = await checkSecurityHeaders();
  checks.push({
    id: "security_headers",
    label: "CSP + security headers registered (read from next.config.ts)",
    passed: headers.ok,
    weight: 5,
    detail: headers.ok ? "CSP (frame-ancestors/object-src 'none'), X-Frame-Options DENY, nosniff, HSTS and Referrer-Policy are registered." : `Missing or weak: ${headers.missing.join(", ")}`,
  });
  const limiter = checkRateLimiter();
  checks.push({ id: "rate_limit", label: "Rate limiter blocks at the configured limit (exercised now)", passed: limiter.ok, weight: 5, detail: limiter.detail });
  checks.push(rbacHealthCheck());
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((got / total) * 100);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return { score, grade, checks };
}
