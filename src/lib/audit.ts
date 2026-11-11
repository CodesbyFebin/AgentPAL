import { chainHash } from "./crypto";
import type { AuditEvent } from "./types";

/** Recompute every link of the SHA-256 hash chain. Returns the first broken index, if any. */
export function verifyAuditChain(events: AuditEvent[]): { ok: boolean; checked: number; broken_at?: number; detail: string } {
  let prev = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const { hash, ...unsigned } = e;
    if (e.prev_hash !== prev) return { ok: false, checked: i, broken_at: i, detail: `Event ${e.event_id} does not point at the previous hash.` };
    if (chainHash(prev, unsigned) !== hash) return { ok: false, checked: i, broken_at: i, detail: `Event ${e.event_id} was modified after it was written.` };
    prev = hash;
  }
  return { ok: true, checked: events.length, detail: `All ${events.length} audit events chain correctly.` };
}

function csvCell(v: unknown): string {
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function auditCsv(events: AuditEvent[]): string {
  const header = ["event_id", "at", "type", "message", "prev_hash", "hash", "payload"];
  const rows = events.map((e) => [e.event_id, e.at, e.type, e.message, e.prev_hash, e.hash, e.payload].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}
