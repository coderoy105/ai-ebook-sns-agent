import type { LlmProvider, StructuredRequest, StructuredResponse } from "./provider";

type OpenRouterContentPart = { type?: string; text?: string | null };
type OpenRouterError = { message?: string; code?: string | number };
type OpenRouterMessage = {
  content?: string | OpenRouterContentPart[] | null;
  refusal?: string | null;
};
type OpenRouterChoice = {
  message?: OpenRouterMessage;
  finish_reason?: string | null;
  error?: OpenRouterError;
};
type OpenRouterPayload = {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: OpenRouterError;
  openrouter_metadata?: unknown;
};

type AttemptMode = "schema" | "json" | "plain";
type AttemptPlan = { model: string; mode: AttemptMode };
type FailedAttempt = {
  model: string;
  mode: AttemptMode;
  kind: "http" | "empty" | "json" | "schema" | "provider";
  status?: number;
  finishReason?: string | null;
  requestId?: string;
  providerError?: string;
};

export const OPENROUTER_FREE_MODEL = "openrouter/free";

// Do not pin free provider model IDs here. Free endpoints and provider capability
// combinations change frequently. The free router is designed to select from the
// currently available zero-cost models, so we retry it while progressively
// relaxing output-format requirements and validate the result locally.
export const OPENROUTER_FREE_ATTEMPTS: readonly AttemptPlan[] = [
  { model: OPENROUTER_FREE_MODEL, mode: "schema" },
  { model: OPENROUTER_FREE_MODEL, mode: "schema" },
  { model: OPENROUTER_FREE_MODEL, mode: "json" },
  { model: OPENROUTER_FREE_MODEL, mode: "plain" }
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

function safeProviderError(message: string | undefined) {
  if (!message) return undefined;
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 220);
}

function isRateLimited(message: string | undefined, status?: number) {
  return status === 429 || /rate limit|quota|daily limit|free.*limit/i.test(message ?? "");
}

function logFailedAttempt(attempt: FailedAttempt) {
  console.warn("[free-ai] OpenRouter attempt failed", attempt);
}

function jsonOnlyInstruction<T>(request: StructuredRequest<T>) {
  return [
    request.system,
    "Return only one valid JSON value. Do not use Markdown fences or explanatory text.",
    "The JSON must satisfy this schema exactly:",
    JSON.stringify(request.jsonSchema)
  ].join("\n\n");
}

function buildRequestBody<T>(request: StructuredRequest<T>, attempt: AttemptPlan) {
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages: [
      { role: "system", content: attempt.mode === "schema" ? request.system : jsonOnlyInstruction(request) },
      { role: "user", content: request.prompt }
    ],
    provider: { allow_fallbacks: true },
    max_tokens: outputBudget(request.schemaName),
    stream: false,
    usage: { include: true }
  };

  if (attempt.mode === "schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.schemaName,
        strict: true,
        schema: request.jsonSchema
      }
    };
    body.plugins = [{ id: "response-healing" }];
  } else if (attempt.mode === "json") {
    body.response_format = { type: "json_object" };
    body.plugins = [{ id: "response-healing" }];
  }

  return body;
}

export class OpenRouterFreeProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey || apiKey.length < 16) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    let rateLimitedAttempts = 0;
    let lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";

    for (const attempt of OPENROUTER_FREE_ATTEMPTS) {
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
          body: JSON.stringify(buildRequestBody(request, attempt)),
          signal: request.signal
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";
        logFailedAttempt({ model: attempt.model, mode: attempt.mode, kind: "provider" });
        continue;
      }

      const requestId = response.headers.get("x-request-id") ?? undefined;
      const rawText = await response.text();
      let raw: OpenRouterPayload;
      try {
        raw = rawText ? JSON.parse(rawText) as OpenRouterPayload : {};
      } catch {
        lastFailure = "FREE_AI_INVALID_PROVIDER_RESPONSE";
        logFailedAttempt({ model: attempt.model, mode: attempt.mode, kind: "provider", status: response.status, requestId });
        continue;
      }

      const choice = raw.choices?.[0];
      const providerError = safeProviderError(choice?.error?.message ?? raw.error?.message);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("FREE_AI_CONNECTION_EXPIRED");
        if (isRateLimited(providerError, response.status)) {
          rateLimitedAttempts += 1;
          lastFailure = "FREE_AI_DAILY_LIMIT";
        } else {
          lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";
        }
        logFailedAttempt({ model: attempt.model, mode: attempt.mode, kind: "http", status: response.status, requestId, providerError });
        continue;
      }

      const content = normalizeOpenRouterContent(choice?.message?.content);
      if (!content) {
        if (isRateLimited(providerError)) {
          rateLimitedAttempts += 1;
          lastFailure = "FREE_AI_DAILY_LIMIT";
        } else {
          lastFailure = choice?.finish_reason === "length" ? "FREE_AI_TRUNCATED_RESPONSE" : "FREE_AI_TEMPORARILY_UNAVAILABLE";
        }
        logFailedAttempt({
          model: attempt.model,
          mode: attempt.mode,
          kind: "empty",
          finishReason: choice?.finish_reason,
          requestId,
          providerError
        });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = parseOpenRouterJson(content);
      } catch {
        lastFailure = "FREE_AI_INVALID_JSON";
        logFailedAttempt({ model: attempt.model, mode: attempt.mode, kind: "json", finishReason: choice?.finish_reason, requestId, providerError });
        continue;
      }

      let value: T;
      try {
        value = request.parse(parsed);
      } catch {
        lastFailure = "FREE_AI_SCHEMA_MISMATCH";
        logFailedAttempt({ model: attempt.model, mode: attempt.mode, kind: "schema", finishReason: choice?.finish_reason, requestId, providerError });
        continue;
      }

      return {
        value,
        usage: {
          inputTokens: raw.usage?.prompt_tokens ?? 0,
          outputTokens: raw.usage?.completion_tokens ?? 0,
          durationMs: Date.now() - started,
          model: raw.model ?? attempt.model,
          requestId: requestId ?? raw.id
        },
        raw
      };
    }

    if (rateLimitedAttempts === OPENROUTER_FREE_ATTEMPTS.length) throw new Error("FREE_AI_DAILY_LIMIT");
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
