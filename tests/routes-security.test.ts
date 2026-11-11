/**
 * Route-level regression tests: each one calls the real Next route handler / middleware and fails if the
 * corresponding guard is reverted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as evaluatePOST } from "@/app/api/policy/evaluate/route";
import { POST as replayPOST } from "@/app/api/subscriptions/replay/route";
import { POST as rolePOST } from "@/app/api/security/role/route";
import { POST as killPOST } from "@/app/api/kill-switch/route";
import { POST as signPOST } from "@/app/api/mandates/sign/route";
import { POST as approvalsPOST } from "@/app/api/purchases/approvals/route";
import { middleware } from "@/middleware";
import { createSignedMandate } from "@/lib/engine";
import { clientKey } from "@/lib/security";
import { DEMO_OWNER_VALUE } from "@/lib/owner-session";
import { readStore, resetStore, updateStore } from "@/lib/store";
import { toUsd } from "@/lib/money";

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const OWNER_DEMO = { cookie: `agentpal_role=${DEMO_OWNER_VALUE}` };

const savedPin = process.env.OWNER_PIN;
beforeEach(() => {
  resetStore();
  delete process.env.OWNER_PIN;
});
afterEach(() => {
  if (savedPin === undefined) delete process.env.OWNER_PIN;
  else process.env.OWNER_PIN = savedPin;
});

/** Mandate allowing only the "domain" category, for both demo merchants. */
async function domainOnlyMandate() {
  return updateStore((s) =>
    createSignedMandate(s, {
      goal_id: "g_test", max_total_spend: 50, per_tx_limit: 10,
      approved_merchants: ["merchant_001", "merchant_002"], allowed_categories: ["domain"], currency: "USD",
    }),
  );
}
type Decision = { decision: string; checks: Array<{ code: string; passed: boolean }> };

describe("/api/policy/evaluate", () => {
  it("requires mandate_id", async () => {
    const r = await evaluatePOST(json("/api/policy/evaluate", { merchant_id: "merchant_002", amount: 5 }));
    expect(r.status).toBe(400);
  });
  it("ignores body.category and uses the server-side merchant category", async () => {
    const m = await domainOnlyMandate();
    const merchant1 = readStore().merchants.find((x) => x.merchant_id === "merchant_001")!;
    expect(merchant1.category).not.toBe("domain");
    const r = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_001", amount: 5, category: "domain" }));
    const { decision } = (await r.json()) as { decision: Decision };
    expect(decision.decision).toBe("DENY");
    expect(decision.checks.find((c) => c.code === "category")?.passed).toBe(false);
  });
  it("has no products[0] fallback: missing amount or unknown SKU is rejected", async () => {
    const m = await domainOnlyMandate();
    const noAmount = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_002" }));
    expect(noAmount.status).toBe(400);
    expect(((await noAmount.json()) as { error: string }).error).toMatch(/finite/);
    const badSku = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_002", product_sku: "nope" }));
    expect(badSku.status).toBe(400);
    const nan = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_002", amount: "NaN" }));
    expect(nan.status).toBe(400);
  });
  it("re-verifies the mandate signature on the ad-hoc path", async () => {
    const m = await domainOnlyMandate();
    const ok = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_002", amount: 5 }));
    expect(((await ok.json()) as { decision: Decision }).decision.decision).toBe("ALLOW");
    await updateStore((s) => {
      s.mandates.find((x) => x.mandate_id === m.mandate_id)!.max_total_spend = 1_000_000;
    });
    const r = await evaluatePOST(json("/api/policy/evaluate", { mandate_id: m.mandate_id, merchant_id: "merchant_002", amount: 5 }));
    const { decision } = (await r.json()) as { decision: Decision };
    expect(decision.decision).toBe("DENY");
    expect(decision.checks[0].code).toBe("mandate_signature");
  });
});

