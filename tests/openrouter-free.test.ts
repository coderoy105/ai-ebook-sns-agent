import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENROUTER_FREE_ATTEMPTS,
  OpenRouterFreeProvider,
  normalizeOpenRouterContent,
  parseOpenRouterJson
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

test("uses only the dynamic free router and progressively relaxes formatting", () => {
  assert.deepEqual(OPENROUTER_FREE_ATTEMPTS.map((attempt) => attempt.model), [
    "openrouter/free",
    "openrouter/free",
    "openrouter/free",
    "openrouter/free"
  ]);
  assert.deepEqual(OPENROUTER_FREE_ATTEMPTS.map((attempt) => attempt.mode), ["schema", "schema", "json", "plain"]);
});

test("falls back to plain JSON-only output when structured free routing fails", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    call += 1;
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);

    if (call < 4) {
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "error",
          message: { content: "" },
          error: { message: "No compatible free endpoint was available" }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({
      id: "gen-test",
      model: "some-current-free-model",
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
    assert.equal(call, 4);
    assert.equal((bodies[0].response_format as { type?: string }).type, "json_schema");
    assert.equal((bodies[2].response_format as { type?: string }).type, "json_object");
    assert.equal(bodies[3].response_format, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
