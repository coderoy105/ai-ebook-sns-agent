import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const TEAM_SLUG = "koreassp105-1594s-projects";
const PROJECT_NAME = "ai-book-studio";
const EXPECTED_SUBJECT = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:production`;
const issuerCandidates = [`https://oidc.vercel.com/${TEAM_SLUG}`, "https://oidc.vercel.com"];

const allowedTables = new Set([
  "books", "book_settings", "reader_profiles", "writing_styles", "book_blueprints", "parts", "chapters", "sections",
  "content_blocks", "story_bibles", "knowledge_maps", "book_memories", "sources", "citations", "templates", "pages",
  "revisions", "generation_jobs", "generation_steps", "job_logs", "token_usage", "book_reviews", "assets", "book_covers",
  "export_jobs", "rate_limit_buckets", "plans", "subscriptions", "ai_provider_credentials", "codex_connection_profiles"
]);
const allowedRpcs = new Set([
  "consume_rate_limit", "match_book_memory", "store_openrouter_credential", "has_openrouter_credential",
  "get_openrouter_credential", "delete_openrouter_credential", "store_codex_chatgpt_credential",
  "has_codex_chatgpt_credential", "get_codex_chatgpt_credential", "delete_codex_chatgpt_credential"
]);
const allowedFilterOps = new Set(["eq", "neq", "lt", "lte", "gt", "gte", "in", "is"]);

type Filter = { op: string; column: string; value: unknown };
type Order = { column: string; ascending?: boolean };
type QueryBody = {
  kind: "query";
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  select?: string;
  values?: unknown;
  filters?: Filter[];
  orders?: Order[];
  limit?: number;
  single?: "single" | "maybeSingle";
  onConflict?: string;
};
type RpcBody = { kind: "rpc"; fn: string; args?: Record<string, unknown> };
type AuthBody = { kind: "auth_register"; email: string; password: string };
type HealthBody = { kind: "health" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function verifyVercelOidc(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("Missing Vercel OIDC token");
  let lastError: unknown;
  for (const issuer of issuerCandidates) {
    try {
      const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: `https://vercel.com/${TEAM_SLUG}`,
        subject: EXPECTED_SUBJECT,
        clockTolerance: 30
      });
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Invalid Vercel OIDC token");
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) throw new Error("Supabase server credentials unavailable inside Edge Function");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function applyFilters(query: any, filters: Filter[] = []) {
  let current = query;
  for (const filter of filters) {
    if (!allowedFilterOps.has(filter.op)) throw new Error(`Unsupported filter operator: ${filter.op}`);
    if (!/^[a-zA-Z0-9_.]+$/.test(filter.column)) throw new Error("Invalid filter column");
    if (filter.op === "in") {
      if (!Array.isArray(filter.value)) throw new Error("in filter requires array value");
      current = current.in(filter.column, filter.value);
    } else if (filter.op === "is") {
      current = current.is(filter.column, filter.value as null | boolean);
    } else {
      current = current[filter.op](filter.column, filter.value);
    }
  }
  return current;
}

async function runQuery(body: QueryBody) {
  if (!allowedTables.has(body.table)) throw new Error("Table is not allowed");
  const supabase = adminClient();
  let query: any;
  switch (body.action) {
    case "select": query = supabase.from(body.table).select(body.select ?? "*"); break;
    case "insert": query = supabase.from(body.table).insert(body.values as any); if (body.select) query = query.select(body.select); break;
    case "update": query = supabase.from(body.table).update(body.values as any); if (body.select) query = query.select(body.select); break;
    case "delete": query = supabase.from(body.table).delete(); if (body.select) query = query.select(body.select); break;
    case "upsert": query = supabase.from(body.table).upsert(body.values as any, body.onConflict ? { onConflict: body.onConflict } : undefined); if (body.select) query = query.select(body.select); break;
    default: throw new Error("Unsupported action");
  }
  query = applyFilters(query, body.filters);
  for (const order of body.orders ?? []) {
    if (!/^[a-zA-Z0-9_.]+$/.test(order.column)) throw new Error("Invalid order column");
    query = query.order(order.column, { ascending: order.ascending !== false });
  }
  if (typeof body.limit === "number") query = query.limit(Math.max(0, Math.min(body.limit, 5000)));
  if (body.single === "single") query = query.single();
  if (body.single === "maybeSingle") query = query.maybeSingle();
  const { data, error, count } = await query;
  if (error) return json({ data: null, error: { message: error.message, code: error.code, details: error.details, hint: error.hint }, count }, 400);
  return json({ data, error: null, count });
}

async function runRpc(body: RpcBody) {
  if (!allowedRpcs.has(body.fn)) throw new Error("RPC is not allowed");
  const { data, error } = await adminClient().rpc(body.fn, body.args ?? {});
  if (error) return json({ data: null, error: { message: error.message, code: error.code, details: error.details, hint: error.hint } }, 400);
  return json({ data, error: null });
}

async function register(body: AuthBody) {
  const email = body.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: { message: "Valid email required" } }, 400);
  if (body.password.length < 8 || body.password.length > 128) return json({ error: { message: "Password must be 8-128 characters" } }, 400);
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: body.password, email_confirm: true });
  if (error) return json({ error: { message: error.message, code: error.code } }, 400);
  return json({ data: { id: data.user?.id, email: data.user?.email }, error: null }, 201);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);
  try {
    await verifyVercelOidc(req);
    const body = await req.json() as QueryBody | RpcBody | AuthBody | HealthBody;
    if (body.kind === "health") return json({ data: { ok: true, service: "ai-book-service" }, error: null });
    if (body.kind === "query") return await runQuery(body);
    if (body.kind === "rpc") return await runRpc(body);
    if (body.kind === "auth_register") return await register(body);
    return json({ error: { message: "Unsupported operation" } }, 400);
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : "Unauthorized" } }, 401);
  }
});
