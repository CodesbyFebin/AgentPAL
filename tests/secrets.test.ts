import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as status } from "@/app/api/status/route";
import { envSecretValues, redactSecrets } from "@/lib/ai-permissions";

const KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "AI_API_KEY", "PAYPAL_WEBHOOK_ID"] as const;
const saved: Record<string, string | undefined> = {};

function plantSecrets() {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.PAYPAL_CLIENT_ID = "test-client-id-SHOULD-NOT-LEAK-xyz";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret-SHOULD-NOT-LEAK-abc";
  process.env.AI_API_KEY = "sk-test-SHOULD-NOT-LEAK";
  process.env.PAYPAL_WEBHOOK_ID = "webhook-SHOULD-NOT-LEAK";
}

function restore() {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

afterEach(restore);

describe("no secrets in API responses", () => {
  it("redacts env values from strings that might be logged", () => {
    plantSecrets();
    const messy = `id=${process.env.PAYPAL_CLIENT_ID} secret=${process.env.PAYPAL_CLIENT_SECRET} key=${process.env.AI_API_KEY}`;
    const cleaned = redactSecrets(messy);
    for (const v of envSecretValues()) expect(cleaned).not.toContain(v);
    expect(cleaned).toContain("[redacted:PAYPAL_CLIENT_SECRET]");
  });

  it("/api/health and /api/status contain no env values or private keys", async () => {
    plantSecrets();
    const healthRes = await health();
    const statusRes = await status();
    const healthBody = await healthRes.json();
    const statusBody = await statusRes.json();
    const blob = JSON.stringify({ healthBody, statusBody });
    for (const v of [
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET,
      process.env.AI_API_KEY,
      process.env.PAYPAL_WEBHOOK_ID,
    ]) {
      expect(blob).not.toContain(v);
    }
    expect(blob).not.toMatch(/PRIVATE KEY/);
    expect(blob).not.toContain("PRIV-TEST-KEY");
    expect(blob.toLowerCase()).not.toContain("privatekeypem");
    expect(healthBody.ok).toBe(true);
    expect(["sandbox", "mock"]).toContain(healthBody.paypalMode);
    expect(["live", "offline"]).toContain(healthBody.aiMode);
    expect(healthBody.paypalMode).toBe("sandbox");
    expect(healthBody.aiMode).toBe("live");
    expect(statusBody.modes.paypal).toBe("sandbox");
    expect(statusBody.settings.public_key).toBeTruthy();
    expect(statusBody.settings.signing).toBeUndefined();
  });
});
