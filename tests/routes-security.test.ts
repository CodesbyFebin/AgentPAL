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
import { POST as plansPOST } from "@/app/api/plans/route";
import { POST as demoRunPOST } from "@/app/api/demo/run/route";
import { GET as roleGET } from "@/app/api/security/role/route";
import { runScenario } from "@/lib/scenarios";
import { issueOwnerCookie, resolveRole, roleMode, OWNER_SESSION_TTL_MS } from "@/lib/owner-session";
import { checkSecurityHeaders, computeSecurityHealth, rbacHealthCheck } from "@/lib/security-health";
import { middleware } from "@/middleware";
import { createSignedMandate } from "@/lib/engine";
import { clientKey } from "@/lib/security";
import { DEMO_OWNER_VALUE } from "@/lib/owner-session";
import { readStore, resetStore, updateStore } from "@/lib/store";
import { toUsd } from "@/lib/money";

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const OWNER_DEMO = { cookie: `agentpal_role=${DEMO_OWNER_VALUE}` };

const PIN = "correct-horse-4821";
const SECRET = "s".repeat(16) + "e".repeat(16) + "-session-secret";
const saved = { pin: process.env.OWNER_PIN, secret: process.env.OWNER_SESSION_SECRET };
const pinMode = () => {
  process.env.OWNER_PIN = PIN;
  process.env.OWNER_SESSION_SECRET = SECRET;
};
let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;
beforeEach(async () => {
  (await import("@/lib/owner-session")).globalPinBackoff.reset();
  resetStore();
  delete process.env.OWNER_PIN;
  delete process.env.OWNER_SESSION_SECRET;
});
afterEach(() => {
  for (const [k, v] of [["OWNER_PIN", saved.pin], ["OWNER_SESSION_SECRET", saved.secret]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
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
  it("with a seeded managed subscription: rejects NaN/Infinity/strings/<=0 at the amount guard; accepts a valid amount", async () => {
    await runScenario("subscriptions");
    const sub = readStore().subscriptions.find((s) => s.merchant_id === "merchant_clouddraw")!;
    expect(sub).toBeTruthy();
    for (const proposed_amount of ["NaN", "1e999", "abc", 0, -3, null]) {
      const r = await replayPOST(json("/api/subscriptions/replay", { subscription_id: sub.subscription_id, proposed_amount }));
      expect(r.status, String(proposed_amount)).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/proposed_amount must be a finite number/);
    }
    const good = await replayPOST(json("/api/subscriptions/replay", { subscription_id: sub.subscription_id, proposed_amount: 16 }));
    expect(good.status).toBeLessThan(300);
  });
});

describe("RBAC", () => {
  const mw = (path: string, cookie?: string, ip = freshIp()) =>
    middleware(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "true-client-ip": ip, ...(cookie ? { cookie } : {}) } }));
  const roleReq = (body: unknown, ip: string) => json("/api/security/role", body, { "true-client-ip": ip });

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
    pinMode();
    const ip = freshIp();
    expect((await rolePOST(roleReq({ role: "owner" }, ip))).status).toBe(403);
    expect((await rolePOST(roleReq({ role: "owner", pin: "0000" }, ip))).status).toBe(403);
    expect(mw("/api/refunds", OWNER_DEMO.cookie).status).toBe(403); // demo cookie is worthless in PIN mode
    expect(mw("/api/refunds", `agentpal_role=o.${Date.now() + 60_000}.forged`).status).toBe(403);
    const good = await rolePOST(roleReq({ role: "owner", pin: PIN }, ip));
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
  it("prefers True-Client-IP, else the leftmost VALID X-Forwarded-For IP (Render appends internal hops)", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(clientKey(h({ "true-client-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 10.0.0.2" }))).toBe("1.1.1.1");
    expect(clientKey(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.2" }))).toBe("9.9.9.9");
    expect(clientKey(h({ "x-forwarded-for": "garbage, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientKey(h({ "true-client-ip": "not-an-ip" }))).toBe("local");
    expect(clientKey(h({}))).toBe("local");
  });
  it("rejects unsupported currencies instead of treating them as USD", () => {
    expect(toUsd(830, "INR")).toBe(10);
    expect(() => toUsd(10, "EUR")).toThrow(/Unsupported currency/);
  });
});

describe("owner sessions and PIN hardening", () => {
  it("owner cookies expire after the TTL and far-future expiries are refused", () => {
    pinMode();
    const now = Date.now();
    const fresh = issueOwnerCookie(PIN, process.env, now)!;
    expect(resolveRole(`agentpal_role=${fresh}`, process.env, now + 1000).role).toBe("owner");
    expect(resolveRole(`agentpal_role=${fresh}`, process.env, now + OWNER_SESSION_TTL_MS + 1).role).toBe("viewer");
    const stale = issueOwnerCookie(PIN, process.env, now - 9 * 60 * 60 * 1000)!;
    expect(resolveRole(`agentpal_role=${stale}`).role).toBe("viewer");
  });
  it("a cookie signed with the PIN instead of OWNER_SESSION_SECRET is rejected", async () => {
    pinMode();
    const { createHmac } = await import("crypto");
    const exp = Date.now() + 60_000;
    const sig = createHmac("sha256", PIN).update(`agentpal-owner:${exp}`).digest("base64url");
    expect(resolveRole(`agentpal_role=o.${exp}.${sig}`).role).toBe("viewer");
  });
  it("OWNER_PIN shorter than 12 characters is rejected (demo toggle), and says so", async () => {
    process.env.OWNER_PIN = "short-pin";
    process.env.OWNER_SESSION_SECRET = SECRET;
    expect(roleMode()).toBe("demo_toggle");
    const r = (await (await roleGET(new Request("http://localhost/api/security/role"))).json()) as { mode: string; note: string };
    expect(r.mode).toBe("demo_toggle");
    expect(r.note).toMatch(/shorter than 12/);
  });
  it("PIN without OWNER_SESSION_SECRET fails closed: even the right PIN cannot become owner", async () => {
    process.env.OWNER_PIN = PIN;
    expect(roleMode()).toBe("pin_misconfigured");
    const r = await rolePOST(json("/api/security/role", { role: "owner", pin: PIN }, { "true-client-ip": freshIp() }));
    expect(r.status).toBe(503);
    expect(r.headers.get("set-cookie") || "").not.toContain("o.");
    expect(resolveRole("agentpal_role=demo-owner").role).toBe("viewer");
  });
  it("locks a client out after 5 wrong PINs; even the right PIN is then refused (429)", async () => {
    pinMode();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await rolePOST(json("/api/security/role", { role: "owner", pin: `wrong-${i}` }, { "true-client-ip": ip }))).status);
    expect(statuses).toEqual([403, 403, 403, 403, 429]);
    const right = await rolePOST(json("/api/security/role", { role: "owner", pin: PIN }, { "true-client-ip": ip }));
    expect(right.status).toBe(429);
    // another client is unaffected
    expect((await rolePOST(json("/api/security/role", { role: "owner", pin: PIN }, { "true-client-ip": freshIp() }))).status).toBe(200);
  });
  it("middleware rate-limits the role endpoint (10/min per client)", () => {
    const ip = freshIp();
    const codes = Array.from({ length: 11 }, () =>
      middleware(new NextRequest("http://localhost/api/security/role", { method: "POST", headers: { "true-client-ip": ip } })).status,
    );
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("other owner-only / explicit-input routes", () => {
  it("/api/plans requires an explicit goal_id (no latest-goal fallback)", async () => {
    await runScenario("buy-safely");
    const r = await plansPOST(json("/api/plans", {}));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/goal_id is required/);
  });
  it("/api/demo/run is owner-only at the route level", async () => {
    expect((await demoRunPOST(json("/api/demo/run", { scenario: "buy-safely" }))).status).toBe(403);
    expect(readStore().mandates.length).toBe(0);
    const ok = await demoRunPOST(json("/api/demo/run", { scenario: "buy-safely" }, OWNER_DEMO));
    expect(ok.status).toBe(201);
    expect(readStore().mandates.every((m) => (m.title || "").startsWith("Demo:"))).toBe(true);
  });
});

describe("security health score honesty", () => {
  it("header check reads next.config and passes", async () => {
    expect(await checkSecurityHeaders()).toEqual({ ok: true, missing: [] });
  });
  it("demo-toggle mode: RBAC is a FAILED, weighted check and 100 is unreachable", async () => {
    const c = rbacHealthCheck();
    expect(c.passed).toBe(false);
    expect(c.weight).toBeGreaterThan(0);
    const h = await computeSecurityHealth(readStore());
    const rbac = h.checks.find((x) => x.id === "rbac")!;
    expect(rbac.passed).toBe(false);
    expect(h.score).toBeLessThan(100);
  });
  it("misconfigured PIN mode also fails; full PIN mode passes", () => {
    process.env.OWNER_PIN = PIN;
    expect(rbacHealthCheck().passed).toBe(false);
    pinMode();
    expect(rbacHealthCheck().passed).toBe(true);
  });
});

describe("global failed-PIN backoff", () => {
  it("backoff grows 30s, 1m, 2m, 4m and caps at 5m", async () => {
    const { GlobalPinBackoff } = await import("@/lib/owner-session");
    const g = new GlobalPinBackoff(3);
    let t = 1_000_000;
    const locks: number[] = [];
    for (let round = 0; round < 6; round++) {
      let r = { locked: false, lockMs: 0 };
      for (let i = 0; i < 3; i++) r = g.fail(t);
      expect(r.locked).toBe(true);
      locks.push(r.lockMs);
      expect(g.check(t + r.lockMs - 1).locked).toBe(true);
      expect(g.check(t + r.lockMs).locked).toBe(false);
      t += r.lockMs + 1;
    }
    expect(locks).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });
  it("during a global lockout, new sign-ins get 429 but an existing owner cookie keeps working", async () => {
    pinMode();
    const { globalPinBackoff } = await import("@/lib/owner-session");
    globalPinBackoff.reset();
    const signIn = await rolePOST(json("/api/security/role", { role: "owner", pin: PIN }, { "true-client-ip": freshIp() }));
    const owner = /agentpal_role=([^;]+)/.exec(signIn.headers.get("set-cookie") || "")![1];
    // 10 failures spread across clients (stays under the per-IP lockout) trigger the global backoff.
    for (let i = 0; i < 10; i++) {
      await rolePOST(json("/api/security/role", { role: "owner", pin: "nope" }, { "true-client-ip": freshIp() }));
    }
    expect(globalPinBackoff.check().locked).toBe(true);
    const blocked = await rolePOST(json("/api/security/role", { role: "owner", pin: PIN }, { "true-client-ip": freshIp() }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(30);
    const mwReq = new NextRequest("http://localhost/api/refunds", { method: "POST", headers: { cookie: `agentpal_role=${owner}`, "true-client-ip": freshIp() } });
    expect(middleware(mwReq).status).toBe(200);
    expect(resolveRole(`agentpal_role=${owner}`).role).toBe("owner");
    globalPinBackoff.reset();
  });
});
