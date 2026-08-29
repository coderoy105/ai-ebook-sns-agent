import type { LlmProvider, StructuredRequest, StructuredResponse } from "./provider";

type OpenRouterContentPart = { type?: string; text?: string | null };
type OpenRouterMessage = {
  content?: string | OpenRouterContentPart[] | null;
  refusal?: string | null;
};
type OpenRouterChoice = {
  message?: OpenRouterMessage;
  finish_reason?: string | null;
};
type OpenRouterPayload = {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string | number };
};

type FailedAttempt = {
  model: string;
  kind: "http" | "empty" | "json" | "schema" | "provider";
  status?: number;
  finishReason?: string | null;
  requestId?: string;
};

export const OPENROUTER_FREE_MODEL = "openrouter/free";
export const OPENROUTER_FREE_MODELS = [
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
  OPENROUTER_FREE_MODEL
] as const;

export function normalizeOpenRouterContent(content: OpenRouterMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function parseOpenRouterJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (withoutFence !== trimmed) candidates.push(withoutFence);

  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(withoutFence.slice(objectStart, objectEnd + 1));

  const arrayStart = withoutFence.indexOf("[");
  const arrayEnd = withoutFence.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(withoutFence.slice(arrayStart, arrayEnd + 1));

  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch { /* try the next recovery shape */ }
  }
  throw new Error("FREE_AI_INVALID_JSON");
}

function outputBudget(schemaName: string) {
  if (/blueprint|planner/i.test(schemaName)) return 14000;
  if (/section|rewrite/i.test(schemaName)) return 9000;
  return 7000;
}

function logFailedAttempt(attempt: FailedAttempt) {
  console.warn("[free-ai] OpenRouter attempt failed", attempt);
}

export class OpenRouterFreeProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey || apiKey.length < 16) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    let rateLimitedAttempts = 0;
    let lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";

    for (const model of OPENROUTER_FREE_MODELS) {
      let response: Response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
            "http-referer": "https://ai-book-studio-iota.vercel.app",
            "x-title": "AI Book Studio",
            "x-openrouter-metadata": "enabled"
          },
          body: JSON.stringify({
            model,
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
            plugins: [{ id: "response-healing" }],
            provider: { require_parameters: true, allow_fallbacks: true },
            max_tokens: outputBudget(request.schemaName),
            stream: false,
            usage: { include: true }
          }),
          signal: request.signal
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";
        logFailedAttempt({ model, kind: "provider" });
        continue;
      }

      const requestId = response.headers.get("x-request-id") ?? undefined;
      const rawText = await response.text();
      let raw: OpenRouterPayload;
      try {
        raw = rawText ? JSON.parse(rawText) as OpenRouterPayload : {};
      } catch {
        lastFailure = "FREE_AI_INVALID_PROVIDER_RESPONSE";
        logFailedAttempt({ model, kind: "provider", status: response.status, requestId });
        continue;
      }

      if (!response.ok) {
        const message = raw.error?.message ?? `OpenRouter error ${response.status}`;
        if (response.status === 401 || response.status === 403) throw new Error("FREE_AI_CONNECTION_EXPIRED");
        const rateLimited = response.status === 429 || /rate limit|quota|daily limit/i.test(message);
        if (rateLimited) {
          rateLimitedAttempts += 1;
          lastFailure = "FREE_AI_DAILY_LIMIT";
        } else {
          lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";
        }
        logFailedAttempt({ model, kind: "http", status: response.status, requestId });
        continue;
      }

      const choice = raw.choices?.[0];
      const content = normalizeOpenRouterContent(choice?.message?.content);
      if (!content) {
        lastFailure = choice?.finish_reason === "length" ? "FREE_AI_TRUNCATED_RESPONSE" : "FREE_AI_EMPTY_RESPONSE";
        logFailedAttempt({ model, kind: "empty", finishReason: choice?.finish_reason, requestId });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = parseOpenRouterJson(content);
      } catch {
        lastFailure = "FREE_AI_INVALID_JSON";
        logFailedAttempt({ model, kind: "json", finishReason: choice?.finish_reason, requestId });
        continue;
      }

      let value: T;
      try {
        value = request.parse(parsed);
      } catch {
        lastFailure = "FREE_AI_SCHEMA_MISMATCH";
        logFailedAttempt({ model, kind: "schema", finishReason: choice?.finish_reason, requestId });
        continue;
      }

      return {
        value,
        usage: {
          inputTokens: raw.usage?.prompt_tokens ?? 0,
          outputTokens: raw.usage?.completion_tokens ?? 0,
          durationMs: Date.now() - started,
          model: raw.model ?? model,
          requestId: requestId ?? raw.id
        },
        raw
      };
    }

    if (rateLimitedAttempts === OPENROUTER_FREE_MODELS.length) throw new Error("FREE_AI_DAILY_LIMIT");
    throw new Error(lastFailure === "FREE_AI_DAILY_LIMIT" ? "FREE_AI_TEMPORARILY_UNAVAILABLE" : lastFailure);
  }

  async embed(): Promise<number[]> {
    throw new Error("FREE_AI_EMBEDDINGS_UNAVAILABLE");
  }
}

export function openRouterProviderFromRequest(request: Request) {
  const key = request.headers.get("x-openrouter-key")?.trim();
  return key ? new OpenRouterFreeProvider(key) : null;
}
