import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import {
  backgroundProviderLabel,
  generateBackgroundStructured,
  type BackgroundAiProvider
} from "@/lib/ai/background-provider";

const RequestSchema = z.object({
  idea: z.string().trim().min(8).max(8000),
  bookType: z.string().trim().min(2).max(100),
  audience: z.string().trim().max(500).default(""),
  ageGroup: z.string().trim().max(100).default(""),
  tone: z.string().trim().max(500).default(""),
  aiProvider: z.enum(["openrouter", "codex"])
});

const ResultSchema = z.object({
  suggestions: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(220),
    angle: z.string().trim().min(1).max(80)
  })).length(5)
});

const resultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "reason", "angle"],
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
          angle: { type: "string" }
        }
      }
    }
  }
} as const;

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

async function saveOpenRouterKey(request: Request, userId: string) {
  const key = request.headers.get("x-openrouter-key")?.trim();
  if (!key || key.length < 16) return;
  const service = createServiceSupabase();
  const { error } = await service.rpc("store_openrouter_credential", { p_user_id: userId, p_secret: key });
  if (error) throw new Error(error.message);
}

function connectionError(provider: BackgroundAiProvider) {
  return provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED";
}

function promptFor(input: z.infer<typeof RequestSchema>) {
  return [
    `책 아이디어: ${input.idea}`,
    `책 종류: ${input.bookType}`,
    `예상 독자: ${input.audience || "미정"}`,
    `독자 연령: ${input.ageGroup || "미정"}`,
    `문체: ${input.tone || "미정"}`,
    "",
    "실제 한국 서점에서 경쟁할 수 있는 제목 후보를 정확히 5개 제안하세요.",
    "후보마다 서로 다른 전략을 사용하세요: 명료형, 호기심형, 개념형, 감성형, 강한 상업형 중 적합한 방향을 고르게 섞으세요.",
    "제목은 기억하기 쉽고 입으로 말했을 때 자연스러워야 합니다. 설명문처럼 너무 길거나 부자연스러운 조사 나열을 피하세요.",
    "'완벽 가이드', '모든 것', '새로운 시대', '혁명', '궁극의' 같은 상투적 AI 카피와 과장된 클릭베이트는 피하세요.",
    "각 후보에는 2~8자의 짧은 전략명(angle)과 왜 독자에게 효과적인지 한 문장(reason)을 작성하세요."
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const input = RequestSchema.parse(await request.json());
    await assertRateLimit(user.id, "title-suggestions", 24, 3600);
    if (input.aiProvider === "openrouter") await saveOpenRouterKey(request, user.id);

    const connection = await import("@/lib/ai/provider-connection");
    if (!(await connection.hasBackgroundCredential(user.id, input.aiProvider))) {
      return errorResponse(connectionError(input.aiProvider), 428, { reconnect: true, provider: input.aiProvider });
    }

    const generation = await generateBackgroundStructured(input.aiProvider, user.id, {
      schemaName: "draft_book_title_suggestions",
      jsonSchema: resultJsonSchema as unknown as Record<string, unknown>,
      system: "당신은 한국 출판사의 시니어 북 에디터이자 네이밍 카피라이터입니다. 독자와 장르를 먼저 파악하고, 실제 서점에서 기억되고 검색되며 말하기 자연스러운 제목을 설계합니다.",
      prompt: promptFor(input),
      parse: (value) => ResultSchema.parse(value),
      timeoutMs: 90_000
    });

    return NextResponse.json({
      suggestions: generation.value.suggestions,
      provider: input.aiProvider,
      providerLabel: backgroundProviderLabel(input.aiProvider)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "제목 추천 입력을 확인해 주세요.");
    const message = error instanceof Error ? error.message : "TITLE_SUGGESTION_FAILED";
    if (["CODEX_CONNECTION_REQUIRED", "CODEX_CONNECTION_EXPIRED", "FREE_AI_CONNECTION_REQUIRED", "FREE_AI_CONNECTION_EXPIRED"].includes(message)) {
      const provider = message.startsWith("CODEX_") ? "codex" : "openrouter";
      return errorResponse(message, 428, { reconnect: true, provider });
    }
    if (["CODEX_USAGE_LIMIT", "FREE_AI_DAILY_LIMIT", "RATE_LIMITED"].includes(message)) return errorResponse(message, 429);
    if (message === "CODEX_LUNA_UNAVAILABLE") return errorResponse(message, 409);
    return errorResponse(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}
