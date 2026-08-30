/* eslint-disable @typescript-eslint/no-explicit-any */

import { SUPABASE_URL } from "@/lib/supabase/config";

type BridgeError = { message: string; code?: string; details?: string; hint?: string };
type BridgeResult<T = unknown> = { data: T; error: BridgeError | null; count?: number | null };
type Filter = { op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "is"; column: string; value: unknown };
type Order = { column: string; ascending: boolean };
type Action = "select" | "insert" | "update" | "delete" | "upsert";
export type LooseRow = Record<string, any>;

type QueryState = {
  kind: "query";
  table: string;
  action: Action;
  select?: string;
  values?: unknown;
  filters: Filter[];
  orders: Order[];
  limit?: number;
  single?: "single" | "maybeSingle";
  onConflict?: string;
};

async function bridgeRequest<T = unknown>(body: Record<string, unknown>): Promise<BridgeResult<T>> {
  let oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken) {
    // Vercel Workflow imports service-layer modules while compiling the workflow body.
    // Loading @vercel/oidc lazily keeps jose's Node/CJS runtime out of that sandbox;
    // this branch executes only when a Node-backed server/step actually makes a bridge call.
    const { getVercelOidcToken } = await import("@vercel/oidc");
    oidcToken = await getVercelOidcToken({
      project: "ai-book-studio",
      team: "koreassp105-1594s-projects"
    });
  }
  if (!oidcToken) throw new Error("Vercel OIDC token is unavailable.");

  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-book-service`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({ data: null, error: { message: `Bridge HTTP ${response.status}` } })) as BridgeResult<T>;
  if (!response.ok && !payload.error) {
    return { data: null as T, error: { message: `Bridge HTTP ${response.status}` } };
  }
  return payload;
}

class RemoteQueryBuilder<T = LooseRow[]> implements PromiseLike<BridgeResult<T>> {
  private state: QueryState;

  constructor(table: string) {
    this.state = { kind: "query", table, action: "select", filters: [], orders: [] };
  }

  select(columns = "*") { this.state.select = columns; return this; }
  insert(values: unknown) { this.state.action = "insert"; this.state.values = values; return this; }
  update(values: unknown) { this.state.action = "update"; this.state.values = values; return this; }
  delete() { this.state.action = "delete"; return this; }
  upsert(values: unknown, options?: { onConflict?: string }) {
    this.state.action = "upsert";
    this.state.values = values;
    this.state.onConflict = options?.onConflict;
    return this;
  }

  eq(column: string, value: unknown) { this.state.filters.push({ op: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this.state.filters.push({ op: "neq", column, value }); return this; }
  lt(column: string, value: unknown) { this.state.filters.push({ op: "lt", column, value }); return this; }
  lte(column: string, value: unknown) { this.state.filters.push({ op: "lte", column, value }); return this; }
  gt(column: string, value: unknown) { this.state.filters.push({ op: "gt", column, value }); return this; }
  gte(column: string, value: unknown) { this.state.filters.push({ op: "gte", column, value }); return this; }
  in(column: string, value: unknown[]) { this.state.filters.push({ op: "in", column, value }); return this; }
  is(column: string, value: null | boolean) { this.state.filters.push({ op: "is", column, value }); return this; }

  order(column: string, options?: { ascending?: boolean }) {
    this.state.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) { this.state.limit = value; return this; }
  single(): RemoteQueryBuilder<LooseRow> { this.state.single = "single"; return this as unknown as RemoteQueryBuilder<LooseRow>; }
  maybeSingle(): RemoteQueryBuilder<LooseRow> { this.state.single = "maybeSingle"; return this as unknown as RemoteQueryBuilder<LooseRow>; }

  private execute() { return bridgeRequest<T>(this.state as unknown as Record<string, unknown>); }

  then<TResult1 = BridgeResult<T>, TResult2 = never>(
    onfulfilled?: ((value: BridgeResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export type RemoteServiceSupabase = {
  from(table: string): RemoteQueryBuilder<LooseRow[]>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<BridgeResult<T>>;
};

export function createRemoteServiceSupabase(): RemoteServiceSupabase {
  return {
    from(table: string) { return new RemoteQueryBuilder<LooseRow[]>(table); },
    rpc<T = unknown>(fn: string, args?: Record<string, unknown>) {
      return bridgeRequest<T>({ kind: "rpc", fn, args: args ?? {} });
    }
  };
}

export async function registerViaServiceBridge(email: string, password: string) {
  return bridgeRequest<{ id?: string; email?: string }>({ kind: "auth_register", email, password });
}

export async function serviceBridgeHealth() {
  const result = await bridgeRequest<{ ok?: boolean; service?: string }>({ kind: "health" });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
