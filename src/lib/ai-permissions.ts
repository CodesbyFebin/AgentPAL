import { z } from "zod";
import type { AiPermissionLevel } from "./types";

/** L1 = read-only. L2 = propose only. L3 = execute — forbidden for the model. */
export const L1_TOOLS = [
  "get_accounts",
  "get_transactions",
  "get_budget",
  "get_recurring",
  "get_goals",
  "check_affordability",
] as const;

export const L2_TOOLS = ["propose_payment"] as const;

export const L3_TOOLS = [
  "capture_payment",
  "refund_payment",
  "execute_step",
  "cancel_subscription",
  "sign_mandate",
  "void_authorization",
  "create_paypal_order",
] as const;

const l1 = new Set<string>(L1_TOOLS);
const l2 = new Set<string>(L2_TOOLS);
const l3 = new Set<string>(L3_TOOLS);

export function levelForTool(name: string): AiPermissionLevel | "unknown" {
  if (l1.has(name)) return "L1";
  if (l2.has(name)) return "L2";
  if (l3.has(name)) return "L3";
  return "unknown";
}

export function authorizeTool(name: string): {
  allowed: boolean;
  level: AiPermissionLevel | "unknown";
  reason: string;
} {
  const level = levelForTool(name);
  if (level === "L1" || level === "L2") {
    return { allowed: true, level, reason: level === "L1" ? "Read-only tool." : "Propose-only tool. Nothing is captured." };
  }
  if (level === "L3") {
    return {
      allowed: false,
      level,
      reason:
        "L3 execute is forbidden for the model. Captures, refunds, mandate signatures, and cancellations are performed by a human and the AgentPaL Guard backend, never by the AI.",
    };
  }
  return { allowed: false, level: "unknown", reason: `Unknown tool ${name} is not on the L1/L2 allowlist.` };
}

const schemas: Record<string, z.ZodType> = {
  get_accounts: z.object({}).passthrough(),
  get_transactions: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    category: z.string().max(80).optional(),
  }),
  get_budget: z.object({}).passthrough(),
  get_recurring: z.object({}).passthrough(),
  get_goals: z.object({}).passthrough(),
  check_affordability: z.object({
    amount: z.number().finite(),
    label: z.string().max(200).optional(),
  }),
  propose_payment: z.object({
    sku: z.string().min(1).max(80),
  }),
};

export function parseToolArgs(name: string, args: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const schema = schemas[name];
  if (!schema) return { ok: false, error: `No argument schema for ${name}` };
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}

const SECRET_KEYS = ["PAYPAL_CLIENT_SECRET", "PAYPAL_CLIENT_ID", "AI_API_KEY", "PAYPAL_WEBHOOK_ID", "BRAINTREE_PRIVATE_KEY"] as const;

/** Strip env values and PEM private keys from any string that might be logged or returned. */
export function redactSecrets(value: string): string {
  let out = value;
  for (const key of SECRET_KEYS) {
    const secret = process.env[key];
    if (secret && secret.length > 2) {
      out = out.split(secret).join(`[redacted:${key}]`);
    }
  }
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private_key]");
  return out;
}

export function envSecretValues(): string[] {
  return SECRET_KEYS.map((k) => process.env[k]).filter((v): v is string => Boolean(v && v.length > 2));
}
