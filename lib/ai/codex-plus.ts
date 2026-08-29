import { Codex } from "@openai/codex-sdk";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CODEX_LUNA_MODEL, createEphemeralCodexHome } from "@/lib/ai/codex-runtime";

type StructuredArgs<T> = {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  parse: (value: unknown) => T;
  timeoutMs?: number;
};

type CodexUsage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
  requestId?: string;
};

function classifyCodexError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate.?limit|usage.?limit|quota|credit|limit reached/i.test(message)) return new Error("CODEX_USAGE_LIMIT");
  if (/unauthor|login|auth|token|credential|sign.?in/i.test(message)) return new Error("CODEX_CONNECTION_EXPIRED");
  if (/model.*not.*found|unknown model|unavailable model/i.test(message)) return new Error("CODEX_LUNA_UNAVAILABLE");
  if (/abort|timeout|timed out/i.test(message)) return new Error("CODEX_TEMPORARILY_UNAVAILABLE");
  return new Error(`CODEX_GENERATION_FAILED:${message.slice(0, 500)}`);
}

async function loadAuth(userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<string | null>("get_codex_chatgpt_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data.trim().length > 0 ? data : null;
}

async function saveRefreshedAuth(userId: string, authJson: string) {
  const service = createServiceSupabase();
  const { error } = await service.rpc("store_codex_chatgpt_credential", {
    p_user_id: userId,
    p_auth_json: authJson
  });
  if (error) throw new Error(error.message);
}

function safeJson(text: string) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); }
  catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return JSON.parse(fenced);
    const startObject = trimmed.indexOf("{");
    const endObject = trimmed.lastIndexOf("}");
    if (startObject >= 0 && endObject > startObject) return JSON.parse(trimmed.slice(startObject, endObject + 1));
    const startArray = trimmed.indexOf("[");
    const endArray = trimmed.lastIndexOf("]");
    if (startArray >= 0 && endArray > startArray) return JSON.parse(trimmed.slice(startArray, endArray + 1));
    throw new Error("CODEX_INVALID_JSON");
  }
}

export class CodexPlusProvider {
  constructor(private readonly userId: string) {}

  async generateStructured<T>(args: StructuredArgs<T>): Promise<{ value: T; usage: CodexUsage }> {
    const authJson = await loadAuth(this.userId);
    if (!authJson) throw new Error("CODEX_CONNECTION_REQUIRED");

    const runtime = await createEphemeralCodexHome(authJson);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 150000);

    try {
      const codex = new Codex({
        env: runtime.env,
        config: {
          cli_auth_credentials_store: "file",
          check_for_update_on_startup: false
        }
      });
      const thread = codex.startThread({
        model: CODEX_LUNA_MODEL,
        modelReasoningEffort: "medium",
        sandboxMode: "read-only",
        approvalPolicy: "never",
        skipGitRepoCheck: true,
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        workingDirectory: runtime.dir,
        threadSource: "ai_book_studio"
      });

      const turn = await thread.run(
        `${args.system}\n\n${args.prompt}\n\nReturn only the structured result required by the supplied output schema.`,
        { outputSchema: args.jsonSchema, signal: controller.signal }
      );
      if (!turn.finalResponse.trim()) throw new Error("CODEX_EMPTY_RESPONSE");
      const value = args.parse(safeJson(turn.finalResponse));

      try {
        const refreshed = await runtime.readAuthJson();
        if (refreshed.trim() && refreshed.trim() !== authJson.trim()) await saveRefreshedAuth(this.userId, refreshed);
      } catch {
        // Generation already succeeded; a later call can refresh again if auth persistence did not change.
      }

      return {
        value,
        usage: {
          inputTokens: Number(turn.usage?.input_tokens ?? 0),
          outputTokens: Number(turn.usage?.output_tokens ?? 0),
          durationMs: Date.now() - startedAt,
          model: CODEX_LUNA_MODEL,
          requestId: thread.id ?? undefined
        }
      };
    } catch (error) {
      throw classifyCodexError(error);
    } finally {
      clearTimeout(timeout);
      await runtime.cleanup();
    }
  }
}
