import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENROUTER_FREE_ATTEMPTS,
  OpenRouterFreeProvider,
  normalizeOpenRouterContent,
  parseOpenRouterJson,
  selectFreeModelAttempts
} from "../lib/ai/openrouter-free";

test("normalizes string and text-part OpenRouter content", () => {
  assert.equal(normalizeOpenRouterContent("  {\"ok\":true}  "), "{\"ok\":true}");
  assert.equal(normalizeOpenRouterContent([{ type: "text", text: "{\"ok\":" }, { type: "text", text: "true}" }]), "{\"ok\":\ntrue}");
  assert.equal(normalizeOpenRouterContent(null), "");
});

test("recovers JSON from markdown and surrounding prose", () => {
  assert.deepEqual(parseOpenRouterJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepEqual(parseOpenRouterJson("Here is the result:\n{\"ok\":true}\nDone."), { ok: true });
});

test("rejects content without parseable JSON", () => {
  assert.throws(() => parseOpenRouterJson("not json"), /FREE_AI_INVALID_JSON/);
});

test("uses only one generic router call after discovered models", () => {
  assert.deepEqual(OPENROUTER_FREE_ATTEMPTS, [{ model: "openrouter/free", mode: "plain" }]);
});

test("selects free text models and prefers latency-oriented structured models", () => {
  const attempts = selectFreeModelAttempts([
    {
      id: "provider/ultra-550b:free",
      pricing: { prompt: "0", completion: "0", request: "0" },
      supported_parameters: ["structured_outputs", "response_format"],
      architecture: { output_modalities: ["text"] },
      top_provider: { max_completion_tokens: 16000 }
    },
    {
      id: "provider/lightning-32b:free",
      pricing: { prompt: "0", completion: "0", request: "0" },
      supported_parameters: ["structured_outputs", "response_format"],
      architecture: { output_modalities: ["text"] },
      top_provider: { max_completion_tokens: 16000 }
    },
    {
      id: "provider/plain-free:free",
      pricing: { prompt: "0", completion: "0", request: "0" },
      supported_parameters: ["max_tokens"],
      architecture: { output_modalities: ["text"] },
      top_provider: { max_completion_tokens: 16000 }
    },
    {
      id: "provider/paid",
      pricing: { prompt: "0.000001", completion: "0", request: "0" },
      supported_parameters: ["structured_outputs"],
      architecture: { output_modalities: ["text"] }
    },
    {
      id: "provider/image-free:free",
      pricing: { prompt: "0", completion: "0", request: "0" },
      supported_parameters: ["structured_outputs"],
      architecture: { output_modalities: ["image"] }
    }
  ], "BookBlueprint");

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.model, "provider/lightning-32b:free");
  assert.equal(attempts[0]?.mode, "schema");
  assert.ok(attempts.some((attempt) => attempt.model === "provider/plain-free:free" && attempt.mode === "plain"));
  assert.ok(!attempts.some((attempt) => attempt.model === "provider/paid"));
  assert.ok(!attempts.some((attempt) => attempt.model === "provider/image-free:free"));
});

test("discovers a live free model before falling back to the generic router", async () => {
  const originalFetch = globalThis.fetch;
  const generationBodies: Array<Record<string, unknown>> = [];
  let discoveryCalls = 0;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/models")) {
      discoveryCalls += 1;
      return new Response(JSON.stringify({
        data: [
          {
            id: "provider/current-free:free",
            pricing: { prompt: "0", completion: "0", request: "0" },
            supported_parameters: ["structured_outputs", "response_format", "max_tokens"],
            architecture: { output_modalities: ["text"] },
            top_provider: { max_completion_tokens: 16000 }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    generationBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({
      id: "gen-test",
      model: "provider/current-free:free",
      choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const provider = new OpenRouterFreeProvider("sk-or-v1-test-key-that-is-long-enough");
    const response = await provider.generateStructured({
      model: "openrouter/free",
      schemaName: "FallbackTest",
      jsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false
      },
      system: "Return the requested result.",
      prompt: "Return ok=true.",
      parse(value) {
        if (typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true) return { ok: true };
        throw new Error("schema mismatch");
      }
    });

    assert.deepEqual(response.value, { ok: true });
    assert.equal(discoveryCalls, 1);
    assert.equal(generationBodies[0]?.model, "provider/current-free:free");
    assert.equal((generationBodies[0]?.response_format as { type?: string }).type, "json_schema");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
