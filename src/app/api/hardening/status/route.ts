import { ok } from "@/lib/http";
import { resolveRole } from "@/lib/owner-session";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Server-side secrets: reported as configured / not configured ONLY. Values never leave the server. */
const SECRET_STATUS_KEYS = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "BRAINTREE_MERCHANT_ID",
  "BRAINTREE_PUBLIC_KEY",
  "BRAINTREE_PRIVATE_KEY",
  "OWNER_PIN",
  "OWNER_SESSION_SECRET",
  "AI_API_KEY",
] as const;

export async function GET(req: Request) {
  const store = readStore();
  const { role, mode } = resolveRole(req.headers.get("cookie"));
  return ok({
    role,
    role_mode: mode,
    secrets: SECRET_STATUS_KEYS.map((key) => ({ key, configured: Boolean(process.env[key]) })),
    public_env_count: Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_")).length,
    idempotency: store.idempotency_responses
      .slice(-15)
      .reverse()
      .map((r) => ({ key: r.key.length > 18 ? `${r.key.slice(0, 18)}…` : r.key, scope: r.scope, status: r.status, request_hash: r.request_hash.slice(0, 12), created_at: r.created_at })),
    idempotency_total: store.idempotency_responses.length,
    audit_events: store.events.length,
  });
}
