import type { LlmProvider, StructuredRequest, StructuredResponse } from "./provider";

type OpenRouterPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string | number };
};

export const OPENROUTER_FREE_MODEL = "openrouter/free";

export class OpenRouterFreeProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey || apiKey.length < 16) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://ai-book-studio-iota.vercel.app",
        "x-title": "AI Book Studio"
      },
      body: JSON.stringify({
        model: OPENROUTER_FREE_MODEL,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema
          }
        },
        provider: { require_parameters: true },
        usage: { include: true }
      }),
      signal: request.signal
    });

    const raw = await response.json() as OpenRouterPayload;
    if (!response.ok) {
      const message = raw.error?.message ?? `OpenRouter error ${response.status}`;
      const normalized = response.status === 429 || /rate limit|quota/i.test(message)
        ? "FREE_AI_DAILY_LIMIT"
        : message;
      throw new Error(normalized);
    }

    const content = raw.choices?.[0]?.message?.content;
    if (!content) throw new Error("FREE_AI_EMPTY_RESPONSE");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      try { parsed = JSON.parse(cleaned); }
      catch { throw new Error("FREE_AI_INVALID_JSON"); }
    }

    return {
      value: request.parse(parsed),
      usage: {
        inputTokens: raw.usage?.prompt_tokens ?? 0,
        outputTokens: raw.usage?.completion_tokens ?? 0,
        durationMs: Date.now() - started,
        model: raw.model ?? OPENROUTER_FREE_MODEL,
        requestId: response.headers.get("x-request-id") ?? undefined
      },
      raw
    };
  }

  async embed(): Promise<number[]> {
    throw new Error("FREE_AI_EMBEDDINGS_UNAVAILABLE");
  }
}

export function openRouterProviderFromRequest(request: Request) {
  const key = request.headers.get("x-openrouter-key")?.trim();
  return key ? new OpenRouterFreeProvider(key) : null;
}
