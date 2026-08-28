import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { createRemoteServiceSupabase, type RemoteServiceSupabase } from "@/lib/supabase/service-bridge";

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy refreshes sessions.
        }
      }
    }
  });
}

export function createServiceSupabase(): RemoteServiceSupabase {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRole) {
    return createSupabaseClient(SUPABASE_URL, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false }
    }) as unknown as RemoteServiceSupabase;
  }
  return createRemoteServiceSupabase();
}

export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  return { supabase, user };
}
