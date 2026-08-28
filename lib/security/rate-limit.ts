import { createServiceSupabase } from "@/lib/supabase/server";

export async function assertRateLimit(userId: string, key: string, limit: number, windowSeconds: number) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  if (!data) throw new Error("RATE_LIMITED");
}
