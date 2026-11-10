import { afterEach, expect, it, vi } from "vitest";
import { coachTurn } from "@/lib/coach-turn";
import { readStore } from "@/lib/store";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("sends assistant tool calls and matching results to the configured endpoint", async () => {
  const baseUrl = "http://127.0.0.1:11434/v1";
  const model = "qwen3:4b";
  vi.stubEnv("AI_BASE_URL", baseUrl);
  vi.stubEnv("AI_API_KEY", "ollama");
  vi.stubEnv("AI_MODEL", model);

  const toolCalls = ["get_accounts", "get_goals"].map((name) => ({
    id: `call_${name}`,
    type: "function",
    function: { name, arguments: "{}" },
  }));
  const reply = "I checked your demo accounts and goals.";
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({
      model,
      choices: [{ message: { content: null, tool_calls: toolCalls } }],
    }))
    .mockResolvedValueOnce(Response.json({
      model,
      choices: [{ message: { content: reply } }],
    }));
  vi.stubGlobal("fetch", fetch);

  const store = structuredClone(readStore());
  const result = await coachTurn(store, "List my demo accounts and goals.");

  expect(fetch).toHaveBeenCalledTimes(2);
  const [url, request] = fetch.mock.calls[1];
  expect(url).toBe(`${baseUrl}/chat/completions`);
  const body = JSON.parse(String(request?.body));
  expect(body.model).toBe(model);
  const [assistant, accounts, goals] = body.messages.slice(2);
  expect(assistant).toEqual({ role: "assistant", content: null, tool_calls: toolCalls });
  expect(accounts).toMatchObject({ role: "tool", tool_call_id: toolCalls[0].id });
  expect(JSON.parse(accounts.content)).toHaveLength(store.finance.accounts.length);
  expect(goals).toMatchObject({ role: "tool", tool_call_id: toolCalls[1].id });
  expect(JSON.parse(goals.content)).toEqual(store.finance.savings_goals);
  expect(result).toMatchObject({
    reply,
    planner: "ai",
    model,
    tools_used: ["get_accounts", "get_goals"],
  });
});
