export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatJson(messages: ChatMessage[]): Promise<{ text: string; model: string }> {
  const base = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  if (!key) {
    throw new Error("AI_API_KEY is not set");
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, model: data.model || model };
}

export async function chatText(messages: ChatMessage[]): Promise<{ text: string; model: string }> {
  const base = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  if (!key) throw new Error("AI_API_KEY is not set");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, temperature: 0.3, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: data.choices?.[0]?.message?.content ?? "", model: data.model || model };
}
