import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setToolkitToolsForTests, runGuardedPayPalTool, planPayPalToolFromMessage, ensureToolkitMandate } from "@/lib/paypal-agent-tools";
import { coachTurn } from "@/lib/coach-turn";
import { verifyPayload } from "@/lib/crypto";
import { resetStore, updateStore } from "@/lib/store";
import { chainHash } from "@/lib/crypto";

function spies() {
  const create_order = vi.fn(async () => ({ id: "5O190127TN364715T", status: "CREATED" }));
  const get_order = vi.fn(async () => ({ id: "5O190127TN364715T", status: "CREATED" }));
  const pay_order = vi.fn(async () => ({ id: "CAPTURED" }));
  return { create_order, get_order, pay_order };
}

function order(amount: number) {
  return { currencyCode: "USD", items: [{ name: "Launch domain", quantity: 1, itemCost: amount, taxPercent: 0, itemTotal: amount }] };
}

let s: ReturnType<typeof spies>;
beforeEach(() => {
  resetStore();
  s = spies();
  _setToolkitToolsForTests({
    create_order: { execute: s.create_order },
    get_order: { execute: s.get_order },
    pay_order: { execute: s.pay_order },
  });
});
afterEach(() => _setToolkitToolsForTests(null));

describe("Guard-wrapped PayPal agent toolkit", () => {
  it("executes an allowed create_order, reserves spend, audits and signs a receipt", async () => {
    const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(12) }));
    expect(call.decision).toBe("EXECUTED");
    expect(s.create_order).toHaveBeenCalledTimes(1);
    expect(call.reservation_id).toBeTruthy();
    await updateStore((st) => {
      const evt = st.events.find((e) => e.event_id === call.receipt.event_id)!;
      expect(evt.type).toBe("paypal_tool.executed");
      const { hash, ...unsigned } = evt;
      expect(chainHash(evt.prev_hash, unsigned)).toBe(hash);
    });
    const { signature, ...unsigned } = call.receipt;
    expect(verifyPayload(unsigned, call.receipt.public_key, signature)).toBe(true);
  });

  it("never invokes the underlying tool when the merchant is blocked (allowlist / injection)", async () => {
    const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_evil", args: order(49) }));
    expect(call.decision).toBe("BLOCKED");
    expect(call.invoked).toBe(false);
    expect(s.create_order).not.toHaveBeenCalled();
    await updateStore((st) => {
      expect(st.events.some((e) => e.type === "paypal_tool.blocked" && e.payload.call_id === call.call_id)).toBe(true);
    });
  });

  it("blocks tools that are not allowlisted (pay_order can never be called by Coach)", async () => {
    const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "pay_order", args: { id: "5O190127TN364715T" } }));
    expect(call.decision).toBe("BLOCKED");
    expect(s.pay_order).not.toHaveBeenCalled();
  });

  it("kill switch blocks even read-only tools", async () => {
    await updateStore((st) => {
      st.settings.kill_switch = true;
    });
    const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "get_order", args: { id: "5O190127TN364715T" } }));
    expect(call.decision).toBe("BLOCKED");
    expect(call.checks.find((c) => c.code === "kill_switch")?.passed).toBe(false);
    expect(s.get_order).not.toHaveBeenCalled();
  });

  it("enforces the per-transaction limit and the total mandate cap", async () => {
    const big = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(75) }));
    expect(big.decision).toBe("NEEDS_APPROVAL");
    expect(s.create_order).not.toHaveBeenCalled();

    for (let i = 0; i < 2; i++) {
      const ok = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(45) }));
      expect(ok.decision).toBe("EXECUTED");
    }
    const over = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(20) }));
    expect(over.decision).toBe("BLOCKED");
    expect(over.checks.find((c) => c.code === "total_limit")?.passed).toBe(false);
    expect(s.create_order).toHaveBeenCalledTimes(2);
  });

  it("returns MOCK-labelled results when PayPal credentials are absent", async () => {
    _setToolkitToolsForTests(null);
    const saved = [process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET];
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    try {
      const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(12) }));
      expect(call.mode).toBe("mock");
      expect(call.decision).toBe("EXECUTED");
      expect((call.result as { mock: boolean; id: string }).mock).toBe(true);
      expect((call.result as { id: string }).id).toMatch(/^MOCK-ORDER-/);
    } finally {
      if (saved[0]) process.env.PAYPAL_CLIENT_ID = saved[0];
      if (saved[1]) process.env.PAYPAL_CLIENT_SECRET = saved[1];
    }
  });

  it("offline Coach planner routes PayPal requests through the Guard wrapper", async () => {
    const allowed = await updateStore((st) => coachTurn(st, "Create a PayPal order for $12 at Nameforge Domains"));
    expect(allowed.paypal_tool_call?.decision).toBe("EXECUTED");
    const blocked = await updateStore((st) => coachTurn(st, "Create a PayPal order for $49 at ShadowCart Instant Buys"));
    expect(blocked.paypal_tool_call?.decision).toBe("BLOCKED");
    const capture = await updateStore((st) => coachTurn(st, "Pay order 5O190127TN364715T now"));
    expect(capture.paypal_tool_call?.tool).toBe("pay_order");
    expect(capture.paypal_tool_call?.decision).toBe("BLOCKED");
    expect(s.create_order).toHaveBeenCalledTimes(1);
    expect(s.pay_order).not.toHaveBeenCalled();
    await updateStore((st) => {
      expect(planPayPalToolFromMessage(st, "how much did I spend on food?")).toBeNull();
      expect(ensureToolkitMandate(st).max_total_spend).toBe(100);
    });
  });

  it("treats toolkit error payloads as ERROR and releases the reservation", async () => {
    _setToolkitToolsForTests({
      create_order: { execute: vi.fn(async () => JSON.stringify({ error: { message: "Client Authentication failed", type: "paypal_error" } })) },
    });
    const call = await updateStore((st) => runGuardedPayPalTool(st, { tool: "create_order", merchant_id: "merchant_002", args: order(12) }));
    expect(call.decision).toBe("ERROR");
    await updateStore((st) => {
      expect(st.reservations.find((r) => r.reservation_id === call.reservation_id)?.status).toBe("released");
    });
  });
});
