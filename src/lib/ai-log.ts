import { id, nowIso } from "./ids";
import type { AiCallLog, StoreData } from "./types";

export function logAiCall(store: StoreData, entry: Omit<AiCallLog, "call_id" | "at"> & { at?: string }): AiCallLog {
  const row: AiCallLog = {
    call_id: id("ai"),
    at: entry.at || nowIso(),
    ...entry,
  };
  store.ai_calls = store.ai_calls || [];
  store.ai_calls.push(row);
  return row;
}
