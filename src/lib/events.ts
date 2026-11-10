import { chainHash } from "./crypto";
import { id, nowIso } from "./ids";
import type { AuditEvent, StoreData } from "./types";

export function appendEvent(
  store: StoreData,
  type: string,
  message: string,
  payload: Record<string, unknown> = {},
): AuditEvent {
  const prev = store.events[store.events.length - 1];
  const prev_hash = prev?.hash ?? "0".repeat(64);
  const event_id = id("evt");
  const at = nowIso();
  const unsigned = {
    event_id,
    type,
    at,
    message,
    attribution: "paid by agent on behalf of user" as const,
    payload,
    prev_hash,
  };
  const hash = chainHash(prev_hash, unsigned);
  const event: AuditEvent = { ...unsigned, hash };
  store.events.push(event);
  return event;
}
