import { NextResponse } from "next/server";
import { sha256Hex } from "./crypto";
import { canonicalJson, nowIso } from "./ids";
import { readStore, updateStore } from "./store";

const inflight = new Map<string, Promise<{ status: number; body: unknown }>>();

export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Idempotency for mutating routes. With an `Idempotency-Key` header, the first response
 * (status + body) is stored. A retry with the same key and the same request replays it without
 * re-running the handler. The same key with a different request body is rejected with 409.
 */
export async function withIdempotency(
  req: Request,
  scope: string,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<NextResponse> {
  const key = req.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) {
    const r = await handler();
    return NextResponse.json(r.body, { status: r.status });
  }
  if (key.length > 200) return NextResponse.json({ error: "Idempotency-Key is too long" }, { status: 400 });
  const request_hash = sha256Hex(canonicalJson({ scope, body: body ?? null }));
  const prior = lookup(key, scope);
  if (prior) {
    if (prior.request_hash !== request_hash) {
      return NextResponse.json({ error: "Idempotency-Key was already used with a different request" }, { status: 409 });
    }
    return NextResponse.json(prior.body, { status: prior.status, headers: { "Idempotent-Replayed": "true" } });
  }
  const flightKey = `${scope}:${key}`;
  const running = inflight.get(flightKey);
  if (running) {
    const r = await running;
    return NextResponse.json(r.body, { status: r.status, headers: { "Idempotent-Replayed": "true" } });
  }
  const p = handler();
  inflight.set(flightKey, p);
  let r: { status: number; body: unknown };
  try {
    r = await p;
  } finally {
    inflight.delete(flightKey);
  }
  // Only successful or deterministic client errors are cached; 5xx can be retried.
  if (r.status < 500) {
    await updateStore((store) => {
      if (!store.idempotency_responses.some((x) => x.key === key && x.scope === scope)) {
        store.idempotency_responses.push({ key, scope, request_hash, status: r.status, body: r.body, created_at: nowIso() });
        if (store.idempotency_responses.length > 500) store.idempotency_responses.splice(0, store.idempotency_responses.length - 500);
      }
    });
  }
  return NextResponse.json(r.body, { status: r.status });
}

function lookup(key: string, scope: string) {
  return readStore().idempotency_responses.find((x) => x.key === key && x.scope === scope);
}
