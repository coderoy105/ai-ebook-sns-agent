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

type OpenRouterModel = {
  id?: string;
  context_length?: number;
  expiration_date?: string | null;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
};

type AttemptMode = "schema" | "json" | "plain";
type AttemptPlan = { model: string; mode: AttemptMode };
type FailedAttempt = {
  model: string;
  mode: AttemptMode;
  kind: "http" | "empty" | "json" | "schema" | "provider" | "timeout";
  status?: number;
  finishReason?: string | null;
  requestId?: string;
  providerError?: string;
};

export const OPENROUTER_FREE_MODEL = "openrouter/free";

// One generic router attempt is enough after two discovered-model attempts. This
// matters on the 50 requests/day free tier because failed retries may consume the
// same daily budget as successful calls.
export const OPENROUTER_FREE_ATTEMPTS: readonly AttemptPlan[] = [
  { model: OPENROUTER_FREE_MODEL, mode: "plain" }
] as const;

let cachedFreeModels: { expiresAt: number; models: OpenRouterModel[] } | null = null;
const MODEL_CACHE_MS = 5 * 60 * 1000;
const MODEL_DISCOVERY_TIMEOUT_MS = 6_000;
const GENERATION_ATTEMPT_TIMEOUT_MS = 65_000;
const MAX_DISCOVERED_ATTEMPTS = 2;
const MAX_TOTAL_ATTEMPTS = 3;

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
  // Huge output budgets make free endpoints much slower and increase the chance
  // that Vercel reaches its 300 second function timeout. A blueprint is an
  // outline, not prose, so 6.5k output tokens is deliberately enough here.
  if (/blueprint|planner/i.test(schemaName)) return 6500;
  if (/section|rewrite/i.test(schemaName)) return 5000;
  return 4000;
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

function isZeroPrice(value: string | undefined) {
  if (value == null || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function isCurrentlyAvailable(model: OpenRouterModel) {
  if (!model.expiration_date) return true;
  const expiresAt = Date.parse(model.expiration_date);
  return Number.isNaN(expiresAt) || expiresAt > Date.now();
}

function supportsText(model: OpenRouterModel) {
  const modalities = model.architecture?.output_modalities;
  return !modalities || modalities.includes("text");
}

function isFreeModel(model: OpenRouterModel) {
  return Boolean(model.id) &&
    isZeroPrice(model.pricing?.prompt) &&
    isZeroPrice(model.pricing?.completion) &&
    isZeroPrice(model.pricing?.request) &&
    supportsText(model) &&
    isCurrentlyAvailable(model);
}

function supportsStructuredOutput(model: OpenRouterModel) {
  const parameters = model.supported_parameters ?? [];
  return parameters.includes("structured_outputs") || parameters.includes("response_format");
}

function modelPreferenceScore(model: OpenRouterModel) {
  const id = model.id?.toLowerCase() ?? "";
  let score = supportsStructuredOutput(model) ? 30 : 0;

  // On a free shared provider, smaller / latency-oriented variants are much more
  // useful for a structured planning request than 120B-550B models that can sit
  // in an upstream queue for minutes.
  if (/lightning|flash|mini|small|fast/.test(id)) score += 70;
  if (/(?:^|[-_/])(?:7|8|9|12|14|20|24|27|30|32|35|40)b(?:[-_/.:]|$)/.test(id)) score += 35;
  if (/ultra|550b|405b|400b|235b|120b/.test(id)) score -= 90;
  if ((model.context_length ?? 0) >= 64_000) score += 5;

  return score;
}

export function selectFreeModelAttempts(models: OpenRouterModel[], schemaName: string): AttemptPlan[] {
  const budget = outputBudget(schemaName);
  const candidates = models.filter(isFreeModel);
  const roomy = candidates.filter((model) => {
    const max = model.top_provider?.max_completion_tokens;
    return !max || max >= Math.min(budget, 5000);
  });
  const pool = (roomy.length >= 2 ? roomy : candidates)
    .slice()
    .sort((a, b) => modelPreferenceScore(b) - modelPreferenceScore(a));

  const attempts: AttemptPlan[] = [];
  const structured = pool.find((model) => supportsStructuredOutput(model) && model.id);
  if (structured?.id) attempts.push({ model: structured.id, mode: "schema" });

  const second = pool.find((model) => model.id && model.id !== structured?.id);
  if (second?.id) attempts.push({ model: second.id, mode: "plain" });
  else if (structured?.id) attempts.push({ model: structured.id, mode: "plain" });

  return attempts.slice(0, MAX_DISCOVERED_ATTEMPTS);
}

function createTimedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parent?.reason);

  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onParentAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("FREE_AI_ATTEMPT_TIMEOUT"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}

async function discoverFreeModels(apiKey: string, signal?: AbortSignal): Promise<OpenRouterModel[]> {
  if (cachedFreeModels && cachedFreeModels.expiresAt > Date.now()) return cachedFreeModels.models;

  const guard = createTimedSignal(signal, MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: guard.signal
    });
    if (!response.ok) {
      console.warn("[free-ai] model discovery failed", { status: response.status });
      return [];
    }
    const payload = await response.json() as { data?: OpenRouterModel[] };
    const models = Array.isArray(payload.data) ? payload.data.filter(isFreeModel) : [];
    cachedFreeModels = { expiresAt: Date.now() + MODEL_CACHE_MS, models };
    console.info("[free-ai] discovered current free models", { count: models.length, sample: models.slice(0, 5).map((model) => model.id) });
    return models;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[free-ai] model discovery unavailable", { timedOut: guard.timedOut() });
    return [];
  } finally {
    guard.cleanup();
  }
}

function jsonOnlyInstruction<T>(request: StructuredRequest<T>) {
  return [
    request.system,
    "Return only one valid JSON value. Do not use Markdown fences or explanatory text.",
    "Keep descriptive strings concise so the response finishes quickly.",
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
    let totalAttempts = 0;
    let lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";

    const discovered = await discoverFreeModels(this.apiKey, request.signal);
    const liveAttempts = selectFreeModelAttempts(discovered, request.schemaName);
    const attempts = [...liveAttempts, ...OPENROUTER_FREE_ATTEMPTS].slice(0, MAX_TOTAL_ATTEMPTS);

    for (const attempt of attempts) {
      totalAttempts += 1;
      const guard = createTimedSignal(request.signal, GENERATION_ATTEMPT_TIMEOUT_MS);
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
          signal: guard.signal
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        lastFailure = "FREE_AI_TEMPORARILY_UNAVAILABLE";
        logFailedAttempt({
          model: attempt.model,
          mode: attempt.mode,
          kind: guard.timedOut() ? "timeout" : "provider"
        });
        continue;
      } finally {
        guard.cleanup();
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
          // A second rate-limit response is strong evidence that the account-level
          // free quota is exhausted. Stop instead of burning the remaining retry.
          if (rateLimitedAttempts >= 2) throw new Error("FREE_AI_DAILY_LIMIT");
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
          if (rateLimitedAttempts >= 2) throw new Error("FREE_AI_DAILY_LIMIT");
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

    if (totalAttempts > 0 && rateLimitedAttempts === totalAttempts) throw new Error("FREE_AI_DAILY_LIMIT");
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
