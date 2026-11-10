import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ question?: string; event_id?: string; payment_id?: string }>(req);
  const question = (body.question || "Why was this blocked?").trim();

  const explanation = await updateStore((store) => {
    if (body.event_id) {
      const event = store.events.find((e) => e.event_id === body.event_id);
      if (!event) throw new Error("Event not found");
      return explainEvent(event.message, event.type, event.payload);
    }
    if (body.payment_id) {
      const events = store.events.filter((e) => e.payload.payment_id === body.payment_id);
      const last = events.at(-1);
      if (!last) return "No policy or payment events were recorded for that payment yet.";
      return explainEvent(last.message, last.type, last.payload);
    }
    const blocked = [...store.events].reverse().find((e) => e.type === "policy.decision" && e.payload.decision === "block");
    if (blocked) return explainEvent(blocked.message, blocked.type, blocked.payload);
    const needs = [...store.events].reverse().find((e) => e.type === "policy.decision" && e.payload.decision === "needs-approval");
    if (needs) {
      return `Nothing was blocked in the latest run, but a purchase needed approval. ${explainEvent(needs.message, needs.type, needs.payload)}`;
    }
    if (/block|why/i.test(question) && store.events.length === 0) {
      return "No decisions have been recorded yet. Run the demo scenario or submit a goal first.";
    }
    const last = store.events.at(-1);
    return last
      ? `The most recent event was "${last.type}": ${last.message}`
      : "The audit log is empty.";
  });

  return ok({ question, explanation });
}

function explainEvent(message: string, type: string, payload: Record<string, unknown>): string {
  if (type === "policy.decision") {
    const checks = (payload.checks as Array<{ code: string; passed: boolean; detail: string }> | undefined) ?? [];
    const failed = checks.filter((c) => !c.passed);
    const header = String(payload.decision === "block" ? "This purchase was blocked." : payload.decision === "needs-approval" ? "This purchase is waiting for you." : "This purchase was allowed.");
    const details = failed.length
      ? failed.map((c) => c.detail).join(" ")
      : String(payload.reason ?? message);
    return `${header} ${details} MeshPaL decided this with deterministic policy checks, not model judgment. Merchant listing text is treated as data, never as instructions.`;
  }
  return message;
}
