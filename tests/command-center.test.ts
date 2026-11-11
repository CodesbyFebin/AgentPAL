import { afterEach, describe, expect, it, vi } from "vitest";
import { issueOwnerSession, validOwnerKey, verifyOwnerSession } from "@/lib/owner-session";
import { emptyStore } from "@/lib/store";

const db = vi.hoisted(() => ({ current: undefined as import("@/lib/types").StoreData | undefined }));
vi.mock("@/lib/store", async (original) => {
  const real = await original<typeof import("@/lib/store")>();
  return {
    ...real,
    readStore: () => db.current ??= real.emptyStore(),
    updateStore: async (update: (store: import("@/lib/types").StoreData) => unknown) =>
      update(db.current ??= real.emptyStore()),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  db.current = undefined;
});

describe("AgentPaL deployment controls", () => {
  it("rejects an altered session and invalidates signed sessions on key rotation", async () => {
    const key = "test-owner-session-signing-key-0123456789";
    vi.stubEnv("AGENTPAL_OWNER_KEY", key);
    expect(await validOwnerKey(key)).toBe(true);
    expect(await validOwnerKey(key + "x")).toBe(false);
    const session = (await issueOwnerSession())!;
    expect(await verifyOwnerSession(session)).toBe(true);
    expect(await verifyOwnerSession(session.slice(0, -1) + (session.endsWith("0") ? "1" : "0"))).toBe(false);
    vi.stubEnv("AGENTPAL_OWNER_KEY", key + "-rotated");
    expect(await verifyOwnerSession(session)).toBe(false);
  });

  it("exercises webhook replay in memory without changing live receipts or the audit log", async () => {
    db.current = emptyStore();
    const { POST } = await import("@/app/api/security/webhook-simulator/route");
    const response = await POST(new Request("http://localhost/api/security/webhook-simulator", {
      method: "POST", body: JSON.stringify({ scenario: "duplicate" }),
    }));
    expect(await response.json()).toMatchObject({
      simulated: true, providerCalled: false, persisted: false, result: "duplicate_ignored",
    });
    expect(db.current.webhook_receipts).toHaveLength(0);
    expect(db.current.events).toHaveLength(0);
  });

  it("rejects conflicting in-flight requests and replays a matching key once", async () => {
    const { withIdempotency } = await import("@/lib/idempotency");
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const handler = vi.fn(async () => {
      await ready;
      return { status: 201, body: { id: "first" } };
    });
    const request = new Request("http://localhost", { headers: { "Idempotency-Key": "same-key" } });
    const first = withIdempotency(request, "test", { amount: 1 }, handler);
    const replay = withIdempotency(request, "test", { amount: 1 }, handler);
    const conflicting = await withIdempotency(request, "test", { amount: 2 }, handler);
    expect(conflicting.status).toBe(409);
    finish();
    expect((await first).status).toBe(201);
    expect((await replay).headers.get("Idempotent-Replayed")).toBe("true");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
