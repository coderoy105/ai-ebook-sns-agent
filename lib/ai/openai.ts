import type { LlmProvider, StructuredRequest, StructuredResponse } from "./provider";

type OpenAIOutputContent = { type?: string; text?: unknown };
type OpenAIOutputItem = { content?: OpenAIOutputContent[] };
type OpenAIResponsePayload = {
  output?: OpenAIOutputItem[];
  output_text?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
  data?: Array<{ embedding?: number[] }>;
};

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing.");
  return key;
}

function extractText(payload: OpenAIResponsePayload): string {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  throw new Error("OpenAI response did not contain output text.");
}

export class OpenAIResponsesProvider implements LlmProvider {
  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        input: [
          { role: "system", content: [{ type: "input_text", text: request.system }] },
          { role: "user", content: [{ type: "input_text", text: request.prompt }] }
        ],
        ...(request.webSearch ? { tools: [{ type: "web_search" }] } : {}),
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema
          }
        }
      }),
      signal: request.signal
    });

    const raw = await response.json() as OpenAIResponsePayload;
    if (!response.ok) {
      throw new Error(`OpenAI error ${response.status}: ${JSON.stringify(raw).slice(0, 1200)}`);
    }

    const text = extractText(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Structured output was not valid JSON.");
    }

    return {
      value: request.parse(parsed),
      usage: {
        inputTokens: raw.usage?.input_tokens ?? 0,
        outputTokens: raw.usage?.output_tokens ?? 0,
        durationMs: Date.now() - started,
        model: request.model,
        requestId: response.headers.get("x-request-id") ?? undefined
      },
      raw
    };
  }

  async embed(input: string) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        input
      })
    });
    const payload = await response.json() as OpenAIResponsePayload;
    if (!response.ok) throw new Error(`Embedding error ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`);
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding) throw new Error("Embedding response did not contain a vector.");
    return embedding;
  }
}

export const llm = new OpenAIResponsesProvider();
