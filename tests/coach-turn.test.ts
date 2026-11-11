import { afterEach, expect, it, vi } from "vitest";
import * as coachTools from "@/lib/ai-tools";
import { coachTurn } from "@/lib/coach-turn";
import { readStore } from "@/lib/store";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("sends assistant tool calls and matching results to the configured endpoint", async () => {
  const baseUrl = "http://127.0.0.1:11434/v1";
  const model = "qwen3:4b";
  vi.stubEnv("AI_BASE_URL", baseUrl);
  vi.stubEnv("AI_API_KEY", "ollama");
  vi.stubEnv("AI_MODEL", model);

  const toolCalls = ["get_accounts", "propose_payment"].map((name) => ({
    id: `call_${name}`,
    type: "function",
    function: { name, arguments: name === "propose_payment" ? '{"sku":"nova_air_48990"}' : "{}" },
  }));
  const reply = "I checked your demo accounts and prepared a payment proposal.";
  const proposal = { status: "pending_approval" };
  const runCoachTool = coachTools.runCoachTool;
  vi.spyOn(coachTools, "runCoachTool").mockImplementation((store, name, args) =>
    name === "propose_payment" ? Promise.resolve(proposal) : runCoachTool(store, name, args),
  );
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
  const result = await coachTurn(store, "List my demo accounts and propose the NovaBook Air.");

  expect(fetch).toHaveBeenCalledTimes(2);
  const [url, request] = fetch.mock.calls[1];
  expect(url).toBe(`${baseUrl}/chat/completions`);
  const body = JSON.parse(String(request?.body));
  expect(body.model).toBe(model);
  const [assistant, accounts, payment] = body.messages.slice(2);
  expect(assistant).toEqual({ role: "assistant", content: null, tool_calls: toolCalls });
  expect(accounts).toMatchObject({ role: "tool", tool_call_id: toolCalls[0].id });
  expect(JSON.parse(accounts.content)).toHaveLength(store.finance.accounts.length);
  expect(payment).toMatchObject({ role: "tool", tool_call_id: toolCalls[1].id });
  expect(JSON.parse(payment.content)).toEqual(proposal);
  expect(result).toMatchObject({
    reply,
    planner: "ai",
    model,
    tools_used: ["get_accounts", "propose_payment"],
  });
});
