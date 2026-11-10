import { id, nowIso } from "./ids";
import { redactSecrets } from "./ai-permissions";
import type { AiCallLog, StoreData } from "./types";

export function logAiCall(store: StoreData, entry: Omit<AiCallLog, "call_id" | "at"> & { at?: string }): AiCallLog {
  const row: AiCallLog = {
    call_id: id("ai"),
    at: entry.at || nowIso(),
    ...entry,
    input_summary: redactSecrets(entry.input_summary || ""),
    output_summary: redactSecrets(entry.output_summary || ""),
    error: entry.error ? redactSecrets(entry.error) : undefined,
  };
  store.ai_calls = store.ai_calls || [];
  store.ai_calls.push(row);
  store.ai_tool_logs = store.ai_tool_logs || [];
  if (row.kind === "tool") store.ai_tool_logs.push(row);
  return row;
}
