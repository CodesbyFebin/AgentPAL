import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setPayPalSdkForTests, type PayPalSdkLike } from "@/lib/paypal";
import { runBuySafelyScenario } from "@/lib/scenarios";
import { resetStore, updateStore } from "@/lib/store";

const KEYS = ["BRAINTREE_MERCHANT_ID", "BRAINTREE_PUBLIC_KEY", "BRAINTREE_PRIVATE_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

function fakeSdk(opts: { authAmount?: string; customIdOverride?: string } = {}) {
  const orders = new Map<string, { customId?: string; value: string }>();
  let n = 0;
  const createOrder = vi.fn(async (req: { body: { intent: string; purchaseUnits: Array<{ customId?: string; amount: { value: string } }> }; paypalRequestId?: string }) => {
    n += 1;
    const id = `ORDER${n}XXXXXXXX`;
    const pu = req.body.purchaseUnits[0];
    orders.set(id, { customId: pu.customId, value: pu.amount.value });
    return { result: { id, status: "CREATED", intent: req.body.intent, links: [] } };
  });
  const authorizeOrder = vi.fn(async (req: { id: string }) => {
    const o = orders.get(req.id)!;
    return {
      result: {
        id: req.id,
        purchaseUnits: [
          {
            customId: opts.customIdOverride ?? o.customId,
            payments: {
              authorizations: [
                { id: `AUTH-${req.id}`, status: "CREATED", amount: { currencyCode: "USD", value: opts.authAmount ?? o.value }, customId: opts.customIdOverride ?? o.customId },
              ],
            },
          },
        ],
      },
    };
  });
  const captureAuthorizedPayment = vi.fn(async (req: { authorizationId: string }) => ({ result: { id: `CAP-${req.authorizationId}`, status: "COMPLETED" } }));
  const voidPayment = vi.fn(async () => ({ result: null }));
  const sdk = {
    orders: { createOrder, authorizeOrder, getOrder: vi.fn() },
    payments: { captureAuthorizedPayment, voidPayment, refundCapturedPayment: vi.fn() },
    subscriptions: { getSubscription: vi.fn(), cancelSubscription: vi.fn() },
  } as unknown as PayPalSdkLike;
  return { sdk, createOrder, authorizeOrder, captureAuthorizedPayment, voidPayment };
}

beforeEach(() => {
  delete process.env.BRAINTREE_MERCHANT_ID;
  delete process.env.BRAINTREE_PUBLIC_KEY;
  delete process.env.BRAINTREE_PRIVATE_KEY;
  process.env.PAYPAL_CLIENT_ID = "test-client-id-not-real";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret-not-real";
  resetStore();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _setPayPalSdkForTests(null);
});

async function allowedPayment() {
  const demo = await runBuySafelyScenario();
  const allowed = demo.executions.find((e) => e.decision.decision === "ALLOW");
  expect(allowed?.payment?.rail).toBe("paypal_sandbox");
  return allowed!.payment!;
}

describe("PayPal server SDK: authorize → Guard verify → capture / void", () => {
  it("creates an AUTHORIZE order bound to the payment and captures after verification", async () => {
    const f = fakeSdk();
    _setPayPalSdkForTests(f.sdk);
    const payment = await allowedPayment();
    expect(f.createOrder).toHaveBeenCalledTimes(1);
    const req = f.createOrder.mock.calls[0][0];
    expect(req.body.intent).toBe("AUTHORIZE");
    expect(req.body.purchaseUnits[0].customId).toBe(payment.payment_id);
    expect(req.paypalRequestId).toBeTruthy();

    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    const done = await updateStore((s) => completePaymentAfterBuyer(s, payment.payment_id, { orderId: payment.paypal!.order_id }));
    expect(f.authorizeOrder).toHaveBeenCalledTimes(1);
    expect(f.captureAuthorizedPayment).toHaveBeenCalledTimes(1);
    const capReq = f.captureAuthorizedPayment.mock.calls[0][0] as unknown as { body: { finalCapture: boolean; amount: { value: string } }; paypalRequestId: string };
    expect(capReq.body.finalCapture).toBe(true);
    expect(capReq.paypalRequestId).toBe(`cap-${payment.payment_id}`);
    expect(f.voidPayment).not.toHaveBeenCalled();
    expect(done.status).toBe("captured");
    expect(done.paypal?.capture_id).toMatch(/^CAP-/);
  });

  it("voids and never captures when PayPal authorized a different amount", async () => {
    const f = fakeSdk({ authAmount: "999.00" });
    _setPayPalSdkForTests(f.sdk);
    const payment = await allowedPayment();
    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    await expect(
      updateStore((s) => completePaymentAfterBuyer(s, payment.payment_id, { orderId: payment.paypal!.order_id })),
    ).rejects.toThrow(/does not match the reserved mandate amount/);
    expect(f.voidPayment).toHaveBeenCalledTimes(1);
    expect(f.captureAuthorizedPayment).not.toHaveBeenCalled();
  });

  it("voids when the authorization is not bound to the reserved payment (custom_id)", async () => {
    const f = fakeSdk({ customIdOverride: "pay_someone_else" });
    _setPayPalSdkForTests(f.sdk);
    const payment = await allowedPayment();
    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    await expect(
      updateStore((s) => completePaymentAfterBuyer(s, payment.payment_id, { orderId: payment.paypal!.order_id })),
    ).rejects.toThrow(/custom_id/);
    expect(f.voidPayment).toHaveBeenCalledTimes(1);
    expect(f.captureAuthorizedPayment).not.toHaveBeenCalled();
  });

  it("refuses to authorize while the kill switch is on (no SDK call)", async () => {
    const f = fakeSdk();
    _setPayPalSdkForTests(f.sdk);
    const payment = await allowedPayment();
    await updateStore((s) => {
      s.settings.kill_switch = true;
    });
    const { completePaymentAfterBuyer } = await import("@/lib/engine");
    await expect(
      updateStore((s) => completePaymentAfterBuyer(s, payment.payment_id, { orderId: payment.paypal!.order_id })),
    ).rejects.toThrow(/Kill switch/);
    expect(f.authorizeOrder).not.toHaveBeenCalled();
  });
});
