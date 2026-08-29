import { getVercelOidcToken } from "@vercel/oidc";
import type { LlmProvider, StructuredRequest, StructuredResponse } from "./provider";

type OpenAIOutputContent = { type?: string; text?: unknown };
type OpenAIOutputItem = { content?: OpenAIOutputContent[] };
type OpenAIResponsePayload = {
  output?: OpenAIOutputItem[];
  output_text?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
  data?: Array<{ embedding?: number[] }>;
};

type AiEndpoint = {
  token: string;
  baseUrl: string;
};

async function endpoint(): Promise<AiEndpoint> {
  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  if (gatewayApiKey) {
    return {
      token: gatewayApiKey,
      baseUrl: "https://ai-gateway.vercel.sh/v1"
    };
  }

  const oidcToken = await getVercelOidcToken();
  if (oidcToken) {
    return {
      token: oidcToken,
      baseUrl: "https://ai-gateway.vercel.sh/v1"
    };
  }

  throw new Error("No Vercel AI Gateway credential is available. Configure Vercel OIDC or AI_GATEWAY_API_KEY.");
}

function routedModel(model: string) {
  return model.includes("/") ? model : `openai/${model}`;
}

function extractText(payload: OpenAIResponsePayload): string {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  throw new Error("AI response did not contain output text.");
}

export class OpenAIResponsesProvider implements LlmProvider {
  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const ai = await endpoint();
    const model = routedModel(request.model);
    const response = await fetch(`${ai.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ai.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
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
      throw new Error(`AI provider error ${response.status}: ${JSON.stringify(raw).slice(0, 1200)}`);
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
        model,
        requestId: response.headers.get("x-request-id") ?? undefined
      },
      raw
    };
  }

  async embed(input: string) {
    const ai = await endpoint();
    const configured = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const model = routedModel(configured);
    const response = await fetch(`${ai.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ai.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model, input })
    });
    const payload = await response.json() as OpenAIResponsePayload;
    if (!response.ok) throw new Error(`Embedding provider error ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`);
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding) throw new Error("Embedding response did not contain a vector.");
    if (embedding.length !== 1536) throw new Error(`Expected a 1536-dimensional embedding, received ${embedding.length}.`);
    return embedding;
  }
}

export const llm = new OpenAIResponsesProvider();
