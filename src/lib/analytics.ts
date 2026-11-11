/**
 * Analytics computed ONLY from the seeded INR demo finance data and the app's own audit log.
 * Every number here is derived at request time; nothing is hard-coded.
 */
import { budgetProgress, monthlyCashFlow } from "./finance-engine";
import type { AuditEvent, FinanceState, PayPalToolCall } from "./types";

export function financeAnalytics(finance: FinanceState) {
  const months = [...new Set(finance.transactions.map((t) => t.posted_at.slice(0, 7)))].sort();
  const flows = months.map((m) => monthlyCashFlow(finance, m));
  const latest = (finance.profile.as_of || "").slice(0, 7) || months.at(-1) || "";
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  for (const t of finance.transactions) {
    if (t.posted_at.slice(0, 7) !== latest || t.amount >= 0 || t.category === "Transfers") continue;
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + Math.abs(t.amount));
    byMerchant.set(t.merchant, (byMerchant.get(t.merchant) || 0) + Math.abs(t.amount));
  }
  const categories = [...byCategory.entries()].map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
  const merchants = [...byMerchant.entries()].map(([merchant, amount]) => ({ merchant, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount).slice(0, 6);
  const budgets = budgetProgress(finance).map((b) => ({ category: b.category, limit: b.monthly_limit, spent: b.spent, pct: b.monthly_limit > 0 ? Math.round((b.spent / b.monthly_limit) * 100) : 0 }));
  const goals = finance.savings_goals.map((g) => ({ name: g.name, current: g.current_amount, target: g.target_amount, pct: g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0 }));
  const savingsRate = flows.length ? flows.map((f) => ({ month: f.month, rate: f.income > 0 ? Math.round((f.net / f.income) * 100) : 0 })) : [];
  return { currency: "INR" as const, as_of: finance.profile.as_of, months: flows, latest_month: latest, categories, merchants, budgets, goals, savings_rate: savingsRate };
}

export function guardAnalytics(events: AuditEvent[], toolCalls: PayPalToolCall[]) {
  const decisions = { ALLOW: 0, REQUIRE_APPROVAL: 0, DENY: 0 } as Record<string, number>;
  for (const e of events) {
    if (e.type !== "policy.decision") continue;
    const d = String((e.payload as { decision?: string } | undefined)?.decision || "").toUpperCase();
    if (d in decisions) decisions[d] += 1;
  }
  const tools: Record<string, number> = {};
  for (const c of toolCalls) tools[c.decision] = (tools[c.decision] || 0) + 1;
  const blockedTypes = events.filter((e) => /blocked|denied|kill_switch\.on|no_mandate|rejected/.test(e.type)).length;
  return { policy_decisions: decisions, tool_calls: tools, protective_events: blockedTypes, audit_events: events.length };
}
