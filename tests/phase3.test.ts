/** Phase 3: AI Agent Mesh catalogue, webhook simulator, hardening status, analytics. */
import { beforeEach, describe, expect, it } from "vitest";
import { agentMeshView, AGENT_FLEET } from "@/lib/agent-mesh";
import { runWebhookSim } from "@/lib/webhook-sim";
import { financeAnalytics, guardAnalytics } from "@/lib/analytics";
import { GET as statusGET } from "@/app/api/hardening/status/route";
import { POST as simPOST } from "@/app/api/hardening/webhook-sim/route";
import { readStore, resetStore } from "@/lib/store";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

beforeEach(() => resetStore());

describe("AI Agent Mesh", () => {
  it("lists the real toolkit catalogue with Guard status", async () => {
    const v = await agentMeshView();
    expect(v.catalogue_source).toBe("toolkit");
    expect(v.library.length).toBeGreaterThanOrEqual(20);
    const byName = Object.fromEntries(v.library.map((t) => [t.name, t]));
    expect(byName.pay_order.guard).toBe("not_enabled");
    expect(byName.accept_dispute_claim.guard).toBe("not_enabled");
    expect(byName.create_invoice.guard).not.toBe("not_enabled");
    expect(v.counts.total).toBe(v.library.length);
  }, 20_000);

  it("no fleet agent can mint mandates, choose amounts, self-approve or capture", () => {
    for (const a of AGENT_FLEET) {
      expect(a.can_create_mandates).toBe(false);
      expect(a.can_choose_amounts).toBe(false);
      expect(a.can_self_approve).toBe(false);
      expect(a.can_capture).toBe(false);
    }
  });
});

describe("webhook verification simulator (real intake pipeline)", () => {
  it("accepts valid, rejects tampered, replay and stale", async () => {
    await runWebhookSim("reset");
    const valid = await runWebhookSim("valid");
    expect(valid.status).toBe(200);
    const replay = await runWebhookSim("replay");
    expect(replay.result).toBe("duplicate_ignored");
    const tampered = await runWebhookSim("tampered");
    expect(tampered.status).toBe(401);
    const stale = await runWebhookSim("stale");
    expect(stale.status).toBe(400);
  });

  it("never touches the real store", async () => {
    const before = readStore().webhook_receipts.length;
    await runWebhookSim("valid");
    expect(readStore().webhook_receipts.length).toBe(before);
  });

  it("route rejects unknown cases and is reachable by viewers", async () => {
    const bad = await simPOST(new Request("http://localhost/api/hardening/webhook-sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ case: "rm -rf" }) }));
    expect(bad.status).toBe(400);
    const res = await middleware(new NextRequest("http://localhost/api/hardening/webhook-sim", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.77" } }));
    expect(res.status).not.toBe(403);
  });
});

describe("hardening status", () => {
  it("reports configured flags only, never secret values", async () => {
    const saved = process.env.PAYPAL_CLIENT_SECRET;
    process.env.PAYPAL_CLIENT_SECRET = "super-secret-value-should-never-leak";
    try {
      const res = await statusGET(new Request("http://localhost/api/hardening/status"));
      const text = await res.text();
      expect(text).not.toContain("super-secret-value-should-never-leak");
      const body = JSON.parse(text);
      const entry = body.secrets.find((s: { key: string }) => s.key === "PAYPAL_CLIENT_SECRET");
      expect(entry).toEqual({ key: "PAYPAL_CLIENT_SECRET", configured: true });
      expect(body.role).toBe("viewer");
    } finally {
      if (saved === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
      else process.env.PAYPAL_CLIENT_SECRET = saved;
    }
  });
});

describe("analytics (seeded INR demo data)", () => {
  it("derives flows, categories and budgets from the seed", () => {
    const fin = financeAnalytics(readStore().finance);
    expect(fin.currency).toBe("INR");
    expect(fin.months.length).toBeGreaterThan(0);
    const spent = fin.categories.reduce((a, c) => a + c.amount, 0);
    expect(spent).toBeGreaterThan(0);
    expect(fin.categories.map((c) => c.category)).not.toContain("Transfers");
  });

  it("counts Guard decisions from audit events", () => {
    const events = [
      { type: "policy.decision", payload: { decision: "DENY" } },
      { type: "policy.decision", payload: { decision: "ALLOW" } },
      { type: "policy.decision", payload: { decision: "deny" } },
      { type: "payment.blocked", payload: {} },
    ] as never;
    const g = guardAnalytics(events, []);
    expect(g.policy_decisions.DENY).toBe(2);
    expect(g.policy_decisions.ALLOW).toBe(1);
    expect(g.protective_events).toBe(1);
  });
});
