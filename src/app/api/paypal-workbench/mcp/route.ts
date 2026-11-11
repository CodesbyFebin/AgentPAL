import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fail, ok } from "@/lib/http";
import { hasPayPalCreds, sandboxAccessToken } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!hasPayPalCreds()) return fail("Configure a PayPal sandbox app to discover its MCP tools.", 503);

  const client = new Client({ name: "AgentPaL tool catalog", version: "1.0.0" });
  try {
    const token = await sandboxAccessToken();
    if (!token) return fail("PayPal did not return a sandbox access token.", 502);
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.sandbox.paypal.com/http"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    });
    const signal = AbortSignal.timeout(12_000);
    await client.connect(transport, { signal });
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
      tools.push(...page.tools.map((tool) => ({
        name: tool.name, description: (tool.description ?? "").slice(0, 180), permission: "MCP discovery",
      })));
      cursor = page.nextCursor;
    } while (cursor && tools.length < 200 && !signal.aborted);
    return ok({ tools, truncated: Boolean(cursor) });
  } catch {
    return fail("PayPal sandbox MCP discovery failed. Check the app credentials and MCP authorization.", 502);
  } finally {
    await client.close().catch(() => undefined);
  }
}
