import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

export async function requestPasswordResetEmail(email: string, redirectTo: string) {
  const recoveryClient = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return recoveryClient.auth.resetPasswordForEmail(email, { redirectTo });
}