describe("/api/subscriptions/replay", () => {
  it("rejects NaN, Infinity, strings and non-positive proposed_amount", async () => {
    for (const proposed_amount of ["NaN", "1e999", "abc", 0, -3, null]) {
      const r = await replayPOST(json("/api/subscriptions/replay", { proposed_amount }));
      expect(r.status, String(proposed_amount)).toBe(400);
    }
  });
});

describe("RBAC", () => {
  const mw = (path: string, cookie?: string) =>
    middleware(new NextRequest(`http://localhost${path}`, { method: "POST", headers: cookie ? { cookie } : {} }));

  it("no cookie defaults to viewer: mutating /api calls get 403", async () => {
    const r = mw("/api/refunds");
    expect(r.status).toBe(403);
    expect(((await r.json()) as { role: string }).role).toBe("viewer");
  });
  it("a hand-written 'owner' cookie is not accepted", () => {
    expect(mw("/api/refunds", "agentpal_role=owner").status).toBe(403);
  });
  it("demo mode (no OWNER_PIN): the toggle issues a labelled demo owner cookie", async () => {
    const r = await rolePOST(json("/api/security/role", { role: "owner" }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { mode: string }).mode).toBe("demo_toggle");
    expect(r.headers.get("set-cookie")).toContain(DEMO_OWNER_VALUE);
    expect(mw("/api/refunds", OWNER_DEMO.cookie).status).toBe(200);
  });
  it("PIN mode: self-promotion without / with a wrong PIN is blocked; the right PIN issues a signed session", async () => {
    process.env.OWNER_PIN = "4821-test";
    expect((await rolePOST(json("/api/security/role", { role: "owner" }))).status).toBe(403);
    expect((await rolePOST(json("/api/security/role", { role: "owner", pin: "0000" }))).status).toBe(403);
    expect(mw("/api/refunds", OWNER_DEMO.cookie).status).toBe(403); // demo cookie is worthless in PIN mode
    expect(mw("/api/refunds", `agentpal_role=o.${Date.now() + 60_000}.forged`).status).toBe(403);
    const good = await rolePOST(json("/api/security/role", { role: "owner", pin: "4821-test" }));
    expect(good.status).toBe(200);
    const value = /agentpal_role=([^;]+)/.exec(good.headers.get("set-cookie") || "")![1];
    expect(mw("/api/refunds", `agentpal_role=${value}`).status).toBe(200);
  });
  it("viewer may engage but not release the kill switch", async () => {
    expect((await killPOST(json("/api/kill-switch", { active: true }))).status).toBe(200);
    expect((await killPOST(json("/api/kill-switch", { active: false }))).status).toBe(403);
    expect((await killPOST(json("/api/kill-switch", { active: false }, OWNER_DEMO))).status).toBe(200);
  });
  it("mandate signing and trade-off approvals are owner-only at the route level too", async () => {
    expect((await signPOST(json("/api/mandates/sign", { template: "personal_inr" }))).status).toBe(403);
    expect((await approvalsPOST(json("/api/purchases/approvals", { sku: "nova_14_65000" }))).status).toBe(403);
    expect(readStore().mandates.length).toBe(0);
    expect((await signPOST(json("/api/mandates/sign", { template: "personal_inr" }, OWNER_DEMO))).status).toBe(201);
    expect((await approvalsPOST(json("/api/purchases/approvals", { sku: "nova_14_65000" }, OWNER_DEMO))).status).toBe(201);
  });
});

describe("rate-limit client key and FX", () => {
  it("prefers True-Client-IP, else the rightmost X-Forwarded-For entry (not the spoofable leftmost)", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(clientKey(h({ "true-client-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientKey(h({ "x-forwarded-for": "9.9.9.9, 2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientKey(h({}))).toBe("local");
  });
  it("rejects unsupported currencies instead of treating them as USD", () => {
    expect(toUsd(830, "INR")).toBe(10);
    expect(() => toUsd(10, "EUR")).toThrow(/Unsupported currency/);
  });
});
