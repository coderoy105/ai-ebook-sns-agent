import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, createServiceSupabase } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import {
  backgroundProviderLabel,
  generateBackgroundStructured,
  normalizeBackgroundProvider,
  type BackgroundAiProvider
} from "@/lib/ai/background-provider";

const TitleUpdateSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(160, "제목은 160자 이내로 입력해 주세요.")
});

const TitleSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(220),
    angle: z.string().trim().min(1).max(80)
  })).length(5)
});

const titleSuggestionJsonSchema = {
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

type Relation<T> = T | T[] | null | undefined;
type BookSettings = { planning_input?: Record<string, unknown> | null };
type BlueprintRow = { id: string; blueprint?: Record<string, unknown> | null; is_active?: boolean; version?: number };

function firstRelation<T>(value: Relation<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function activeBlueprint(value: Relation<BlueprintRow>) {
  const rows = Array.isArray(value) ? [...value] : value ? [value] : [];
  rows.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
  return rows.find((row) => row.is_active !== false) ?? rows[0] ?? null;
}

function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

async function saveOpenRouterKeyFromRequest(request: Request, userId: string) {
  const requestKey = request.headers.get("x-openrouter-key")?.trim();
  if (!requestKey || requestKey.length < 16) return;
  const service = createServiceSupabase();
  const { error } = await service.rpc("store_openrouter_credential", { p_user_id: userId, p_secret: requestKey });
  if (error) throw new Error(error.message);
}

async function loadOwnedBook(bookId: string, userId: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("books")
    .select("id,title,subtitle,idea,book_type,user_id,book_settings(planning_input),book_blueprints(id,blueprint,is_active,version)")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return { supabase, book: data };
}

function providerFromBook(book: { book_settings?: Relation<BookSettings> }): BackgroundAiProvider {
  const settings = firstRelation(book.book_settings);
  return normalizeBackgroundProvider(settings?.planning_input?.aiProvider);
}

function titlePrompt(book: {
  title: string;
  subtitle?: string | null;
  idea?: string | null;
  book_type?: string | null;
  book_settings?: Relation<BookSettings>;
  book_blueprints?: Relation<BlueprintRow>;
}) {
  const settings = firstRelation(book.book_settings);
  const planning = settings?.planning_input ?? {};
  const blueprint = activeBlueprint(book.book_blueprints)?.blueprint ?? {};
  const coreMessage = typeof blueprint.coreMessage === "string" ? blueprint.coreMessage : "";
  const audience = typeof planning.audience === "string" ? planning.audience : "";
  const ageGroup = typeof planning.ageGroup === "string" ? planning.ageGroup : "";
  const tone = typeof planning.tone === "string" ? planning.tone : "";

  return [
    `현재 제목: ${book.title}`,
    `현재 부제: ${book.subtitle ?? "없음"}`,
    `책 아이디어: ${book.idea ?? ""}`,
    `책 종류: ${book.book_type ?? ""}`,
    `핵심 메시지: ${coreMessage}`,
    `예상 독자: ${audience}`,
    `독자 연령: ${ageGroup}`,
    `문체: ${tone}`,
    "",
    "서점에서 실제로 집어 들고 싶은 한국어 책 제목 5개를 제안하세요.",
    "다섯 제목은 서로 전략이 달라야 합니다: 명료형, 호기심형, 개념형, 감성형, 강한 상업형을 적절히 섞으세요.",
    "제목만 보고 주제와 독자가 어느 정도 느껴져야 하지만 설명문처럼 길어서는 안 됩니다.",
    "AI가 흔히 만드는 '완벽 가이드', '모든 것', '새로운 시대' 같은 상투어와 과장된 클릭베이트를 피하세요.",
    "current title과 거의 같은 표현을 반복하지 마세요. 각 제안에 짧은 전략명(angle)과 추천 이유(reason)를 함께 작성하세요."
  ].join("\n");
}

function connectionError(provider: BackgroundAiProvider) {
  return provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser();
    await assertRateLimit(user.id, "title-suggestions", 24, 3600);
    await saveOpenRouterKeyFromRequest(request, user.id);

    const loaded = await loadOwnedBook(id, user.id);
    if (!loaded) return jsonError("Book not found", 404);
    const provider = providerFromBook(loaded.book as { book_settings?: Relation<BookSettings> });
    const connection = await import("@/lib/ai/provider-connection");
    if (!(await connection.hasBackgroundCredential(user.id, provider))) {
      return jsonError(connectionError(provider), 428, { reconnect: true, provider });
    }

    const generation = await generateBackgroundStructured(provider, user.id, {
      schemaName: "book_title_suggestions",
      jsonSchema: titleSuggestionJsonSchema as unknown as Record<string, unknown>,
      system: "당신은 한국 출판사의 시니어 북 에디터이자 카피라이터입니다. 책의 독자, 장르, 핵심 메시지를 읽고 실제 서점에서 경쟁력 있는 제목을 설계합니다. 과장보다 기억성, 명료성, 장르 적합성을 우선합니다.",
      prompt: titlePrompt(loaded.book as never),
      parse: (value) => TitleSuggestionSchema.parse(value),
      timeoutMs: 90_000
    });

    return NextResponse.json({
      suggestions: generation.value.suggestions,
      provider,
      providerLabel: backgroundProviderLabel(provider)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TITLE_SUGGESTION_FAILED";
    if (["CODEX_CONNECTION_REQUIRED", "CODEX_CONNECTION_EXPIRED", "FREE_AI_CONNECTION_REQUIRED", "FREE_AI_CONNECTION_EXPIRED"].includes(message)) {
      const provider = message.startsWith("CODEX_") ? "codex" : "openrouter";
      return jsonError(message, 428, { reconnect: true, provider });
    }
    if (message === "CODEX_USAGE_LIMIT" || message === "FREE_AI_DAILY_LIMIT" || message === "RATE_LIMITED") return jsonError(message, 429);
    if (message === "CODEX_LUNA_UNAVAILABLE") return jsonError(message, 409);
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const { title } = TitleUpdateSchema.parse(await request.json());

    const { data: book, error: bookError } = await supabase.from("books")
      .select("id,title,book_blueprints(id,blueprint,is_active,version)")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (bookError || !book) return jsonError("Book not found", 404);

    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from("books")
      .update({ title, updated_at: now })
      .eq("id", id)
      .eq("user_id", user.id);
    if (updateError) throw updateError;

    const blueprint = activeBlueprint(book.book_blueprints as Relation<BlueprintRow>);
    if (blueprint?.id && blueprint.blueprint && typeof blueprint.blueprint === "object") {
      await supabase.from("book_blueprints")
        .update({ blueprint: { ...blueprint.blueprint, selectedTitle: title } })
        .eq("id", blueprint.id)
        .eq("book_id", id);
    }

    const { data: coverPage } = await supabase.from("pages")
      .select("id,content")
      .eq("book_id", id)
      .eq("layout_type", "Cover")
      .order("page_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (coverPage?.id && coverPage.content && typeof coverPage.content === "object") {
      await supabase.from("pages").update({ content: { ...(coverPage.content as Record<string, unknown>), title } }).eq("id", coverPage.id);
    }

    return NextResponse.json({ ok: true, title, updatedAt: now }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "올바른 제목을 입력해 주세요.");
    const message = error instanceof Error ? error.message : "TITLE_UPDATE_FAILED";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}
