import { z } from "zod";
import { chatText } from "@/lib/ai";
import { coachTurn } from "@/lib/coach-turn";
import { fail, ok, readJson } from "@/lib/http";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const request = z.object({
  message: z.string().trim().min(1).max(3000),
  mode: z.enum(["chat", "search", "imagine"]).default("chat"),
});

const resources = [
  { name: "Orders and checkout", url: "https://developer.paypal.com/api/orders/v2", snippet: "Create, authorize, capture and track PayPal orders.", terms: /order|checkout|track|capture/ },
  { name: "Webhook verification", url: "https://developer.paypal.com/api/rest/webhooks/", snippet: "Configure and verify PayPal webhook notifications.", terms: /webhook|verify|signature/ },
  { name: "PayPal REST APIs", url: "https://developer.paypal.com/api/rest/current-resources/", snippet: "Reference index for invoices, disputes, payouts, vault and subscriptions.", terms: /invoice|dispute|payout|vault|subscription|catalog|refund/ },
  { name: "PayPal Agent Toolkit", url: "https://github.com/paypal/agent-toolkit", snippet: "PayPal tool definitions for supported agent frameworks.", terms: /toolkit|agent|tool/ },
  { name: "PayPal MCP", url: "https://developer.paypal.com/ai-tools/mcp-server", snippet: "Connect a merchant account to a PayPal MCP client.", terms: /mcp|agent|tool/ },
];

export async function POST(req: Request) {
  const parsed = request.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Send a message of 1–3,000 characters and a supported mode.");
  const { message, mode } = parsed.data;
  try {
    if (mode === "search") {
      const matches = resources.filter((item) => item.terms.test(message.toLowerCase()));
      const sources = (matches.length ? matches : resources).map(({ name, url, snippet }) => ({ name, url, snippet }));
      return ok({ reply: sources.map((s, i) => `${i + 1}. **${s.name}** — ${s.snippet}`).join("\n"), sources });
    }
    if (mode === "imagine") {
      if (!process.env.AI_API_KEY) return fail("Artifact generation needs a configured AI model.", 503);
      const result = await chatText([
        { role: "system", content: "Create a standalone visual or document. Return a fenced block with an artifact:html, artifact:svg, artifact:markdown or artifact:code label. Use static HTML and CSS. Do not include scripts, remote assets, or instructions to execute a payment." },
        { role: "user", content: message },
      ]);
      return ok({ reply: result.text });
    }
    return ok(await updateStore((store) => coachTurn(store, message)));
  } catch {
    return fail("The Studio request could not be completed.", 502);
  }
}
